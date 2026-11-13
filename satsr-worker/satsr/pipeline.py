"""One job: find the picture → (merge if already done) → read the box → ×4 → products → PNGs."""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np
from affine import Affine
from rasterio.warp import Resampling

from . import __version__
from .grid import warp_to_mercator
from .render import PRODUCTS, png_bytes
from .source import pick_scene

log = logging.getLogger("satsr.pipeline")


@dataclass
class Config:
    models_dir: Path
    box_px: int = 256          # 256 px × 10 m = 2.56 km; the result is 1024 px × 2.5 m
    max_cloud: float = 10.0    # % of the box; without a date, the newest picture at or under this wins
    gain: float = 2.6          # true-colour brightness
    harmonize: bool = True     # remove the +1000 offset of processing baseline 04.00+
    days: int = 60             # how far back to look without a date


def process(job: dict, cfg: Config, source, engine, sb) -> dict:
    """→ {"status": "done" | "merged" | "gone", "result": {...}, "files": {path: png bytes}}.

    "merged": the picture was already enhanced; the database handed this job's requesters that
    result (nothing to compute or upload). "gone": the job is no longer ours (reclaimed).
    Raises NoScene / SourceError / anything else for the worker loop to record.
    """
    t0 = time.time()
    jid = job["job_id"]
    lat, lng = float(job["lat"]), float(job["lng"])
    day = date.fromisoformat(str(job["requested_date"])[:10]) if job.get("requested_date") else None

    scenes = source.search(lat, lng, day, cfg.days)
    scene, cloud = pick_scene(scenes, lambda s: source.stats(s, lat, lng, cfg.box_px), cfg.max_cloud, fixed_date=day is not None)
    log.info("job %s: %s (%s, box cloud %.1f%%)", jid, scene.id, scene.date, cloud)

    res = sb.rpc("satsr_resolve", {"p_id": jid, "p_scene_date": scene.date.isoformat(), "p_scene_id": scene.id}) or {}
    if res.get("merged"):
        return {"status": "merged", "result": {"into": res.get("into"), "scene_date": scene.date.isoformat()}, "files": {}}
    if res.get("ok") is False:
        return {"status": "gone", "result": {}, "files": {}}

    x, src_transform, crs, valid = source.read(scene, lat, lng, cfg.box_px)
    t1 = time.time()
    sr = engine.upscale(x)
    t2 = time.time()
    k = engine.scale
    if sr.shape[1:] != (x.shape[1] * k, x.shape[2] * k):
        raise RuntimeError(f"engine returned {sr.shape}, expected ×{k} of {x.shape}")
    sr_transform = src_transform @ Affine.scale(1 / k)
    sr_valid = np.repeat(np.repeat(valid, k, axis=0), k, axis=1)

    files: dict[str, bytes] = {}
    products: dict[str, dict[str, str]] = {}
    dst = bounds = None
    for p in PRODUCTS:
        params = p.prepare(x, cfg.gain)
        after, dst, bounds = warp_to_mercator(p.render(sr, params), sr_transform, crs, Resampling.cubic, dst, sr_valid)
        # The original goes onto the SAME grid, nearest neighbour: its 10 m pixels stay visible as blocks.
        before, _, _ = warp_to_mercator(p.render(x, params), src_transform, crs, Resampling.nearest, dst, valid)
        paths = {"sr": f"{jid}/{p.key}_sr.png", "lr": f"{jid}/{p.key}_lr.png"}
        files[paths["sr"]] = png_bytes(after)
        files[paths["lr"]] = png_bytes(before)
        products[p.key] = paths

    south, west, north, east = bounds
    _, width, height = dst
    result = {
        "scene_date": scene.date.isoformat(), "scene_id": scene.id, "cloud_pct": round(float(cloud), 2),
        "south": south, "west": west, "north": north, "east": east, "width": width, "height": height,
        "products": products,
        "meta": {
            "source": getattr(source, "name", type(source).__name__), "engine": engine.name,
            "engine_version": getattr(engine, "version", "?"), "device": getattr(engine, "device", "?"),
            "worker_version": __version__, "box_px": cfg.box_px, "harmonize": cfg.harmonize,
            "baseline": scene.baseline, "mgrs": scene.mgrs, "crs": str(crs),
            "seconds": {"read": round(t1 - t0, 1), "upscale": round(t2 - t1, 1), "total": round(time.time() - t0, 1)},
        },
    }
    return {"status": "done", "result": result, "files": files}
