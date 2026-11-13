"""Products: every one renders before and after with the same stretch; PNGs decode as RGBA."""
from __future__ import annotations

import io
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from satsr.engines.bicubic import Bicubic  # noqa: E402
from satsr.render import PRODUCTS, ndvi, png_bytes  # noqa: E402
from tests.helpers import checkerboard  # noqa: E402


class RenderTest(unittest.TestCase):
    def setUp(self):
        self.lr = checkerboard(64, 64)
        self.sr = Bicubic().upscale(self.lr)
        self.by = {p.key: p for p in PRODUCTS}

    def test_product_list(self):
        self.assertEqual([p.key for p in PRODUCTS], ["tci", "irp", "ndvi"])
        self.assertEqual(len({p.key for p in PRODUCTS}), len(PRODUCTS))

    def test_every_product_before_and_after(self):
        for p in PRODUCTS:
            params = p.prepare(self.lr, 2.6)
            a, b = p.render(self.lr, params), p.render(self.sr, params)
            self.assertEqual(a.shape, (3, 64, 64), p.key)
            self.assertEqual(b.shape, (3, 256, 256), p.key)
            self.assertEqual(a.dtype, np.uint8)
            self.assertEqual(b.dtype, np.uint8)
            # same stretch: the after picture's mean colour matches the before picture's
            self.assertLess(np.abs(a.reshape(3, -1).mean(1) - b.reshape(3, -1).mean(1)).max(), 6, p.key)
            self.assertGreater(int(a.max()) - int(a.min()), 40, f"{p.key} has contrast")

    def test_true_colour_gain(self):
        p = self.by["tci"]
        img = p.render(self.lr, p.prepare(self.lr, 2.6))
        self.assertEqual(int(img[0, 0, 0]), round(0.04 * 2.6 * 255))   # vegetated block, red
        self.assertEqual(int(img[0, 0, 16]), round(0.22 * 2.6 * 255))  # bare block, red

    def test_infrared_vegetation_is_red(self):
        p = self.by["irp"]
        img = p.render(self.lr, p.prepare(self.lr, 2.6)).astype(int)
        veg, bare = img[:, 0, 0], img[:, 0, 16]
        self.assertGreater(veg[0], veg[1] + 100)   # NIR → red channel dominates
        self.assertGreater(bare[1], veg[1])        # bare soil: more red band → more green channel

    def test_ndvi_ramp(self):
        v = ndvi(self.lr)
        self.assertAlmostEqual(float(v[0, 0]), (0.45 - 0.04) / 0.49, places=4)
        p = self.by["ndvi"]
        img = p.render(self.lr, p.prepare(self.lr, 2.6)).astype(int)
        self.assertGreater(img[1, 0, 0], img[0, 0, 0])   # vegetation green
        water = np.zeros((4, 2, 2), np.float32)
        water[0], water[3] = 0.05, 0.01
        w = p.render(water, {}).astype(int)
        self.assertGreater(w[2, 0, 0], w[0, 0, 0])       # water blue
        self.assertTrue(np.isfinite(ndvi(np.zeros((4, 3, 3), np.float32))).all())

    def test_png(self):
        from PIL import Image

        rgba = np.zeros((40, 50, 4), np.uint8)
        rgba[..., 0] = 200
        rgba[10:, :, 3] = 255
        im = Image.open(io.BytesIO(png_bytes(rgba)))
        self.assertEqual(im.mode, "RGBA")
        self.assertEqual(im.size, (50, 40))
        self.assertEqual(im.getpixel((0, 0))[3], 0)
        with self.assertRaises(ValueError):
            png_bytes(rgba[..., :3])


if __name__ == "__main__":
    unittest.main()
