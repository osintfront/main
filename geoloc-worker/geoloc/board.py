"""Proof boards (PNG). Two versions per job: 'full' shows the camera; 'target'
leaves the camera out (for subscribers until staff release the camera point)."""
from __future__ import annotations

import io
import math

import cv2
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LightSource  # noqa: E402

from .dem import LocalDEM  # noqa: E402
from .horizon import horizon, distance_samples  # noqa: E402

BG, FG, DIM = "#121212", "#ededed", "#9a9a9a"
CYAN, ORANGE, PINK, RED = "#3ec7f0", "#f5a623", "#ff4f9a", "#ff3b3b"
DEM_CREDIT = ("Elevation: Copernicus GLO-30 (© DLR e.V. 2010-2014, © Airbus Defence and Space GmbH 2014-2018, "
              "provided under COPERNICUS by the EU and ESA).")


def _fmt(lat, lng):
    return f"{lat:.5f}° N, {lng:.5f}° E"


def render(dem: LocalDEM, img_bgr, v_sky, sol, cam_latlon, target, place_xy, info: dict, show_camera: bool) -> bytes:
    H, W = img_bgr.shape[:2]
    fig = plt.figure(figsize=(12, 15), dpi=110, facecolor=BG)
    gs = fig.add_gridspec(3, 2, height_ratios=[1.05, 1.15, 0.55], hspace=0.28, wspace=0.08,
                          left=0.05, right=0.95, top=0.9, bottom=0.07)
    fig.text(0.05, 0.955, info.get("title") or "Terrain geolocation", color=FG, fontsize=22, weight="bold")
    fig.text(0.05, 0.935, (info.get("subtitle") or "").upper(), color=DIM, fontsize=10, family="monospace")
    fig.text(0.95, 0.955, "OSINTFRONT · PROOF BOARD", color=DIM, fontsize=9, family="monospace", ha="right")

    # 01 photo + skyline overlay
    ax = fig.add_subplot(gs[0, :])
    ax.imshow(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    u = np.arange(W)
    ax.plot(u, v_sky, ".", color=CYAN, ms=1.2, alpha=0.8, label="skyline in the photo")
    if sol is not None:
        cam = sol.camera(W, H)
        zc = float(dem.height(np.array(sol.x), np.array(sol.y))) + sol.h
        uu = np.linspace(0, W - 1, 400)
        az, _ = cam.rays(uu, np.full_like(uu, H / 2))
        m, _ = horizon(dem, sol.x, sol.y, zc, az, distance_samples(60, 50000, 760))
        _, vm = cam.project(az, m)
        ax.plot(uu, vm, "-", color=ORANGE, lw=1.4, label="terrain skyline from the solved camera")
    if target and target.get("px"):
        tx, ty = target["px"]
        ax.plot([tx], [ty], "o", mfc="none", mec=PINK, ms=14, mew=2)
        ax.text(tx + 12, ty - 12, "T", color=PINK, fontsize=12, weight="bold")
    ax.set_xlim(0, W)
    ax.set_ylim(H, 0)
    ax.axis("off")
    ax.set_title("01  PHOTO — detected skyline vs. terrain model", color=FG, loc="left", fontsize=11, family="monospace")
    leg = ax.legend(loc="lower left", fontsize=8, facecolor=BG, edgecolor=DIM)
    for t in leg.get_texts():
        t.set_color(FG)

    # 02 map
    axm = fig.add_subplot(gs[1, :])
    pts = [p for p in [place_xy, target.get("xy") if target else None, (sol.x, sol.y) if (sol and show_camera) else None] if p]
    cx = np.mean([p[0] for p in pts]) if pts else 0.0
    cy = np.mean([p[1] for p in pts]) if pts else 0.0
    span = max([3000.0] + [1.3 * abs(p[0] - cx) for p in pts] + [1.3 * abs(p[1] - cy) / 0.55 for p in pts])
    xs = np.linspace(cx - span, cx + span, 500)
    ys = np.linspace(cy - span * 0.55, cy + span * 0.55, 280)
    gx, gy = np.meshgrid(xs, ys)
    z = dem.height(gx, gy)
    shade = LightSource(azdeg=315, altdeg=40).hillshade(z, vert_exag=2, dx=xs[1] - xs[0], dy=ys[1] - ys[0])
    axm.imshow(shade, cmap="gray", origin="lower", extent=[xs[0], xs[-1], ys[0], ys[-1]], alpha=0.95)
    if sol is not None and show_camera:
        for side in (-1, 1):
            a = math.radians(sol.heading + side * sol.hfov / 2)
            axm.plot([sol.x, sol.x + span * 3 * math.sin(a)], [sol.y, sol.y + span * 3 * math.cos(a)], "--", color=RED, lw=1)
        axm.plot([sol.x], [sol.y], "*", color=RED, ms=18, mec="white")
        axm.text(sol.x + span * 0.02, sol.y - span * 0.05, "CAMERA", color=RED, fontsize=10, family="monospace", weight="bold")
    if target and target.get("xy"):
        tx, ty = target["xy"]
        if sol is not None and show_camera:
            axm.plot([sol.x, tx], [sol.y, ty], "-", color=PINK, lw=1.5)
        axm.plot([tx], [ty], "o", mfc="none", mec=PINK, ms=14, mew=2)
        axm.text(tx + span * 0.02, ty + span * 0.02, "T", color=PINK, fontsize=12, weight="bold")
    if place_xy:
        axm.plot([place_xy[0]], [place_xy[1]], "s", color="white", ms=6)
        axm.text(place_xy[0] + span * 0.02, place_xy[1] - span * 0.04, info.get("place") or "reported place",
                 color=FG, fontsize=9, bbox=dict(fc=BG, ec="none", alpha=0.7))
    bar = 10 ** math.floor(math.log10(span / 2))
    x0, y0 = xs[0] + span * 0.05, ys[0] + span * 0.06
    axm.plot([x0, x0 + bar], [y0, y0], color="white", lw=3)
    axm.text(x0, y0 + span * 0.02, f"{bar / 1000:g} km" if bar >= 1000 else f"{bar:g} m", color="white", fontsize=9, family="monospace")
    axm.set_xlim(xs[0], xs[-1])
    axm.set_ylim(ys[0], ys[-1])
    axm.set_aspect("equal")
    axm.set_xticks([])
    axm.set_yticks([])
    for s in axm.spines.values():
        s.set_color(DIM)
    axm.set_title("02  SIGHTLINE ON TERRAIN (north up, hillshade)" if show_camera else "02  LOCATED TARGET ON TERRAIN (north up, hillshade)",
                  color=FG, loc="left", fontsize=11, family="monospace")

    # 03 numbers
    axt = fig.add_subplot(gs[2, :])
    axt.axis("off")
    lines = []
    if target and target.get("latlon"):
        lines.append(("Target", f"{_fmt(*target['latlon'])}   ·   {target.get('label') or ''}   ·   {target.get('dist_km', 0):.1f} km from camera"))
    if sol is not None:
        if show_camera:
            lines.append(("Camera", f"{_fmt(*cam_latlon)}   ·   looking {sol.heading:.1f}° true   ·   {sol.hfov:.2f}° horizontal FOV"))
        else:
            lines.append(("Camera", "withheld (staff release required)"))
        lines.append(("Fit", f"skyline {sol.fit_rms_px:.1f} px RMS   ·   held-out part {sol.holdout_rms_px:.1f} px   ·   "
                             f"next-best site ×{info.get('ambiguity', 0):.2f} worse"))
    lines.append(("Confidence", f"{(info.get('confidence') or 'n/a').upper()}   " + "  ".join(f"· {n}" for n in info.get("notes") or [])))
    if info.get("integrity") and info["integrity"] != "ok":
        lines.append(("Media check", f"{info['integrity']}: {info.get('integrity_reason') or ''}"))
    for i, (k, val) in enumerate(lines):
        axt.text(0.0, 0.9 - i * 0.19, k.upper(), color=DIM, fontsize=10, family="monospace", transform=axt.transAxes)
        axt.text(0.16, 0.9 - i * 0.19, val, color=FG, fontsize=11, transform=axt.transAxes, wrap=True)

    fig.text(0.05, 0.035, "Pixel residuals show the fit is consistent, not that the location is right. Absolute accuracy unmeasured; "
             "media authenticity not verified by the solver.", color=DIM, fontsize=8, family="monospace")
    fig.text(0.05, 0.02, DEM_CREDIT, color=DIM, fontsize=7, family="monospace")
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=BG)
    plt.close(fig)
    return buf.getvalue()
