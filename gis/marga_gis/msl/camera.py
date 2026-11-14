"""Navcam geometry: NASA CAHVOR camera models, rover attitude and equirectangular panoramas.

Frames (all from the MSL raw-image record of each image, nothing assumed):
- The CAHVOR model (camera_model_component_list "C;A;H;V;O;R") is in the rover navigation frame
  (X forward, Y right, Z down): its C is ~1.8 m above the rover origin, a few decimetres from it.
- `attitude` is the rover's orientation quaternion (s, x, y, z) relative to the site frame
  (X north, Y east, Z down): v_site = R(q) v_rover. Checked: its yaw matches the NASA waypoint yaw.

CAHVOR projection (Gennery, "Least-squares camera calibration including lens distortion and
automatic editing of calibration points", 2001; the JPL convention used for MSL camera models):
    p = P - C,  zeta = p.O,  lambda = p - zeta O,  tau = |lambda|^2 / zeta^2
    mu = R0 + R1 tau + R2 tau^2,  p' = p + mu lambda
    x = (p'.H) / (p'.A),  y = (p'.V) / (p'.A)        (x = sample/column, y = line/row, 0-based)
For a panorama of distant terrain P - C is taken as the viewing direction (camera parallax ignored).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

import numpy as np

_VEC = re.compile(r"\(([^)]*)\)")


@dataclass(frozen=True)
class Cahvor:
    C: np.ndarray
    A: np.ndarray
    H: np.ndarray
    V: np.ndarray
    O: np.ndarray
    R: np.ndarray

    @classmethod
    def parse(cls, text: str) -> "Cahvor":
        vecs = [np.array([float(v) for v in m.split(",")]) for m in _VEC.findall(text)]
        if any(v.shape != (3,) for v in vecs[:6]):
            raise ValueError(f"not a CAHV/CAHVOR model: {text!r}")
        if len(vecs) == 4:  # CAHV: no radial distortion (O = A, R = 0)
            return cls(*vecs, vecs[1].copy(), np.zeros(3))
        if len(vecs) == 6:
            return cls(*vecs)
        raise ValueError(f"expected a CAHV or CAHVOR model (4 or 6 vectors), got {len(vecs)}: {text!r}")

    @staticmethod
    def supported(text: str | None) -> bool:
        if not text:
            return False
        try:
            Cahvor.parse(text)
            return True
        except ValueError:
            return False

    def project(self, d: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Image (x, y) of viewing directions d (..., 3) in the model's frame, and whether each is in front."""
        zeta = d @ self.O
        lam = d - zeta[..., None] * self.O
        with np.errstate(divide="ignore", invalid="ignore"):
            tau = (lam * lam).sum(-1) / (zeta * zeta)
            mu = self.R[0] + self.R[1] * tau + self.R[2] * tau * tau
            pp = d + mu[..., None] * lam
            a = pp @ self.A
            x = (pp @ self.H) / a
            y = (pp @ self.V) / a
        return x, y, (zeta > 0) & (a > 0)

    def centre(self) -> tuple[float, float]:
        """Image coordinates of the optical axis direction A (the CAHV image centre)."""
        return float(self.H @ self.A), float(self.V @ self.A)


def parse_vector(text: str | None) -> np.ndarray | None:
    if not text:
        return None
    m = _VEC.search(text)
    return np.array([float(v) for v in (m.group(1) if m else text).split(",")])


def quat_matrix(q: np.ndarray) -> np.ndarray:
    """Rotation matrix of a unit quaternion (s, x, y, z)."""
    s, x, y, z = (np.asarray(q, float) / np.linalg.norm(q))
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - s * z), 2 * (x * z + s * y)],
        [2 * (x * y + s * z), 1 - 2 * (x * x + z * z), 2 * (y * z - s * x)],
        [2 * (x * z - s * y), 2 * (y * z + s * x), 1 - 2 * (x * x + y * y)],
    ])


