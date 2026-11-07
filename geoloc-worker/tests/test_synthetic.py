"""Known-answer test on synthetic terrain: render what a camera sees, hide the
answer, and check the solver finds the camera again.

Run:  python -m tests.test_synthetic      (from the geoloc-worker folder)
"""
from __future__ import annotations

import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from geoloc.dem import LocalDEM  # noqa: E402
from geoloc.horizon import Camera, horizon, distance_samples  # noqa: E402
from geoloc import skyline, solve  # noqa: E402


def render_photo(dem, cam: Camera):
    """A flat-colour photo: sky above the rendered horizon, textured ground below."""
    import cv2
    u = np.arange(cam.W, dtype=float)
    zc = float(dem.height(np.array(cam.x), np.array(cam.y))) + cam.h
    # find the skyline row per column by projecting the horizon
    az, _ = cam.rays(u, np.full_like(u, cam.H / 2))
    m, _ = horizon(dem, cam.x, cam.y, zc, az, distance_samples(60, 50000, 760))
    _, vrow = cam.project(az, m)
    img = np.zeros((cam.H, cam.W, 3), np.uint8)
    rows = np.arange(cam.H)[:, None]
    sky = rows < vrow[None, :]
    rng = np.random.default_rng(0)
    img[...] = (90, 120, 95)  # BGR ground
    img = (img + rng.integers(-25, 25, img.shape)).clip(0, 255).astype(np.uint8)
    img[sky] = (225, 200, 175)  # pale blue sky
    img = cv2.GaussianBlur(img, (3, 3), 0)
    return img, vrow


def main():
    dem = LocalDEM.synthetic(half_km=20, seed=3)
    # Like a real usable photo: taken from high ground, looking at ridges kilometres away.
    g = np.arange(-3500, 3501, 250.0)
    gx, gy = np.meshgrid(g, g)
    z = dem.height(gx, gy)
    i = np.unravel_index(np.argmax(z), z.shape)
    x0, y0 = float(gx[i]) + 37.0, float(gy[i]) - 53.0
    zc = float(dem.height(np.array(x0), np.array(y0))) + 2
    az = np.arange(0, 360, 1.0)
    m, dd = horizon(dem, x0, y0, zc, az, distance_samples(60, 50000, 760))
    sm = np.convolve(dd, np.ones(19) / 19, mode="same")
    heading = float(az[np.argmax(sm)])
    truth = Camera(1600, 1000, x=x0, y=y0, h=2.0, heading=heading, hfov=18.0, pitch=-1.5, roll=0.8)
    print(f"truth: x={x0:.0f} y={y0:.0f} heading={heading} median skyline distance {np.median(dd[np.abs((az-heading+180)%360-180)<9])/1000:.1f} km")
    img, vtrue = render_photo(dem, truth)
    v = skyline.extract(img)
    err = np.nanmedian(np.abs(v - vtrue))
    print(f"skyline extraction: median error {err:.2f} px, coverage {np.mean(~np.isnan(v)):.2f}")
    assert err < 2.5, "skyline extraction drifted"
    u, vv = skyline.subsample(v, 220)
    q = skyline.quality(v, truth.H)
    t0 = time.time()
    res = solve.solve(dem, truth.W, truth.H, u, vv, center_xy=(0.0, 0.0), radius_m=6000, relief_frac=q["relief_frac"])
    b = res.best
    d = math.hypot(b.x - truth.x, b.y - truth.y)
    print(f"solved in {time.time() - t0:.0f}s: camera error {d:.0f} m, heading {b.heading:.2f} (true {truth.heading}),"
          f" fov {b.hfov:.2f} (true {truth.hfov}), fit {b.fit_rms_px:.2f} px, holdout {b.holdout_rms_px:.2f} px,"
          f" ambiguity {res.ambiguity_ratio}, confidence {res.confidence}")
    # target: centre pixel should ray-cast to the same ground point the true camera sees there
    hit_true = solve.locate_pixel(dem, solve.Solution(truth.x, truth.y, truth.h, truth.heading, truth.hfov, truth.pitch, truth.roll),
                                  truth.W, truth.H, 800, 700)
    hit = solve.locate_pixel(dem, b, truth.W, truth.H, 800, 700)
    if hit and hit_true:
        print(f"target error {math.hypot(hit[0] - hit_true[0], hit[1] - hit_true[1]):.0f} m at {hit_true[3] / 1000:.1f} km")
    assert d < 250, "camera not recovered"
    assert abs((b.heading - truth.heading + 180) % 360 - 180) < 0.5
    print("PASS")


if __name__ == "__main__":
    main()
