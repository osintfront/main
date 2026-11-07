"""Find the camera: coarse search over positions × fields of view × headings, then
least-squares refinement, a held-out check and an ambiguity test.

Coarse step, per candidate position: render the full 360° horizon once, then for
every field of view slide the photo's skyline around it. The slide is done with
FFT correlations, with a free vertical offset (pitch) and a free linear tilt
(roll) solved in closed form, so every heading is scored in one pass.
"""
from __future__ import annotations

import logging
import math
import os
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, asdict

import numpy as np
from scipy.optimize import least_squares

from .dem import LocalDEM
from .horizon import Camera, horizon, distance_samples, raycast

log = logging.getLogger("geoloc.solve")

FOVS = np.geomspace(1.5, 75.0, 24)
COARSE_RES = 0.05  # degrees per profile sample
CAM_AGL = 2.0
MAX_VIEW = 50_000.0  # metres; skylines further than this are rare and get hazy


@dataclass
class Solution:
    x: float
    y: float
    h: float
    heading: float
    hfov: float
    pitch: float
    roll: float
    fit_rms_px: float = math.inf
    holdout_rms_px: float = math.inf
    coarse_rms_px: float = math.inf

    def camera(self, W, H) -> Camera:
        return Camera(W, H, self.x, self.y, self.h, self.heading, self.hfov, self.pitch, self.roll)


# ── coarse ──────────────────────────────────────────────────────────────
_G: dict = {}


def _init(dem: LocalDEM, W: int, H: int, u: np.ndarray, v: np.ndarray, res: float, dmin: float = 120.0):
    # Terrain closer than ~1.5 grid steps can't be resolved by the coarse grid, so the
    # coarse render skips it; refinement puts it back.
    _G.update(dem=dem, W=W, H=H, u=u, v=v, res=res,
              dists=distance_samples(dmin, MAX_VIEW, 320),
              az=np.arange(0.0, 360.0, res), templates=_templates(W, H, u, v, res))


def _templates(W, H, u, v, res):
    """Photo skyline resampled onto the profile grid, one per field of view."""
    out = []
    N = int(round(360.0 / res))
    for fov in FOVS:
        cam = Camera(W, H, 0, 0, 0, 0.0, fov, 0.0, 0.0)
        az, el = cam.rays(u, v)
        lo = az.min()
        n = int(math.floor((az.max() - lo) / res)) + 1
        if n < 8 or n >= N // 2:
            continue
        grid = lo + np.arange(n) * res
        p = np.interp(grid, az, el)
        # weight 0 where the photo has a gap wider than ~3 columns' worth of angle
        gap = np.interp(grid, az[:-1], np.diff(az)) if len(az) > 1 else np.zeros(n)
        colstep = np.median(np.diff(az)) if len(az) > 1 else res
        w = (gap <= max(3 * colstep, 1.5 * res)).astype(float)
        t = np.arange(n, dtype=float)
        t -= (w * t).sum() / w.sum()
        f = (W / 2) / math.tan(math.radians(fov) / 2)
        pad = lambda a: np.concatenate([a, np.zeros(N - n)])
        out.append(dict(fov=fov, lo=lo, n=n, f=f,
                        Fw=np.conj(np.fft.rfft(pad(w))), Fwp=np.conj(np.fft.rfft(pad(w * p))),
                        Fwt=np.conj(np.fft.rfft(pad(w * t))),
                        D=w.sum(), Sp=(w * p).sum(), A=(w * p * p).sum(), Tp=(w * t * p).sum(), Tt=(w * t * t).sum()))
    return out


def _score_position(xy):
    dem: LocalDEM = _G["dem"]
    x, y = xy
    zc = float(dem.height(np.array(x), np.array(y))) + CAM_AGL
    m, _ = horizon(dem, x, y, zc, _G["az"], _G["dists"])
    N = len(m)
    Fm, Fm2 = np.fft.rfft(m), np.fft.rfft(m * m)
    best = (math.inf, None)
    for T in _G["templates"]:
        B = np.fft.irfft(T["Fwp"] * Fm, N)
        Cm = np.fft.irfft(T["Fw"] * Fm, N)
        Cmm = np.fft.irfft(T["Fw"] * Fm2, N)
        Tm = np.fft.irfft(T["Fwt"] * Fm, N)
        c = (T["Sp"] - Cm) / T["D"]
        res = T["A"] - 2 * B + Cmm - T["D"] * c * c - (T["Tp"] - Tm) ** 2 / T["Tt"]
        res = np.maximum(res, 0)
        h = int(np.argmin(res))
        px = math.sqrt(res[h] / T["D"]) * T["f"]
        if px < best[0]:
            heading = (h * _G["res"] - T["lo"]) % 360.0
            pitch = -math.degrees(c[h])
            best = (px, (x, y, heading, T["fov"], pitch))
    return best


