"""Shared test data: a synthetic Sentinel-2 box on a real UTM grid (EPSG:32636, central Israel)."""
from __future__ import annotations

import numpy as np
from affine import Affine
from rasterio.crs import CRS

UTM36 = CRS.from_epsg(32636)
# A Sentinel-2 tile (36RXV-like): 109.8 km square, 10 m pixels, origin on the 10 m grid.
TILE_TRANSFORM = Affine(10.0, 0.0, 600000.0, 0.0, -10.0, 3600000.0)
TILE_SIZE = 10980
LAT, LNG = 31.5, 34.45  # near Gaza / Ashkelon, cell (6890, 6300)


def checkerboard(h: int, w: int, block: int = 16) -> np.ndarray:
    """[4, h, w] reflectance: vegetated and bare blocks (veg: low red, high NIR)."""
    yy, xx = np.mgrid[0:h, 0:w]
    veg = ((yy // block + xx // block) % 2 == 0)
    x = np.empty((4, h, w), np.float32)
    x[0] = np.where(veg, 0.04, 0.22)   # B04 red
    x[1] = np.where(veg, 0.08, 0.20)   # B03 green
    x[2] = np.where(veg, 0.05, 0.18)   # B02 blue
    x[3] = np.where(veg, 0.45, 0.26)   # B08 NIR
    return x
