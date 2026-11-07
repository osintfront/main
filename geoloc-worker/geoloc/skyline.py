"""Extract the sky/terrain boundary from a photo.

Classical method, no ML model to install: estimate the sky colour from the top
rows, measure each pixel's distance from it plus local texture, threshold with
Otsu, and take the first persistent non-sky run in every column. Columns whose
top is already non-sky (a pole, a roof, a tree) are dropped. Works for hazy
distant ridges too, because the threshold adapts to each photo.

Returns v (float row per column, NaN where unknown) for the full image width.
"""
from __future__ import annotations

import cv2
import numpy as np
from scipy.ndimage import median_filter


def extract(img_bgr: np.ndarray, min_run: int = 6) -> np.ndarray:
    H, W = img_bgr.shape[:2]
    scale = 1.0
    if W > 1600:
        scale = 1600.0 / W
        img = cv2.resize(img_bgr, (int(W * scale), int(H * scale)), interpolation=cv2.INTER_AREA)
    else:
        img = img_bgr
    h, w = img.shape[:2]
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab = cv2.GaussianBlur(lab, (5, 5), 0)

    top = lab[: max(3, h // 25)]
    sky = np.median(top.reshape(-1, 3), axis=0)
    dist = np.linalg.norm(lab - sky, axis=2)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    tex = cv2.GaussianBlur(np.abs(cv2.Laplacian(gray, cv2.CV_32F)), (7, 7), 0)
    score = dist / (np.percentile(dist, 99) + 1e-6) + 0.6 * tex / (np.percentile(tex, 99) + 1e-6)
    s8 = np.clip(score / (score.max() + 1e-6) * 255, 0, 255).astype(np.uint8)
    thr, _ = cv2.threshold(s8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    ground = s8 > thr
    # The top band must read as sky, otherwise there is no skyline to use.
    v = np.full(w, np.nan)
    for c in range(w):
        col = ground[:, c]
        if col[: max(2, h // 50)].mean() > 0.5:
            continue
        run = np.convolve(col.astype(np.int8), np.ones(min_run, np.int8), mode="valid")
        idx = np.nonzero(run >= min_run)[0]
        if len(idx):
            r = idx[0]
            # sub-pixel: step to where the score crosses the threshold
            v[c] = r
    ok = ~np.isnan(v)
    if ok.sum() > 10:
        vm = v.copy()
        vm[~ok] = np.interp(np.nonzero(~ok)[0], np.nonzero(ok)[0], v[ok]) if (~ok).any() else vm[~ok]
        sm = median_filter(vm, size=9, mode="nearest")
        bad = np.abs(v - sm) > max(4.0, h * 0.01)  # isolated spikes (birds, wires)
        v[bad] = np.nan
        v[ok & ~bad] = sm[ok & ~bad]
    if scale != 1.0:
        xs = np.arange(W) * scale
        good = ~np.isnan(v)
        if not good.any():
            return np.full(W, np.nan)
        filled = np.interp(np.arange(w), np.nonzero(good)[0], v[good])
        keep = np.interp(xs, np.arange(w), good.astype(float)) > 0.99
        v = np.where(keep, np.interp(xs, np.arange(w), filled) / scale, np.nan)
    return v


def subsample(v: np.ndarray, n: int = 240):
    """Pick ~n evenly spaced valid columns → (u, v) arrays."""
    u = np.nonzero(~np.isnan(v))[0]
    if len(u) == 0:
        return u.astype(float), u.astype(float)
    if len(u) > n:
        u = u[np.linspace(0, len(u) - 1, n).astype(int)]
    return u.astype(float), v[u].astype(float)


def quality(v: np.ndarray, H: int) -> dict:
    ok = ~np.isnan(v)
    cover = float(ok.mean())
    relief = 0.0
    if ok.sum() > 5:
        # relief after removing a straight line: a tilted horizon (camera roll) carries no information
        u = np.nonzero(ok)[0].astype(float)
        resid = v[ok] - np.polyval(np.polyfit(u, v[ok], 1), u)
        relief = float(np.percentile(resid, 95) - np.percentile(resid, 5))
    return {"coverage": round(cover, 3), "relief_px": round(relief, 1), "relief_frac": round(relief / H, 4)}
