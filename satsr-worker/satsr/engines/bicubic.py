"""Plain bicubic ×4 (numpy + Pillow): for tests and staff comparisons, never the default."""
from __future__ import annotations

from pathlib import Path

import numpy as np


class Bicubic:
    name = "bicubic_x4"
    version = "1"
    scale = 4
    bands = ("B04", "B03", "B02", "B08")
    device = "cpu"

    def __init__(self, models_dir: Path | None = None, threads: int | None = None):
        pass

    def upscale(self, x: np.ndarray) -> np.ndarray:
        from PIL import Image

        if x.ndim != 3:
            raise ValueError(f"expected [C, H, W], got {x.shape}")
        c, h, w = x.shape
        out = np.empty((c, h * self.scale, w * self.scale), np.float32)
        for i in range(c):
            img = Image.fromarray(np.nan_to_num(x[i]).astype(np.float32), mode="F")
            out[i] = np.asarray(img.resize((w * self.scale, h * self.scale), Image.Resampling.BICUBIC), np.float32)
        return np.clip(out, 0.0, None)
