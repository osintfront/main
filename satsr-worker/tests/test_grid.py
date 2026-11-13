"""Geometry: the 10 m window, and the mercator warp that makes Leaflet's overlay exact."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np
from affine import Affine
from rasterio.warp import Resampling, transform as transform_xy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from satsr.grid import MERCATOR, WGS84, cell_center, grid_bounds, snap_cell, utm_window, warp_to_mercator  # noqa: E402
from tests.helpers import LAT, LNG, TILE_TRANSFORM, UTM36  # noqa: E402


def to_merc(lat, lng):
    xs, ys = transform_xy(WGS84, MERCATOR, [lng], [lat])
    return xs[0], ys[0]


class GridTest(unittest.TestCase):
    def test_cells(self):
        self.assertEqual(snap_cell(31.5, 34.45), (6890, 6300))
        self.assertEqual(snap_cell(31.5024, 34.4476), (6890, 6300))
        self.assertEqual(snap_cell(-0.0026, -0.0026), (-1, -1))
        self.assertEqual(cell_center(6890, 6300), (31.5, 34.45))

    def test_window_on_10m_grid_and_contains_click(self):
        col0, row0, tr = utm_window(LAT, LNG, TILE_TRANSFORM, UTM36, 256)
        # whole-pixel shift of the tile grid
        self.assertAlmostEqual((tr.c - TILE_TRANSFORM.c) % 10.0, 0.0, places=6)
        self.assertAlmostEqual((tr.f - TILE_TRANSFORM.f) % 10.0, 0.0, places=6)
        self.assertEqual((tr.a, tr.e), (10.0, -10.0))
        xs, ys = transform_xy(WGS84, UTM36, [LNG], [LAT])
        c, r = ~tr * (xs[0], ys[0])
        self.assertTrue(128 <= c < 129 and 128 <= r < 129, (c, r))

    def _bright_pixel_case(self, scale: int):
        col0, row0, tr = utm_window(LAT, LNG, TILE_TRANSFORM, UTM36, 256)
        tr = tr * Affine.scale(1 / scale)
        n = 256 * scale
        img = np.zeros((3, n, n), np.uint8)
        xs, ys = transform_xy(WGS84, UTM36, [LNG], [LAT])
        c, r = ~tr * (xs[0], ys[0])
        img[:, int(r), int(c)] = 255
        rgba, dst, bounds = warp_to_mercator(img, tr, UTM36, Resampling.nearest)
        dtr, w, h = dst
        rr, cc = np.nonzero(rgba[..., 0] > 0)
        self.assertGreater(len(rr), 0)
        px, py = dtr * (cc.mean() + 0.5, rr.mean() + 0.5)
        tx, ty = to_merc(LAT, LNG)
        res = abs(dtr.a)
        self.assertLess(abs(px - tx), 1.5 * res)
        self.assertLess(abs(py - ty), 1.5 * res)
        return rgba, dst, bounds

    def test_bright_pixel_lands_on_true_point(self):
        self._bright_pixel_case(1)
        self._bright_pixel_case(4)

    def test_bounds_are_grid_corners(self):
        _, dst, (s, w, n, e) = self._bright_pixel_case(1)
        dtr, dw, dh = dst
        self.assertEqual((s, w, n, e), grid_bounds(dtr, dw, dh))
        x0, y0 = to_merc(n, w)
        x1, y1 = to_merc(s, e)
        self.assertAlmostEqual(x0, dtr.c, delta=1e-3)
        self.assertAlmostEqual(y0, dtr.f, delta=1e-3)
        self.assertAlmostEqual(x1, dtr.c + dw * dtr.a, delta=1e-3)
        self.assertAlmostEqual(y1, dtr.f + dh * dtr.e, delta=1e-3)
        self.assertEqual(dtr.b, 0.0)
        self.assertEqual(dtr.d, 0.0)
        # ~2.56 km box (mercator stretches by 1/cos(lat))
        self.assertTrue(2.5 < (x1 - x0) * np.cos(np.radians(LAT)) / 1000 < 2.75)
        self.assertTrue(s < LAT < n and w < LNG < e)

    def test_original_and_sr_share_grid(self):
        col0, row0, tr = utm_window(LAT, LNG, TILE_TRANSFORM, UTM36, 256)
        lr = np.full((3, 256, 256), 100, np.uint8)
        sr = np.full((3, 1024, 1024), 100, np.uint8)
        a, dst, b1 = warp_to_mercator(sr, tr * Affine.scale(0.25), UTM36, Resampling.cubic)
        b, dst2, b2 = warp_to_mercator(lr, tr, UTM36, Resampling.nearest, dst)
        self.assertEqual(a.shape, b.shape)
        self.assertEqual(dst, dst2)
        self.assertEqual(b1, b2)
        self.assertTrue(1000 <= a.shape[0] <= 1100 and 1000 <= a.shape[1] <= 1100, a.shape)

    def test_alpha_corners_transparent_inside_opaque(self):
        col0, row0, tr = utm_window(LAT, LNG, TILE_TRANSFORM, UTM36, 256)
        img = np.full((3, 256, 256), 80, np.uint8)
        rgba, _, _ = warp_to_mercator(img, tr, UTM36, Resampling.nearest)
        h, w = rgba.shape[:2]
        # UTM zone 36 at 34.45°E is ~0.6° off the central meridian: the box is turned a little
        self.assertTrue(any(rgba[y, x, 3] == 0 for y, x in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1))))
        self.assertEqual(rgba[h // 2, w // 2, 3], 255)
        self.assertTrue((rgba[h // 4:3 * h // 4, w // 4:3 * w // 4, 3] == 255).all())
        self.assertTrue((rgba[rgba[..., 3] == 0][:, :3] == 0).all())

    def test_valid_mask_makes_holes(self):
        col0, row0, tr = utm_window(LAT, LNG, TILE_TRANSFORM, UTM36, 256)
        img = np.full((3, 256, 256), 80, np.uint8)
        valid = np.ones((256, 256), bool)
        valid[100:150, 100:150] = False
        rgba, _, _ = warp_to_mercator(img, tr, UTM36, Resampling.nearest, valid=valid)
        h, w = rgba.shape[:2]
        self.assertEqual(rgba[int(h * 125 / 256), int(w * 125 / 256), 3], 0)


if __name__ == "__main__":
    unittest.main()
