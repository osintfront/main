"""PlanetaryComputerSource reading real GeoTIFFs (written locally): the box window, the 20 m SCL
cloud share, empty pixels, tile edges, and the reflectance offset. No network."""
from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.warp import transform as transform_xy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from satsr.grid import WGS84  # noqa: E402
from satsr.source import PlanetaryComputerSource, Scene  # noqa: E402
from tests.helpers import LAT, LNG, UTM36  # noqa: E402

N10 = 600  # 6 km of 10 m pixels


def write(path, arr, transform):
    with rasterio.open(path, "w", driver="GTiff", width=arr.shape[1], height=arr.shape[0], count=1,
                       dtype=arr.dtype, crs=UTM36, transform=transform) as ds:
        ds.write(arr, 1)


class SourceReadTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = Path(tempfile.mkdtemp())
        xs, ys = transform_xy(WGS84, UTM36, [LNG], [LAT])
        # tile origin on the 60 m grid, click about in the middle
        x0 = np.floor((xs[0] - 3000) / 60) * 60
        y0 = np.ceil((ys[0] + 3000) / 60) * 60
        cls.t10 = Affine(10, 0, x0, 0, -10, y0)
        t20 = Affine(20, 0, x0, 0, -20, y0)
        dn = {"B04": 2200, "B03": 2000, "B02": 1800, "B08": 3600}  # baseline 05.xx: +1000 offset
        for b, v in dn.items():
            write(cls.dir / f"{b}.tif", np.full((N10, N10), v, np.uint16), cls.t10)
        scl = np.full((N10 // 2, N10 // 2), 4, np.uint8)  # vegetation
        c, r = ~t20 @ (xs[0], ys[0])
        c, r = int(c), int(r)
        scl[r - 64:r, c - 64:c + 64] = 9   # the top half of the 2.56 km box (128×20 m wide, 64 rows) is cloud
        write(cls.dir / "SCL.tif", scl, t20)
        cls.hrefs = {b: str(cls.dir / f"{b}.tif") for b in ("B04", "B03", "B02", "B08", "SCL")}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def scene(self, baseline="05.10"):
        return Scene("S2_LOCAL", date(2026, 11, 10), 10.0, baseline, hrefs=self.hrefs)

    def test_stats_cloud_share(self):
        st = PlanetaryComputerSource().stats(self.scene(), LAT, LNG, 256)
        self.assertTrue(st.inside)
        self.assertEqual(st.nodata, 0.0)
        self.assertAlmostEqual(st.cloud_pct, 50.0, delta=1.5)

    def test_outside_tile(self):
        st = PlanetaryComputerSource().stats(self.scene(), LAT, LNG, 1024)  # 10 km box in a 6 km tile
        self.assertFalse(st.inside)

    def test_read_harmonized(self):
        x, tr, crs, valid = PlanetaryComputerSource(harmonize=True).read(self.scene(), LAT, LNG, 256)
        self.assertEqual(x.shape, (4, 256, 256))
        self.assertEqual(x.dtype, np.float32)
        np.testing.assert_allclose(x[:, 0, 0], [0.12, 0.10, 0.08, 0.26], atol=1e-6)
        self.assertTrue(valid.all())
        self.assertEqual(crs, UTM36)
        self.assertAlmostEqual((tr.c - self.t10.c) % 10, 0)

    def test_read_raw_and_old_baseline(self):
        x, *_ = PlanetaryComputerSource(harmonize=False).read(self.scene(), LAT, LNG, 128)
        np.testing.assert_allclose(x[:, 0, 0], [0.22, 0.20, 0.18, 0.36], atol=1e-6)
        x, *_ = PlanetaryComputerSource(harmonize=True).read(self.scene("03.01"), LAT, LNG, 128)
        np.testing.assert_allclose(x[:, 0, 0], [0.22, 0.20, 0.18, 0.36], atol=1e-6)


if __name__ == "__main__":
    unittest.main()