def yaw_deg(rover_to_site: np.ndarray) -> float:
    """Heading of the rover's forward axis, degrees clockwise from north (site X north, Y east)."""
    fwd = rover_to_site @ np.array([1.0, 0.0, 0.0])
    return math.degrees(math.atan2(fwd[1], fwd[0]))


def az_el(d_site: np.ndarray) -> tuple[float, float]:
    """Azimuth (deg clockwise from north) and elevation (deg above horizontal) of a site-frame direction."""
    d = d_site / np.linalg.norm(d_site)
    return math.degrees(math.atan2(d[1], d[0])) % 360.0, math.degrees(math.asin(-d[2]))


@dataclass(frozen=True)
class PanoGrid:
    width: int
    height: int
    el_top: float
    el_bottom: float

    @property
    def deg_per_px(self) -> float:
        return 360.0 / self.width

    def az(self, cols: np.ndarray) -> np.ndarray:
        return (cols + 0.5) * self.deg_per_px

    def el(self, rows: np.ndarray) -> np.ndarray:
        return self.el_top - (rows + 0.5) * (self.el_top - self.el_bottom) / self.height

    def row_of(self, el: float) -> float:
        return (self.el_top - el) / (self.el_top - self.el_bottom) * self.height - 0.5

    def dirs(self, rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
        """Site-frame unit directions (rows x cols x 3) for pixel rows and columns."""
        az = np.radians(self.az(cols))[None, :]
        el = np.radians(self.el(rows))[:, None]
        ce = np.cos(el)
        return np.stack(np.broadcast_arrays(ce * np.cos(az), ce * np.sin(az), -np.sin(el) + 0 * az), axis=-1)


@dataclass
class Frame:
    image: np.ndarray            # 2-D grey image as delivered (float32)
    model: Cahvor                # in the rover frame, full-frame image coordinates
    rover_to_site: np.ndarray    # 3x3
    offset: tuple[int, int] = (0, 0)  # (col, row) of the image's first pixel in full-frame coordinates
    scale: float = 1.0           # full-frame pixels per image pixel

    def pointing(self) -> tuple[float, float]:
        return az_el(self.rover_to_site @ self.model.A)


def _bilinear(img: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = x - x0
    fy = y - y0
    a = img[y0, x0]
    b = img[y0, x0 + 1]
    c = img[y0 + 1, x0]
    d = img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def _frame_samples(f: Frame, grid: PanoGrid, half_window_deg: float = 42.0):
    """Panorama pixels this frame sees: (rows, cols, image x, image y, normalised radius from centre)."""
    az0, el0 = f.pointing()
    dpp = grid.deg_per_px
    r_top = max(0, int(grid.row_of(min(grid.el_top, el0 + half_window_deg))))
    r_bot = min(grid.height - 1, int(math.ceil(grid.row_of(max(grid.el_bottom, el0 - half_window_deg)))))
    if r_bot < r_top:
        return None
    # Near the zenith/nadir a frame spans more azimuth; widen the window with 1/cos(elevation).
    span = min(180.0, half_window_deg / max(0.2, math.cos(math.radians(min(abs(el0) + half_window_deg, 89.0)))))
    c0 = int(math.floor((az0 - span) / dpp))
    c1 = int(math.ceil((az0 + span) / dpp))
    cols = np.arange(c0, c1 + 1) % grid.width
    cols = np.unique(cols) if c1 - c0 + 1 >= grid.width else cols
    rows = np.arange(r_top, r_bot + 1)
    d_site = grid.dirs(rows, cols)
    d_rover = d_site @ f.rover_to_site  # = (R^T d) for each direction
    x, y, front = f.model.project(d_rover)
    xi = (x - f.offset[0]) / f.scale
    yi = (y - f.offset[1]) / f.scale
    h, w = f.image.shape
    ok = front & (xi >= 0) & (yi >= 0) & (xi < w - 1) & (yi < h - 1)
    if not ok.any():
        return None
    rr, cc = np.nonzero(ok)
    cx, cy = (w - 1) / 2, (h - 1) / 2
    rad = np.hypot((xi[rr, cc] - cx) / w, (yi[rr, cc] - cy) / h)
    return rows[rr], cols[cc], xi[rr, cc], yi[rr, cc], rad


def frame_gains(frames: list[Frame], grid: PanoGrid) -> np.ndarray:
    """Per-frame brightness gains that make overlapping frames agree (least squares on log ratios)."""
    n = len(frames)
    if n < 2:
        return np.ones(n)
    vals: list[dict[int, float]] = []
    for f in frames:
        s = _frame_samples(f, grid)
        if s is None:
            vals.append({})
            continue
        r, c, x, y, _ = s
        v = _bilinear(f.image, x, y)
        vals.append(dict(zip((r * grid.width + c).tolist(), v.tolist())))
    rows, rhs = [], []
    for i in range(n):
        for j in range(i + 1, n):
            common = vals[i].keys() & vals[j].keys()
            if len(common) < 200:
                continue
            a = np.array([vals[i][k] for k in common])
            b = np.array([vals[j][k] for k in common])
            good = (a > 8) & (b > 8)
            if good.sum() < 200:
                continue
            ratio = float(np.median(np.log(a[good]) - np.log(b[good])))
            e = np.zeros(n)
            e[i], e[j] = -1.0, 1.0  # log g_i + log a = log g_j + log b  ->  -log g_i + log g_j = log a - log b
            rows.append(e)
            rhs.append(ratio)
    if not rows:
        return np.ones(n)
    rows.append(np.ones(n) / n)  # mean log gain = 0
    rhs.append(0.0)
    sol, *_ = np.linalg.lstsq(np.array(rows), np.array(rhs), rcond=None)
    return np.exp(np.clip(sol, -1.0, 1.0))


def render(frames: list[Frame], grid: PanoGrid, gains: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray, dict]:
    """Equirectangular panorama: each pixel from the frame that sees it nearest that frame's centre.

    Returns (image float32 0-255 with NaN where no frame sees, index of the frame used (-1 none), seam stats)."""
    out = np.full((grid.height, grid.width), np.nan, np.float32)
    best = np.full((grid.height, grid.width), np.inf, np.float32)
    owner = np.full((grid.height, grid.width), -1, np.int16)
    second = np.full((grid.height, grid.width), np.nan, np.float32)  # value from another frame, for seam statistics
    g = np.ones(len(frames)) if gains is None else gains
    for i, f in enumerate(frames):
        s = _frame_samples(f, grid)
        if s is None:
            continue
        r, c, x, y, rad = s
        v = (_bilinear(f.image, x, y) * g[i]).astype(np.float32)
        had = owner[r, c] >= 0
        take = rad < best[r, c]
        # keep a value from the other frame where frames overlap
        second[r[had & take], c[had & take]] = out[r[had & take], c[had & take]]
        second[r[had & ~take], c[had & ~take]] = v[had & ~take]
        out[r[take], c[take]] = v[take]
        best[r[take], c[take]] = rad[take]
        owner[r[take], c[take]] = i
    both = ~np.isnan(second) & ~np.isnan(out)
    diff = np.abs(out[both] - second[both])
    stats = {"overlap_px": int(both.sum()), "median_abs_diff_dn": round(float(np.median(diff)), 1) if diff.size else None}
    return out, owner, stats


# --- horizon check -------------------------------------------------------------------------------

def detect_skyline(pano: np.ndarray, grid: PanoGrid, el_range: tuple[float, float] = (-10.0, 20.0),
                   min_sky_deg: float = 0.6) -> np.ndarray:
    """Elevation (deg) of the sky/terrain boundary per panorama column, NaN where it cannot be seen.

    A column counts only if its imaged area starts with sky: at least `min_sky_deg` of bright, smooth
    pixels (Navcam sky is bright and featureless). The skyline is then the first row, going down, where
    the brightness falls below halfway between that sky and the terrain below it, inside `el_range`.
    Columns whose imaged area starts below the horizon, or on terrain, are NaN.
    """
    h, w = pano.shape
    px_per_deg = h / (grid.el_top - grid.el_bottom)
    need = max(3, int(math.ceil(min_sky_deg * px_per_deg)))
    # light horizontal smoothing (3 columns), NaN-aware
    valid = ~np.isnan(pano)
    filled = np.where(valid, pano, 0.0).astype(np.float64)
    cnt = valid.astype(np.float64)
    num = filled + np.roll(filled, 1, axis=1) + np.roll(filled, -1, axis=1)
    den = cnt + np.roll(cnt, 1, axis=1) + np.roll(cnt, -1, axis=1)
    sm = np.where(valid & (den > 0), num / np.maximum(den, 1e-9), np.nan)
    if not valid.any():
        return np.full(w, np.nan)
    bright = float(np.nanpercentile(sm, 99.5))
    r_lo = int(grid.row_of(el_range[0]))
    r_hi = max(0, int(grid.row_of(el_range[1])))
    out = np.full(w, np.nan)
    for c in range(w):
        col = sm[:, c]
        rows = np.nonzero(~np.isnan(col))[0]
        if rows.size < need * 4:
            continue
        top = int(rows[0])
        if top > r_lo:
            continue
        sky = col[top:top + need]
        if np.isnan(sky).any():
            continue
        sky_v = float(np.median(sky))
        if sky_v < 0.7 * bright or float(np.std(sky)) > 0.04 * bright:
            continue
        below = col[top + need: min(h, int(grid.row_of(el_range[0] - 10.0)))]  # down to 10 deg below the search band
        below = below[~np.isnan(below)]
        if below.size < need:
            continue
        terrain_v = float(np.percentile(below, 25))
        if sky_v - terrain_v < 0.15 * bright:
            continue
        thr = (sky_v + terrain_v) / 2
        seg = col[top:]
        drop = np.nonzero(np.nan_to_num(seg, nan=sky_v) < thr)[0]
        if drop.size == 0:
            continue
        r = top + int(drop[0])
        # stays terrain for a while below the boundary (not a single dark speck in the sky)
        after = col[r:r + need]
        if np.isnan(after).any() or np.mean(after < thr) < 0.8:
            continue
        if r < r_hi or r > r_lo:
            continue
        # sub-pixel: interpolate the threshold crossing between rows r-1 and r
        a, b = col[r - 1], col[r]
        frac = 0.0 if not np.isfinite(a) or a == b else float((a - thr) / (a - b))
        out[c] = float(grid.el(np.array([r - 1 + frac]))[0])
    return out


def dem_horizon(elev: np.ndarray, transform, lat0: float, lon0: float, h0: float, metres_per_degree: float,
                planet_radius_m: float, az_deg: np.ndarray, step_m: float = 20.0) -> tuple[np.ndarray, np.ndarray]:
    """Horizon elevation angle (deg) per azimuth from a DEM, and whether it is resolved inside the DEM.

    `transform` maps (col, row) -> (lon, lat) as an affine (a, b, c, d, e, f) with lon = a*col + b*row + c,
    lat = d*col + e*row + f. Earth-curvature-style drop r^2 / 2R is applied with Mars' radius."""
    a, b, c, d, e, f = transform
    det = a * e - b * d
    h, w = elev.shape
    k = math.cos(math.radians(lat0))
    out = np.full(az_deg.shape, np.nan)
    resolved = np.zeros(az_deg.shape, bool)
    r = np.arange(step_m, 60000.0, step_m)
    for i, az in enumerate(np.radians(az_deg)):
        lat = lat0 + r * math.cos(az) / metres_per_degree
        lon = lon0 + r * math.sin(az) / (metres_per_degree * k)
        col = (e * (lon - c) - b * (lat - f)) / det
        row = (-d * (lon - c) + a * (lat - f)) / det
        inside = (col >= 0) & (row >= 0) & (col < w - 1) & (row < h - 1)
        if not inside.any():
            continue
        n = int(np.argmin(inside)) if not inside.all() else inside.size
        cc, rr = col[:n], row[:n]
        z = _bilinear(elev, cc, rr)
        ang = np.degrees(np.arctan2(z - h0 - r[:n] ** 2 / (2 * planet_radius_m), r[:n]))
        if np.isnan(ang).all():
            continue
        j = int(np.nanargmax(ang))
        out[i] = ang[j]
        resolved[i] = r[j] < 0.75 * r[n - 1]
    return out, resolved


def skyline_offset(sky: np.ndarray, sky_az: np.ndarray, dem: np.ndarray, dem_az: np.ndarray, resolved: np.ndarray,
                   step_deg: float = 0.25, min_columns: int = 200, min_span_deg: float = 20.0) -> dict:
    """Azimuth shift that best aligns the image skyline with the DEM horizon (circular search over 360 deg).

    The score at each shift is the median absolute difference after removing the median vertical offset;
    the result records the best shift, its score and how it compares with the scores at all other shifts."""
    ok = ~np.isnan(sky)
    if ok.sum() < min_columns:
        return {"verdict": "inconclusive", "reason": f"the skyline is visible in only {int(ok.sum())} panorama columns"}
    dem_ok = resolved & ~np.isnan(dem)
    shifts = np.arange(-180.0, 180.0, step_deg)
    scores = np.full(shifts.shape, np.nan)
    counts = np.zeros(shifts.shape, int)
    reliefs = np.zeros(shifts.shape)
    for i, s in enumerate(shifts):
        # DEM horizon at (image azimuth + shift)
        idx = np.round(((sky_az[ok] + s) % 360.0) / (dem_az[1] - dem_az[0])).astype(int) % dem_az.size
        m = dem_ok[idx]
        if m.sum() < min_columns:
            continue
        # the compared columns must spread over enough azimuth to fix a rotation
        span = len(np.unique((sky_az[ok][m] // 5).astype(int))) * 5.0
        if span < min_span_deg:
            continue
        d_m = dem[idx][m]
        dlt = sky[ok][m] - d_m
        scores[i] = float(np.median(np.abs(dlt - np.median(dlt))))
        counts[i] = int(m.sum())
        reliefs[i] = float(np.percentile(d_m, 95) - np.percentile(d_m, 5))
    if np.isnan(scores).all():
        return {"verdict": "inconclusive",
                "reason": f"the visible skyline and the horizon resolved inside the DEM overlap in fewer than {min_columns} "
                          f"columns or {min_span_deg:.0f} deg of azimuth"}
    b = int(np.nanargmin(scores))
    best, med = float(scores[b]), float(np.nanmedian(scores))
    relief = float(reliefs[b])
    shift = float(shifts[b])
    # Distinctness: the best shift must beat every shift more than 3 deg away by a clear margin.
    far = np.abs(((shifts - shift + 180.0) % 360.0) - 180.0) > 3.0
    second = float(np.nanmin(scores[far])) if np.any(far & ~np.isnan(scores)) else float("nan")
    rec = {"azimuth_offset_deg": shift, "residual_deg": round(best, 2), "median_residual_all_shifts_deg": round(med, 2),
           "best_residual_beyond_3deg": None if np.isnan(second) else round(second, 2),
           "columns": int(counts[b]), "dem_horizon_relief_deg": round(relief, 2),
           "offset_meaning": "the DEM horizon matches the image skyline at image azimuth + offset"}
    if relief < 2.0:
        rec.update(verdict="inconclusive", reason="the compared part of the DEM horizon is too flat to fix the azimuth")
    elif best > 0.5 * med or (not np.isnan(second) and best > 0.6 * second):
        rec.update(verdict="inconclusive", reason="no azimuth shift fits clearly better than the others")
    elif abs(shift) <= 2.0:
        rec.update(verdict="aligned", reason="the skyline matches the DEM horizon within 2 deg of azimuth")
    else:
        rec.update(verdict="offset", reason=f"the skyline matches the DEM horizon best {shift:+.1f} deg away")
    return rec
