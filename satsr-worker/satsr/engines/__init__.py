"""Super-resolution engines, by name. The name is stored on every job and is part of the cache key,
so a new engine (or a new version of one) gets its own name here and in app_settings.satsr_engines."""
from __future__ import annotations

import importlib
from pathlib import Path
from typing import Protocol

import numpy as np


class Engine(Protocol):
    name: str
    version: str
    scale: int                 # 4: 10 m → 2.5 m
    bands: tuple[str, ...]     # input band order, e.g. ("B04", "B03", "B02", "B08")
    device: str                # "cpu", "cuda"

    def upscale(self, x: np.ndarray) -> np.ndarray:
        """[C, H, W] float32 reflectance (0..1) → [C, scale·H, scale·W] float32."""
        ...


# name → "module:Class" (imported only when used, so the tests never need torch)
REGISTRY: dict[str, str] = {
    "sen2sr_lite_rgbn_x4": "satsr.engines.sen2sr_lite:Sen2SRLite",
    "bicubic_x4": "satsr.engines.bicubic:Bicubic",
}

_cache: dict[str, Engine] = {}


class UnknownEngine(ValueError):
    pass


def get_engine(name: str, models_dir: Path, threads: int | None = None) -> Engine:
    """The engine for a job (loaded once, then kept)."""
    if name in _cache:
        return _cache[name]
    target = REGISTRY.get(name)
    if not target:
        raise UnknownEngine(f"unknown engine {name!r}")
    mod, cls = target.split(":")
    engine = getattr(importlib.import_module(mod), cls)(models_dir=Path(models_dir), threads=threads)
    _cache[name] = engine
    return engine
