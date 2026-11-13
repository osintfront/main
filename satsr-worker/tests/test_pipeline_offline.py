"""A whole job without network: a fake source (synthetic box on a real UTM grid), bicubic ×4 and a
fake database. Writes the PNGs into tests/out/ so they can be looked at."""
from __future__ import annotations

import io
import sys
import unittest
from datetime import date
from pathlib import Path

import numpy as np
from rasterio.warp import transform as transform_xy

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from satsr.engines.bicubic import Bicubic  # noqa: E402
from satsr.grid import MERCATOR, WGS84, utm_window  # noqa: E402
from satsr.pipeline import Config, process  # noqa: E402
from satsr.render import PRODUCTS  # noqa: E402
from satsr.source import BoxStats, NoScene, Scene  # noqa: E402
from tests.helpers import LAT, LNG, TILE_TRANSFORM, UTM36, checkerboard  # noqa: E402

JOB = {"job_id": "11111111-2222-3333-4444-555555555555", "engine": "bicubic_x4", "lat": LAT, "lng": LNG,
       "requested_date": None, "attempt": 1}


class FakeSource:
    name = "fake"

    def __init__(self, scenes=None):
        self.scenes = scenes if scenes is not None else [Scene("S2B_FAKE_20261110", date(2026, 11, 10), 2.0, "05.10", mgrs="36RXV")]
        self.reads = 0

    def search(self, lat, lng, day, days):
        return self.scenes

    def stats(self, scene, lat, lng, box_px):
        return BoxStats(cloud_pct=1.25, nodata=0.0, inside=True)

    def read(self, scene, lat, lng, box_px):
        self.reads += 1
        _, _, tr = utm_window(lat, lng, TILE_TRANSFORM, UTM36, box_px)
        x = checkerboard(box_px, box_px)
        valid = np.ones((box_px, box_px), bool)
        return x, tr, UTM36, valid


class FakeSupabase:
    def __init__(self, resolve=None):
        self.calls = []
        self.resolve = resolve or {"merged": False, "ok": True}
        self.uploads = {}

    def rpc(self, fn, args):
        self.calls.append((fn, args))
        return self.resolve if fn == "satsr_resolve" else {"updated": True, "merged": False}

    def upload(self, bucket, path, data, content_type="image/png"):
        self.uploads[(bucket, path)] = data
        return path

    def delete(self, bucket, paths):
        self.calls.append(("delete", paths))


class SpyEngine(Bicubic):
    calls = 0

    def upscale(self, x):
        SpyEngine.calls += 1
        return super().upscale(x)


class PipelineTest(unittest.TestCase):
    def test_full_job(self):
        from PIL import Image

        cfg = Config(models_dir=HERE / "models", box_px=128)
        sb = FakeSupabase()
        out = process(JOB, cfg, FakeSource(), Bicubic(), sb)
        self.assertEqual(out["status"], "done")
        r = out["result"]
        self.assertEqual(sb.calls[0][0], "satsr_resolve")
        self.assertEqual(sb.calls[0][1]["p_scene_date"], "2026-11-10")
        self.assertEqual(r["scene_date"], "2026-11-10")
        self.assertEqual(r["cloud_pct"], 1.25)
        # ~4× pixels of a 128 px box, ~1.28 km, around the click
        self.assertTrue(500 <= r["width"] <= 560 and 500 <= r["height"] <= 560, (r["width"], r["height"]))
        self.assertTrue(r["south"] < LAT < r["north"] and r["west"] < LNG < r["east"])
        xs, ys = transform_xy(WGS84, MERCATOR, [r["west"], r["east"]], [r["south"], r["north"]])
        km = (xs[1] - xs[0]) * np.cos(np.radians(LAT)) / 1000
        self.assertTrue(1.25 < km < 1.4, km)
        # every product, before and after, all decodable RGBA PNGs of the same size
        self.assertEqual(set(r["products"]), {p.key for p in PRODUCTS})
        out_dir = HERE / "out"
        out_dir.mkdir(exist_ok=True)
        for key, paths in r["products"].items():
            self.assertEqual(paths, {"sr": f"{JOB['job_id']}/{key}_sr.png", "lr": f"{JOB['job_id']}/{key}_lr.png"})
            for which in ("sr", "lr"):
                data = out["files"][paths[which]]
                im = Image.open(io.BytesIO(data))
                self.assertEqual(im.mode, "RGBA")
                self.assertEqual(im.size, (r["width"], r["height"]))
                self.assertLess(len(data), 8 * 1024 * 1024)
                (out_dir / f"{key}_{which}.png").write_bytes(data)
        self.assertEqual(len(out["files"]), 2 * len(PRODUCTS))
        m = r["meta"]
        for k in ("source", "engine", "engine_version", "device", "seconds", "baseline", "mgrs"):
            self.assertIn(k, m)
        self.assertEqual((m["engine"], m["source"], m["mgrs"]), ("bicubic_x4", "fake", "36RXV"))

    def test_before_is_blocky_after_is_smooth(self):
        from PIL import Image

        cfg = Config(models_dir=HERE / "models", box_px=128)
        out = process(JOB, cfg, FakeSource(), Bicubic(), FakeSupabase())
        p = out["result"]["products"]["tci"]
        lr = np.asarray(Image.open(io.BytesIO(out["files"][p["lr"]])))[..., 0].astype(int)
        sr = np.asarray(Image.open(io.BytesIO(out["files"][p["sr"]])))[..., 0].astype(int)
        mid = lr.shape[0] // 2
        # nearest neighbour keeps only the two checkerboard values; bicubic makes transitions
        self.assertLessEqual(len(set(lr[mid, 100:-100].tolist())), 3)
        self.assertGreater(len(set(sr[mid, 100:-100].tolist())), 3)

    def test_merged_skips_work(self):
        SpyEngine.calls = 0
        src = FakeSource()
        sb = FakeSupabase(resolve={"merged": True, "ok": True, "into": "other"})
        out = process(JOB, Config(models_dir=HERE / "models", box_px=128), src, SpyEngine(), sb)
        self.assertEqual(out["status"], "merged")
        self.assertEqual(out["files"], {})
        self.assertEqual(SpyEngine.calls, 0)
        self.assertEqual(src.reads, 0)
        self.assertEqual(sb.uploads, {})

    def test_reclaimed_job_is_left_alone(self):
        out = process(JOB, Config(models_dir=HERE / "models", box_px=128), FakeSource(), Bicubic(),
                      FakeSupabase(resolve={"merged": False, "ok": False}))
        self.assertEqual(out["status"], "gone")

    def test_no_scene(self):
        with self.assertRaises(NoScene):
            process(JOB, Config(models_dir=HERE / "models", box_px=128), FakeSource(scenes=[]), Bicubic(), FakeSupabase())

    def test_requested_date_is_passed(self):
        seen = {}

        class DateSource(FakeSource):
            def search(self, lat, lng, day, days):
                seen["day"] = day
                return super().search(lat, lng, day, days)

        process({**JOB, "requested_date": "2026-11-10"}, Config(models_dir=HERE / "models", box_px=128), DateSource(), Bicubic(), FakeSupabase())
        self.assertEqual(seen["day"], date(2026, 11, 10))


if __name__ == "__main__":
    unittest.main()
