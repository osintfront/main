"""SEN2SR Lite really runs (needs torch, mlstac, sen2sr and the downloaded weights in models/).
Skipped otherwise — run the worker once (start.bat) to install and download, then this test."""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from satsr.engines.sen2sr_lite import weights_present  # noqa: E402

MODELS = HERE.parent / "models"
HAVE = all(importlib.util.find_spec(m) for m in ("torch", "mlstac", "sen2sr")) and weights_present(MODELS)


@unittest.skipUnless(HAVE, "torch / mlstac / sen2sr or the SEN2SR weights are not installed")
class EngineSmokeTest(unittest.TestCase):
    def test_128_to_512(self):
        from satsr.engines import get_engine
        from tests.helpers import checkerboard

        eng = get_engine("sen2sr_lite_rgbn_x4", MODELS)
        y = eng.upscale(checkerboard(128, 128))
        self.assertEqual(y.shape, (4, 512, 512))
        self.assertTrue(np.isfinite(y).all())
        self.assertLess(abs(float(y.mean()) - float(checkerboard(128, 128).mean())), 0.05)


if __name__ == "__main__":
    unittest.main()
