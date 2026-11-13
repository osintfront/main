"""Where the box is and how the pictures land on the web map.

The site snaps every click to a 0.005° cell (200 per degree). The worker reads a
square of Sentinel-2 pixels on the tile's own 10 m UTM grid around the cell centre,
super-resolves it on that grid, and only then warps both the original and the
result onto ONE shared EPSG:3857 (web mercator) grid. Leaflet's imageOverlay
stretches a picture linearly in EPSG:3857 between two corners, so a picture that is
already on a mercator grid lands exactly; the UTM box's slight rotation shows as
transparent corners (alpha 0).
"""
from __future__ import annotations

import math

import numpy as np
from affine import Affine
from rasterio.crs import CRS
from rasterio.transform import array_bounds
from rasterio.warp import Resampling, calculate_default_transform, reproject, transform as transform_xy

CELL = 200  # cells per degree (0.005°), the same number as the site's satEnhance.ts and the SQL
MERCATOR = CRS.from_epsg(3857)
WGS84 = CRS.from_epsg(4326)


def cell_center(cell_x: int, cell_y: int) -> tuple[float, float]:
    """(lat, lng) of a cell's centre."""
    return cell_y / CELL, cell_x / CELL


def snap_cell(lat: float, lng: float) -> tuple[int, int]:
    """(cell_x, cell_y) of a point, rounding like the database (floor(v * 200 + 0.5))."""
    return math.floor(lng * CELL + 0.5), math.floor(lat * CELL + 0.5)


def utm_window(lat: float, lng: float, ds_transform: Affine, ds_crs, box_px: int) -> tuple[int, int, Affine]:
    """The box_px × box_px window of a raster around a point, on the raster's own pixel grid.

    Returns (col0, row0, src_transform): the window's top-left pixel and the affine transform
    of the window (= the dataset transform shifted by whole pixels, so it stays on the 10 m grid).
    The point falls in pixel (box_px // 2, box_px // 2) of the window.
    """
    xs, ys = transform_xy(WGS84, ds_crs, [lng], [lat])
    col, row = ~ds_transform @ (xs[0], ys[0])
    col0 = int(math.floor(col)) - box_px // 2
    row0 = int(math.floor(row)) - box_px // 2
    return col0, row0, ds_transform @ Affine.translation(col0, row0)


def mercator_grid(src_transform: Affine, src_crs, width: int, height: int) -> tuple[Affine, int, int]:
    """A north-up EPSG:3857 grid that covers the source box at about the source resolution."""
    left, bottom, right, top = array_bounds(height, width, src_transform)
    dst_transform, w, h = calculate_default_transform(src_crs, MERCATOR, width, height, left, bottom, right, top)
    return dst_transform, int(w), int(h)


def grid_bounds(dst_transform: Affine, width: int, height: int) -> tuple[float, float, float, float]:
    """(south, west, north, east) in degrees of a mercator grid's outer corners."""
    x0, y0 = dst_transform @ (0, 0)
    x1, y1 = dst_transform @ (width, height)
    lngs, lats = transform_xy(MERCATOR, WGS84, [x0, x1], [y0, y1])
    return min(lats), min(lngs), max(lats), max(lngs)


def warp_to_mercator(img: np.ndarray, src_transform: Affine, src_crs, resampling: Resampling = Resampling.bilinear,
                     dst: tuple[Affine, int, int] | None = None, valid: np.ndarray | None = None):
    """Warp a [3, H, W] picture (uint8) from its UTM grid onto a mercator grid.

    dst: (transform, width, height) of the target grid; None = make one that fits this picture.
    Pass the grid of the super-resolved picture when warping the original, so both share bounds and size.
    valid: optional [H, W] bool mask of good source pixels (False → transparent).
    Returns (rgba [H', W', 4] uint8, dst, (south, west, north, east)).
    """
    if img.ndim != 3 or img.shape[0] != 3:
        raise ValueError(f"expected [3, H, W], got {img.shape}")
    _, h, w = img.shape
    if dst is None:
        dst = mercator_grid(src_transform, src_crs, w, h)
    dst_transform, dw, dh = dst
    out = np.zeros((3, dh, dw), np.uint8)
    reproject(np.ascontiguousarray(img, np.uint8), out, src_transform=src_transform, src_crs=src_crs,
              dst_transform=dst_transform, dst_crs=MERCATOR, resampling=resampling)
    # Mask codes: 1 = good pixel, 2 = empty source pixel, 0 = outside the box (GDAL's nodata).
    mask_src = np.ones((h, w), np.uint8) if valid is None else np.where(valid, 1, 2).astype(np.uint8)
    mask = np.zeros((dh, dw), np.uint8)
    reproject(mask_src, mask, src_transform=src_transform, src_crs=src_crs, dst_transform=dst_transform,
              dst_crs=MERCATOR, resampling=Resampling.nearest, src_nodata=0, dst_nodata=0)
    good = mask == 1
    rgba = np.empty((dh, dw, 4), np.uint8)
    rgba[..., :3] = out.transpose(1, 2, 0)
    rgba[..., 3] = np.where(good, 255, 0)
    rgba[~good, :3] = 0
    return rgba, dst, grid_bounds(dst_transform, dw, dh)
