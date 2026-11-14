"""HTTP downloads with progress, cancellation, retries and checksums (standard library only).

- Responses stream to `<file>.part` in 256 KB chunks; the SHA-256 is computed while streaming and the
  file is renamed into place only when complete, so a cancelled or failed download never leaves a
  truncated file behind.
- Cancellation is cooperative: set the `threading.Event` passed as `cancel` (the CLI does this on
  Ctrl+C); the download stops between chunks and raises Cancelled.
- ArcGIS services report many errors as JSON with HTTP 200, so callers state the content types they
  expect and anything else is read as a service error instead of being saved as data.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

USER_AGENT = "MARGA-GIS/1.0 (regional data acquisition)"
CHUNK = 256 * 1024


class Cancelled(Exception):
    """The download was cancelled."""


class NotFound(Exception):
    """HTTP 404: the resource does not exist (for WMTS tiles: no data there)."""


class ServiceError(Exception):
    """The service answered with an error (HTTP error, or an error document instead of data)."""


@dataclass
class Progress:
    label: str
    done_bytes: int
    total_bytes: int | None


@dataclass
class FetchResult:
    url: str
    path: str
    bytes: int
    sha256: str
    content_type: str | None
    http_status: int
    downloaded_at: str

    def record(self, root: Path) -> dict[str, Any]:
        """Manifest record with the file path relative to the package root."""
        return {
            "url": self.url,
            "file": Path(self.path).resolve().relative_to(root.resolve()).as_posix(),
            "bytes": self.bytes,
            "sha256": self.sha256,
            "content_type": self.content_type,
            "http_status": self.http_status,
            "downloaded_at": self.downloaded_at,
        }


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


class Downloader:
    def __init__(self, *, timeout: float = 180.0, retries: int = 3, backoff_s: float = 2.0,
                 cancel: threading.Event | None = None, on_progress: Callable[[Progress], None] | None = None):
        self.timeout = timeout
        self.retries = retries
        self.backoff_s = backoff_s
        self.cancel = cancel or threading.Event()
        self.on_progress = on_progress

    # -- helpers ---------------------------------------------------------------------------------
    def _check_cancel(self) -> None:
        if self.cancel.is_set():
            raise Cancelled()

    def _open(self, url: str):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        return urllib.request.urlopen(req, timeout=self.timeout)

    def _with_retries(self, fn: Callable[[], Any], url: str) -> Any:
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            self._check_cancel()
            try:
                return fn()
            except (NotFound, Cancelled):
                raise
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    raise NotFound(url) from e
                last = ServiceError(f"HTTP {e.code} {e.reason} for {url}")
                if e.code < 500 and e.code != 429:
                    raise last from e
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                last = e
            if attempt < self.retries:
                # Wait before retrying, but stay responsive to cancellation.
                if self.cancel.wait(self.backoff_s * (2 ** attempt)):
                    raise Cancelled()
        raise ServiceError(f"giving up after {self.retries + 1} attempts: {url}: {last}")

    # -- public ------------------------------------------------------------------------------------
    def fetch_json(self, url: str) -> dict[str, Any]:
        """GET a JSON document; an ArcGIS error document raises ServiceError."""
        def run():
            with self._open(url) as r:
                doc = json.loads(r.read().decode("utf-8"))
            if isinstance(doc, dict) and "error" in doc:
                raise ServiceError(f"{url}: {doc['error']}")
            return doc
        return self._with_retries(run, url)

    def fetch_bytes(self, url: str) -> bytes:
        def run():
            with self._open(url) as r:
                return r.read()
        return self._with_retries(run, url)

    def fetch_to_file(self, url: str, dest: str | Path, *, expect: tuple[str, ...], label: str | None = None) -> FetchResult:
        """Stream `url` to `dest`. `expect`: acceptable Content-Type prefixes (e.g. 'image/tiff')."""
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_name(dest.name + ".part")

        def run() -> FetchResult:
            with self._open(url) as r:
                ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                if not any(ctype.startswith(e) for e in expect):
                    body = r.read(4096).decode("utf-8", "replace")
                    raise ServiceError(f"{url}: expected {expect}, got '{ctype}': {body[:300]}")
                total = r.headers.get("Content-Length")
                total_n = int(total) if total and total.isdigit() else None
                h = hashlib.sha256()
                n = 0
                try:
                    with open(part, "wb") as f:
                        while True:
                            self._check_cancel()
                            block = r.read(CHUNK)
                            if not block:
                                break
                            f.write(block)
                            h.update(block)
                            n += len(block)
                            if self.on_progress:
                                self.on_progress(Progress(label or dest.name, n, total_n))
                    if total_n is not None and n != total_n:
                        raise ServiceError(f"{url}: received {n} of {total_n} bytes")
                    part.replace(dest)
                except BaseException:
                    part.unlink(missing_ok=True)
                    raise
                return FetchResult(url, str(dest), n, h.hexdigest(), ctype, r.status, utc_now())

        return self._with_retries(run, url)
