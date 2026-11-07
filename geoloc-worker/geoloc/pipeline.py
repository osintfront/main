"""One job end to end: media → triage → skyline → terrain search → target → boards."""
from __future__ import annotations

import io
import logging
import math
import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from . import board, skyline, solve
from .db import download
from .dem import LocalDEM

log = logging.getLogger("geoloc.pipeline")


@dataclass
class Config:
    cache_dir: Path
    radius_km: float = 12.0
    workers: int | None = None
    min_coverage: float = 0.4
    min_relief: float = 0.015
    min_area_relief_m: float = 150.0


def precheck(img) -> str | None:
    """Reasons a photo can't be geolocated by terrain, found without any API call."""
    H, W = img.shape[:2]
    # Phone photos are often portrait (e.g. 450x800): judge by the short side and total pixels.
    if min(W, H) < 300 or W * H < 200_000:
        return f"image too small ({W}x{H})"
    top = img[: max(4, H // 6)]
    hsv = cv2.cvtColor(top, cv2.COLOR_BGR2HSV)
    if float(hsv[..., 2].mean()) < 55:
        return "top of the frame is dark (night or indoor)"
    gray = cv2.cvtColor(top, cv2.COLOR_BGR2GRAY)
    if float(np.abs(cv2.Laplacian(gray, cv2.CV_32F)).mean()) > 18 and float(hsv[..., 1].mean()) > 110:
        return "top of the frame is busy and saturated (no sky)"
    return None


def area_relief(dem: LocalDEM, radius_m: float) -> float:
    """Height range (5th–95th percentile) of the ground within radius_m of the place."""
    g = np.arange(-radius_m, radius_m + 1, 500.0)
    gx, gy = np.meshgrid(g, g)
    inside = (np.hypot(gx, gy) <= radius_m) & dem.inside(gx, gy)
    z = dem.height(gx[inside], gy[inside])
    return float(np.percentile(z, 95) - np.percentile(z, 5)) if z.size else 0.0


def _decode(data: bytes):
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError("could not decode image")
    return img


def _exif_gps(data: bytes):
    try:
        from PIL import Image
        ex = Image.open(io.BytesIO(data))._getexif() or {}
        g = ex.get(34853)
        if not g:
            return None

        def conv(v, ref):
            d = float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
            return -d if ref in ("S", "W") else d
        return conv(g[2], g[1]), conv(g[4], g[3])
    except Exception:  # noqa: BLE001 - EXIF is a bonus, never a failure
        return None


def _frames(video_bytes: bytes, n=6):
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        f.write(video_bytes)
        path = f.name
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    out = []
    for k in range(n):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int((k + 0.5) * total / n) if total else k * 30)
        ok, fr = cap.read()
        if ok:
            out.append(fr)
    cap.release()
    Path(path).unlink(missing_ok=True)
    return out


def _places(ev: dict):
    names, center = [], None
    if ev.get("location_name"):
        names.append(ev["location_name"])
    for loc in ev.get("locations") or []:
        if isinstance(loc, dict):
            for k in ("name_en", "name"):
                if loc.get(k) and loc[k] not in names:
                    names.append(loc[k])
            if center is None and loc.get("lat") is not None and loc.get("lng") is not None:
                center = (float(loc["lat"]), float(loc["lng"]), loc.get("name_en") or loc.get("name"))
    if ev.get("latitude") is not None and ev.get("longitude") is not None:
        center = (float(ev["latitude"]), float(ev["longitude"]), ev.get("location_name") or (center[2] if center else ""))
    return names, center


def process(job: dict, cfg: Config, vision) -> dict:
    """Returns {'status', 'result' (for geoloc_finish), 'boards': {'target': png, 'full': png}}."""
    ev, media, video = job["event"], job.get("media") or {}, job.get("video")
    names, center = _places(ev)
    if not center:
        return {"status": "skipped", "result": {"error": "event has no coordinates to search around"}}
    if not media.get("public_url"):
        return {"status": "skipped", "result": {"error": "media has no URL"}}

    prec = (ev.get("location_precision") or "").lower()
    if prec in ("country", "region"):
        return {"status": "skipped", "result": {"error": f"place known only to {prec} level; too vague to search"}}

    raw = download(media["public_url"])
    img = _decode(raw)
    exif = _exif_gps(raw)
    details = {"places": names, "exif_gps": exif, "location_precision": prec or None}

    # 1. Free local checks — no API call.
    why = precheck(img)
    if why:
        details["precheck"] = why
        return {"status": "skipped", "result": {"error": why, "details": details}}

    # 2. Cheap model check: is there open sky meeting terrain at all?
    tri = vision.triage(img)
    details["triage"] = tri
    if not tri.get("usable"):
        return {"status": "skipped", "result": {"error": f"no terrain to match: {tri.get('reason', '')}", "details": details}}

    # 3. Is the ground around the reported place hilly enough to tell positions apart?
    lat0, lon0, place_label = center
    dem = LocalDEM.from_copernicus(lat0, lon0, cfg.radius_km + 50.0, cfg.cache_dir / "dem")
    relief = area_relief(dem, cfg.radius_km * 1000.0 + 25_000.0)
    details["area_relief_m"] = round(relief, 1)
    if relief < cfg.min_area_relief_m:
        return {"status": "skipped", "result": {"error": f"terrain around the place is too flat to match ({relief:.0f} m relief)", "details": details}}

    # 4. Skyline: best of the photo and (for videos) a few frames.
    candidates = [img]
    if video and video.get("public_url"):
        try:
            candidates += _frames(download(video["public_url"]))
        except Exception as e:  # noqa: BLE001
            log.warning("video frames failed: %s", e)
    scored = []
    for c in candidates:
        v = skyline.extract(c)
        q = skyline.quality(v, c.shape[0])
        scored.append((q["coverage"] * min(q["relief_frac"], 0.2), c, v, q))
    scored.sort(key=lambda s: -s[0])
    _, img, v, q = scored[0]
    H, W = img.shape[:2]
    details.update(skyline=q, frames_checked=len(candidates))
    if q["coverage"] < cfg.min_coverage or q["relief_frac"] < cfg.min_relief:
        return {"status": "skipped", "result": {"error": "skyline too short or too flat to match", "details": details}}

    # 5. Only now the expensive steps: scene reading and the terrain search.
    text = "\n".join(x for x in [ev.get("title"), ev.get("description"), ev.get("original_report_text")] if x)
    scene = vision.scene(img, text, names)
    details["scene"] = {k: scene.get(k) for k in ("has_skyline", "target", "integrity", "integrity_reason", "model")}
    for x0, y0, x1, y1 in scene.get("overlays") or []:  # captions/logos over the ridgeline
        cols = slice(max(0, int(x0)), min(W, int(x1) + 1))
        hit = (v[cols] >= y0 - 5) & (v[cols] <= y1 + 5)
        v[cols][hit] = np.nan

    u, vv = skyline.subsample(v, 240)
    res = solve.solve(dem, W, H, u, vv, (0.0, 0.0), cfg.radius_km * 1000.0, q["relief_frac"], workers=cfg.workers)
    b = res.best
    cam_lat, cam_lng = (float(a) for a in dem.to_latlon(b.x, b.y))
    details["solve"] = res.as_dict()

    target = None
    t = scene.get("target")
    if isinstance(t, dict) and t.get("x") is not None:
        hit = solve.locate_pixel(dem, b, W, H, t["x"], t["y"])
        if hit:
            tl, tg = (float(a) for a in dem.to_latlon(hit[0], hit[1]))
            target = {"px": (t["x"], t["y"]), "xy": (hit[0], hit[1]), "latlon": (tl, tg),
                      "label": t.get("label") or "", "dist_km": hit[3] / 1000.0}

    integrity = scene.get("integrity") or "unclear"
    status = "done" if res.confidence in ("high", "medium") else "needs_review"
    if integrity in ("suspect_ai", "suspect_edit", "screen_recording"):
        status = "needs_review"
        res.notes.append(f"media flagged: {integrity}")
    place_xy = (0.0, 0.0)
    info = {"title": ev.get("title") or "Terrain geolocation", "subtitle": " / ".join(names[:3]), "place": place_label,
            "confidence": res.confidence, "notes": res.notes, "ambiguity": res.ambiguity_ratio,
            "integrity": integrity, "integrity_reason": scene.get("integrity_reason")}
    boards = {
        "target": board.render(dem, img, v, b, (cam_lat, cam_lng), target, place_xy, info, show_camera=False),
        "full": board.render(dem, img, v, b, (cam_lat, cam_lng), target, place_xy, info, show_camera=True),
    }
    result = {
        "camera_lat": cam_lat, "camera_lng": cam_lng, "camera_heading": b.heading, "hfov": b.hfov,
        "fit_rms_px": b.fit_rms_px, "holdout_rms_px": b.holdout_rms_px, "confidence": res.confidence,
        "target_lat": target["latlon"][0] if target else None, "target_lng": target["latlon"][1] if target else None,
        "target_label": target["label"] if target else None,
        "details": {**details, "notes": res.notes, "camera_spread_m": res.camera_spread_m,
                    "target_dist_km": round(target["dist_km"], 2) if target else None,
                    "camera_offset_km": round(math.hypot(b.x, b.y) / 1000, 2)},
    }
    return {"status": status, "result": result, "boards": boards}
