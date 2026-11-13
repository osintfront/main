"""Products: how four reflectance bands become pictures people can read.

Input is always [4, H, W] float32 reflectance in the order B04 (red), B03 (green),
B02 (blue), B08 (near infrared). Every product makes a "before" (original 10 m)
and an "after" (2.5 m) picture with the SAME stretch, prepared once from the
original, so the two compare honestly. To add or drop a product, edit PRODUCTS.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Callable

import numpy as np

R, G, B, N = 0, 1, 2, 3  # band order of the input


@dataclass(frozen=True)
class Product:
    key: str                                              # file names: {job}/{key}_sr.png, {job}/{key}_lr.png
    prepare: Callable[[np.ndarray, float], dict]          # (original bands, gain) → stretch parameters
    render: Callable[[np.ndarray, dict], np.ndarray]      # (bands, parameters) → [3, H, W] uint8


def _to_u8(x: np.ndarray) -> np.ndarray:
    return (np.clip(np.nan_to_num(x, nan=0.0), 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


# ── true colour: red, green, blue × a fixed gain (2.6 = bright but natural for most land) ──
def _tci_prepare(lr: np.ndarray, gain: float) -> dict:
    return {"gain": float(gain)}


def _tci_render(x: np.ndarray, p: dict) -> np.ndarray:
    return _to_u8(x[[R, G, B]] * p["gain"])


# ── infrared (colour infrared, "IRP"): NIR → red, red → green, green → blue ──
# Healthy vegetation reflects NIR strongly, so it shows red; water is dark, built-up areas cyan/grey.
# Each channel is stretched between the original's 2nd and 98th percentile (a linear stretch,
# with a little gamma), computed once from the original and applied to both pictures.
def _irp_prepare(lr: np.ndarray, gain: float) -> dict:
    lo, hi = [], []
    for band in (N, R, G):
        v = lr[band]
        v = v[np.isfinite(v) & (v > 0)]
        if v.size < 16:
            a, b = 0.0, 0.4
        else:
            a, b = (float(q) for q in np.percentile(v, [2, 98]))
            if b - a < 1e-3:
                b = a + 1e-3
        lo.append(a)
        hi.append(b)
    return {"lo": lo, "hi": hi, "gamma": 0.9}


def _irp_render(x: np.ndarray, p: dict) -> np.ndarray:
    out = []
    for i, band in enumerate((N, R, G)):
        v = (x[band] - p["lo"][i]) / (p["hi"][i] - p["lo"][i])
        out.append(np.power(np.clip(v, 0.0, 1.0), p["gamma"]))
    return _to_u8(np.stack(out))


# ── NDVI = (NIR − red) / (NIR + red), on a fixed colour ramp ──
NDVI_RAMP: list[tuple[float, tuple[int, int, int]]] = [
    (-0.30, (33, 102, 172)),   # water
    (0.00, (140, 110, 80)),    # bare soil, rock, built-up
    (0.15, (222, 196, 132)),   # sparse
    (0.30, (217, 239, 139)),
    (0.45, (145, 207, 96)),
    (0.60, (26, 152, 80)),     # dense vegetation
    (0.85, (0, 68, 27)),
]


def ndvi(x: np.ndarray) -> np.ndarray:
    nir, red = x[N].astype(np.float32), x[R].astype(np.float32)
    s = nir + red
    with np.errstate(divide="ignore", invalid="ignore"):
        v = np.where(s > 1e-6, (nir - red) / s, 0.0)
    return np.nan_to_num(v, nan=0.0).astype(np.float32)


def _ndvi_prepare(lr: np.ndarray, gain: float) -> dict:
    return {}


def _ndvi_render(x: np.ndarray, p: dict) -> np.ndarray:
    v = ndvi(x)
    stops = np.array([s for s, _ in NDVI_RAMP], np.float32)
    cols = np.array([c for _, c in NDVI_RAMP], np.float32)
    out = np.stack([np.interp(v, stops, cols[:, k]) for k in range(3)])
    return (out + 0.5).astype(np.uint8)


PRODUCTS: list[Product] = [
    Product("tci", _tci_prepare, _tci_render),
    Product("irp", _irp_prepare, _irp_render),
    Product("ndvi", _ndvi_prepare, _ndvi_render),
]

MAX_PNG_BYTES = 8 * 1024 * 1024  # bucket file_size_limit


def png_bytes(rgba: np.ndarray) -> bytes:
    """[H, W, 4] uint8 → PNG bytes (raises if over the bucket's 8 MB limit)."""
    from PIL import Image

    if rgba.ndim != 3 or rgba.shape[2] != 4 or rgba.dtype != np.uint8:
        raise ValueError(f"expected [H, W, 4] uint8, got {rgba.shape} {rgba.dtype}")
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, format="PNG", optimize=False, compress_level=6)
    data = buf.getvalue()
    if len(data) > MAX_PNG_BYTES:
        raise ValueError(f"PNG too large: {len(data)} bytes")
    return data