def _run(ex, pts, label):
    """Score positions, logging progress about every 10 % (a job can take minutes)."""
    out, n, nxt, t0 = [], len(pts), 0.1, time.time()
    it = ex.map(_score_position, pts, chunksize=16) if ex else map(_score_position, pts)
    for i, r in enumerate(it, 1):
        out.append(r)
        if i / n >= nxt and n > 50:
            el = time.time() - t0
            log.info("%s: %d/%d positions (%.0f%%), ~%.0fs left", label, i, n, 100 * i / n, el / i * (n - i))
            nxt += 0.1
    return out


def coarse_search(dem: LocalDEM, W, H, u, v, center_xy, radius_m, step_m=None, workers=None):
    """Two passes: a grid at twice the step over the whole area, then the full step
    around the most promising spots. About 3x fewer positions than one fine grid."""
    step_m = step_m or max(200.0, radius_m / 40.0)
    cx, cy = center_xy
    g = np.arange(-radius_m, radius_m + 1, 2 * step_m)
    gx, gy = np.meshgrid(g + cx, g + cy)
    keep = (np.hypot(gx - cx, gy - cy) <= radius_m) & dem.inside(gx, gy, 2000)
    pts = list(zip(gx[keep].tolist(), gy[keep].tolist()))
    workers = workers or max(1, (os.cpu_count() or 2) - 1)
    log.info("terrain search: %d positions (%.0f m grid), %d CPU processes", len(pts), 2 * step_m, workers)
    args = (dem, W, H, u, v, COARSE_RES, 1.5 * step_m)
    ex = None
    if workers > 1:
        ex = ProcessPoolExecutor(workers, initializer=_init, initargs=args)
    else:
        _init(*args)
    try:
        first = [(px, p) for px, p in _run(ex, pts, "pass 1") if p is not None]
        first.sort(key=lambda r: r[0])
        seen = {(round(x), round(y)) for x, y in pts}
        extra = []
        for _, (x, y, *_r) in first[:40]:
            for dx in (-step_m, 0.0, step_m):
                for dy in (-step_m, 0.0, step_m):
                    q = (x + dx, y + dy)
                    key = (round(q[0]), round(q[1]))
                    if key in seen or math.hypot(q[0] - cx, q[1] - cy) > radius_m or not dem.inside(q[0], q[1], 2000):
                        continue
                    seen.add(key)
                    extra.append(q)
        log.info("terrain search pass 2: %d positions (%.0f m grid) around the best spots", len(extra), step_m)
        second = [(px, p) for px, p in _run(ex, extra, "pass 2") if p is not None]
    finally:
        if ex:
            ex.shutdown()
    out = first + second
    out.sort(key=lambda r: r[0])
    return out, step_m


def pick_candidates(coarse, k=30, sep_m=700.0):
    chosen = []
    for px, (x, y, hd, fov, pitch) in coarse:
        if all(math.hypot(x - c[1][0], y - c[1][1]) > sep_m or abs(math.log(fov / c[1][3])) > 0.4 for c in chosen):
            chosen.append((px, (x, y, hd, fov, pitch)))
        if len(chosen) >= k:
            break
    return chosen


# ── refine ──────────────────────────────────────────────────────────────
REFINE_DISTS = distance_samples(60.0, MAX_VIEW, 760)


def residuals(params, dem, W, H, u, v):
    x, y, h, hd, fov, pitch, roll = params
    cam = Camera(W, H, x, y, h, hd, fov, pitch, roll)
    zc = float(dem.height(np.array(x), np.array(y))) + h
    az, el = cam.rays(u, v)
    m, _ = horizon(dem, x, y, zc, az, REFINE_DISTS)
    return (el - m) * cam.f


def refine(dem: LocalDEM, W, H, u, v, start: Solution, xy_box: float) -> Solution:
    p0 = np.array([start.x, start.y, start.h, start.heading, start.hfov, start.pitch, start.roll])
    lo = np.array([start.x - xy_box, start.y - xy_box, 1.5, start.heading - 8, start.hfov * 0.6, -35, -20])
    hi = np.array([start.x + xy_box, start.y + xy_box, 80.0, start.heading + 8, start.hfov * 1.6, 35, 20])
    lim = dem.half - 1500
    lo[:2] = np.maximum(lo[:2], -lim)
    hi[:2] = np.minimum(hi[:2], lim)
    p0 = np.clip(p0, lo + 1e-6, hi - 1e-6)
    r = least_squares(residuals, p0, bounds=(lo, hi), args=(dem, W, H, u, v),
                      x_scale=np.array([60, 60, 5, 0.05, max(0.02, start.hfov * 0.01), 0.05, 0.1]),
                      diff_step=np.array([1e-3, 1e-3, 1e-2, 1e-5, 1e-4, 1e-4, 1e-3]),
                      loss="soft_l1", f_scale=3.0, max_nfev=250)
    x, y, h, hd, fov, pitch, roll = r.x
    rms = float(np.sqrt(np.mean(r.fun ** 2)))
    return Solution(x, y, h, hd % 360.0, fov, pitch, roll, fit_rms_px=rms, coarse_rms_px=start.coarse_rms_px)


