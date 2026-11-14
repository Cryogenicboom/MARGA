"""NASA Mars Trek data acquisition: catalogue lookup, image-service exports, WMTS tiles and
map-service vector queries, each implemented to what the service actually supports (see the module
docstrings), with progress reporting, cancellation, retries and a resumable on-disk cache.

Nothing here invents data or metadata: every file is a server response saved as received, and every
record names the exact URL it came from and when.
"""
from .net import Cancelled, Downloader, FetchResult, NotFound, Progress, ServiceError

__all__ = ["Cancelled", "Downloader", "FetchResult", "NotFound", "Progress", "ServiceError"]
