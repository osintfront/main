"""Full pipeline without network: synthetic terrain, stubbed downloads and a fake Claude.
Run:  python -m tests.test_pipeline_offline   → writes board PNGs into tests/out/"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from geoloc import pipeline  # noqa: E402
from geoloc.dem import LocalDEM  # noqa: E402
from geoloc.horizon import Camera, horizon, distance_samples  # noqa: E402
from tests.test_synthetic import render_photo  # noqa: E402


class FakeVision:
    scene_model = "fake"

    def __init__(self, target_px):
        self.t = target_px

    def triage(self, img):
        return {"usable": True, "reason": "test"}

    def scene(self, img, text, places):
        return {"has_skyline": True, "target": {"x": self.t[0], "y": self.t[1], "label": "smoke column base"},
                "integrity": "ok", "integrity_reason": "", "overlays": [], "model": "fake"}


def main():
    dem = LocalDEM.synthetic(half_km=56, seed=3)
    g = np.arange(-3500, 3501, 250.0)
    gx, gy = np.meshgrid(g, g)
    i = np.unravel_index(np.argmax(dem.height(gx, gy)), gx.shape)
    x0, y0 = float(gx[i]) + 37, float(gy[i]) - 53
    zc = float(dem.height(np.array(x0), np.array(y0))) + 2
    az = np.arange(0, 360, 1.0)
    _, dd = horizon(dem, x0, y0, zc, az, distance_samples(60, 50000, 760))
    heading = float(az[np.argmax(np.convolve(dd, np.ones(19) / 19, mode="same"))])
    truth = Camera(1600, 1000, x0, y0, 2.0, heading, 18.0, -1.5, 0.8)
    img, _ = render_photo(dem, truth)
    ok, jpg = cv2.imencode(".jpg", img)

    pipeline.download = lambda url, **k: jpg.tobytes()
    pipeline.LocalDEM.from_copernicus = classmethod(lambda cls, *a, **k: dem)
    lat, lng = (float(a) for a in dem.to_latlon(0, 0))
    job = {"job_id": "test", "event": {"id": "e1", "title": "Strike reported near a hilltop village",
            "latitude": lat, "longitude": lng, "location_name": "Test village", "locations": []},
           "media": {"public_url": "https://example.invalid/a.jpg"}, "video": None}
    out = pipeline.process(job, pipeline.Config(cache_dir=Path("cache"), radius_km=6), FakeVision((800, 700)))
    r = out["result"]
    cx, cy = dem.to_xy(r["camera_lat"], r["camera_lng"])
    print(out["status"], r["confidence"], f"camera error {math.hypot(cx - x0, cy - y0):.0f} m",
          f"target {r['target_lat']:.5f},{r['target_lng']:.5f}", r["details"]["notes"])
    od = Path(__file__).parent / "out"
    od.mkdir(exist_ok=True)
    for k, png in out["boards"].items():
        (od / f"board_{k}.png").write_bytes(png)
    print("boards written to", od)


if __name__ == "__main__":
    main()
