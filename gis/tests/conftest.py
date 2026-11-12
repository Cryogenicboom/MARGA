import sys
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.crs import CRS as RioCRS
from rasterio.transform import from_origin

GIS = Path(__file__).resolve().parents[1]
if str(GIS) not in sys.path:
    sys.path.insert(0, str(GIS))

import marga_gis  # noqa: E402  (also puts engine/ on sys.path)

PIXEL_DEG = 0.000337412097162289  # ~20 m on Mars, like the Gale DEM


def write_tif(path, array, *, crs="IAU_2015:49900", transform=None, nodata=None, count=1):
    array = np.asarray(array)
    if array.ndim == 2:
        array = array[None, ...]
    transform = transform if transform is not None else from_origin(137.2, -4.45, PIXEL_DEG, PIXEL_DEG)
    profile = dict(driver="GTiff", height=array.shape[1], width=array.shape[2], count=count, dtype=array.dtype.name,
                   transform=transform, nodata=nodata)
    if crs is not None:
        profile["crs"] = RioCRS.from_user_input(crs)
    with rasterio.open(path, "w", **profile) as ds:
        ds.write(array[:count] if array.shape[0] >= count else np.repeat(array, count, axis=0))
    return path


@pytest.fixture
def plane_dem():
    """A tilted plane (Mars elevations) with one no-data cell: 60 rows x 50 columns."""
    r, c = np.mgrid[0:60, 0:50]
    z = (-4500.0 + 2.0 * r + 1.0 * c).astype(np.float32)
    z[10, 10] = np.nan
    return z