def holdout_split(u, v, frac=0.2):
    """Hold out the contiguous block with the most relief (the hardest part to fit by luck)."""
    n = len(u)
    k = max(6, int(n * frac))
    best, s = -1.0, 0
    for i in range(0, n - k + 1, max(1, k // 4)):
        sd = float(np.std(v[i:i + k]))
        if sd > best:
            best, s = sd, i
    mask = np.zeros(n, bool)
    mask[s:s + k] = True
    return ~mask, mask


@dataclass
class Result:
    best: Solution
    alternatives: list
    ambiguity_ratio: float
    camera_spread_m: float
    confidence: str
    notes: list

    def as_dict(self):
        return dict(best=asdict(self.best), alternatives=[asdict(a) for a in self.alternatives[:5]],
                    ambiguity_ratio=self.ambiguity_ratio, camera_spread_m=self.camera_spread_m,
                    confidence=self.confidence, notes=self.notes)


def solve(dem: LocalDEM, W, H, u, v, center_xy, radius_m, relief_frac, workers=None, n_refine=12) -> Result:
    coarse, step = coarse_search(dem, W, H, u, v, center_xy, radius_m, workers=workers)
    if not coarse:
        raise RuntimeError("no candidate positions (search area off the elevation grid?)")
    cands = pick_candidates(coarse, k=n_refine)
    fit_m, hold_m = holdout_split(u, v)
    sols = []
    for px, (x, y, hd, fov, pitch) in cands:
        s0 = Solution(x, y, CAM_AGL, hd, fov, pitch, 0.0, coarse_rms_px=px)
        try:
            s = refine(dem, W, H, u[fit_m], v[fit_m], s0, xy_box=step * 1.5)
        except Exception as e:  # noqa: BLE001 - keep going with other candidates
            log.warning("refine failed: %s", e)
            continue
        s.holdout_rms_px = float(np.sqrt(np.mean(residuals(
            [s.x, s.y, s.h, s.heading, s.hfov, s.pitch, s.roll], dem, W, H, u[hold_m], v[hold_m]) ** 2)))
        sols.append(s)
    if not sols:
        raise RuntimeError("refinement failed for every candidate")
    sols.sort(key=lambda s: s.fit_rms_px + 0.5 * s.holdout_rms_px)
    best = sols[0]
    far = [s for s in sols[1:] if math.hypot(s.x - best.x, s.y - best.y) > 1500]
    ratio = (far[0].fit_rms_px + 0.5 * far[0].holdout_rms_px) / max(1e-6, best.fit_rms_px + 0.5 * best.holdout_rms_px) if far else 9.99
    near = [s for s in sols if math.hypot(s.x - best.x, s.y - best.y) <= 1500 and s.fit_rms_px <= best.fit_rms_px * 1.3 + 0.5]
    spread = max(math.hypot(s.x - best.x, s.y - best.y) for s in near) if near else 0.0

    # Skyline extraction is good to ~1-2 px, so a right answer fits at about that level.
    tol = max(1.2, 0.001 * W)
    notes = []
    edge = math.hypot(best.x - center_xy[0], best.y - center_xy[1]) > radius_m - 1.5 * step
    if edge:
        notes.append("best fit is at the edge of the search area; the camera may be further out")
    if relief_frac < 0.03:
        notes.append("skyline has little relief; fits are weakly constrained")
    if ratio < 1.4:
        km = round(math.hypot(far[0].x - best.x, far[0].y - best.y) / 1000, 1)
        notes.append(f"another position {km} km away fits almost as well")
    if best.holdout_rms_px > 3 * tol:
        notes.append("held-out part of the skyline does not agree")
    if edge:
        conf = "low"
    elif best.fit_rms_px <= tol and best.holdout_rms_px <= 2 * tol and ratio >= 2.0 and relief_frac >= 0.03:
        conf = "high"
    elif best.fit_rms_px <= 1.6 * tol and best.holdout_rms_px <= 3 * tol and ratio >= 1.5 and relief_frac >= 0.02:
        conf = "medium"
    else:
        conf = "low"
    return Result(best, sols, round(float(min(ratio, 9.99)), 2), round(float(spread), 1), conf, notes)


def locate_pixel(dem: LocalDEM, sol: Solution, W, H, u, v):
    cam = sol.camera(W, H)
    az, el = cam.rays(np.array([u]), np.array([v]))
    zc = float(dem.height(np.array(sol.x), np.array(sol.y))) + sol.h
    return raycast(dem, sol.x, sol.y, zc, float(az[0]), float(el[0]))
