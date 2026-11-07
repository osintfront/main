"""Elevation data: Copernicus GLO-30 tiles (free, public AWS bucket), cached on disk,
mosaicked and resampled into a local metric grid around the search centre.

Local grid: x = metres east, y = metres north of (lat0, lon0) on a simple
equirectangular projection. Good to well under 0.1 % within 50 km, which is far
below the 30 m DEM resolution. Earth curvature is applied in horizon.py.
"""
from __future__ import annotations

import logging
import math
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from scipy.ndimage import map_coordinates

log = logging.getLogger("geoloc.dem")

R_EARTH = 6_371_008.8
COP_URL = "https://copernicus-dem-30m.s3.amazonaws.com/{n}/{n}.tif"


def tile_name(lat: int, lon: int) -> str:
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    return f"Copernicus_DSM_COG_10_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM"


def fetch_tile(lat: int, lon: int, cache: Path) -> np.ndarray | None:
    """Return the tile as float32 (rows north→south), or None for open sea (no tile)."""
    import tifffile  # local import: only needed when tiles are read

    cache.mkdir(parents=True, exist_ok=True)
    name = tile_name(lat, lon)
    path = cache / f"{name}.tif"
    missing = cache / f"{name}.none"
    if missing.exists():
        return None
    if not path.exists():
        url = COP_URL.format(n=name)
        log.info("downloading DEM tile %s", name)
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                data = r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):  # no tile = sea
                missing.touch()
                return None
            raise
        tmp = path.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(path)
    arr = tifffile.imread(path).astype(np.float32)
    arr[arr < -1000] = 0.0
    return arr


class LocalDEM:
    """Terrain heights on a regular metric grid around (lat0, lon0)."""

    def __init__(self, lat0: float, lon0: float, z: np.ndarray, spacing: float, half: float):
        self.lat0, self.lon0 = lat0, lon0
        self.z = z.astype(np.float32)  # z[row, col]; row 0 = south edge (y = -half)
        self.spacing = spacing
        self.half = half
        self.kx = 1.0 / spacing

    # ── coordinates ─────────────────────────────────────────────────────
    def to_xy(self, lat, lon):
        x = np.radians(np.asarray(lon) - self.lon0) * R_EARTH * math.cos(math.radians(self.lat0))
        y = np.radians(np.asarray(lat) - self.lat0) * R_EARTH
        return x, y

    def to_latlon(self, x, y):
        lat = self.lat0 + np.degrees(np.asarray(y) / R_EARTH)
        lon = self.lon0 + np.degrees(np.asarray(x) / (R_EARTH * math.cos(math.radians(self.lat0))))
        return lat, lon

    # ── sampling ───────────────────────────────────────────────────────
    def height(self, x, y) -> np.ndarray:
        """Bilinear terrain height (m). Outside the grid → edge value."""
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        col = (x + self.half) * self.kx
        row = (y + self.half) * self.kx
        return map_coordinates(self.z, [row.ravel(), col.ravel()], order=1, mode="nearest").reshape(x.shape)

    def inside(self, x, y, margin: float = 0.0):
        return (np.abs(x) <= self.half - margin) & (np.abs(y) <= self.half - margin)

    # ── construction ───────────────────────────────────────────────────
    @classmethod
    def from_copernicus(cls, lat0: float, lon0: float, half_km: float, cache: Path, spacing: float = 30.0) -> "LocalDEM":
        half = half_km * 1000.0
        dlat = math.degrees(half / R_EARTH)
        dlon = math.degrees(half / (R_EARTH * math.cos(math.radians(lat0))))
        lat_lo, lat_hi = lat0 - dlat, lat0 + dlat
        lon_lo, lon_hi = lon0 - dlon, lon0 + dlon

        n = int(round(2 * half / spacing)) + 1
        ys = np.linspace(-half, half, n)
        xs = np.linspace(-half, half, n)
        gx, gy = np.meshgrid(xs, ys)
        glat = lat0 + np.degrees(gy / R_EARTH)
        glon = lon0 + np.degrees(gx / (R_EARTH * math.cos(math.radians(lat0))))
        out = np.zeros_like(gx, dtype=np.float32)

        for tlat in range(math.floor(lat_lo), math.floor(lat_hi) + 1):
            for tlon in range(math.floor(lon_lo), math.floor(lon_hi) + 1):
                tile = fetch_tile(tlat, tlon, cache)
                sel = (glat >= tlat) & (glat < tlat + 1) & (glon >= tlon) & (glon < tlon + 1)
                if tile is None or not sel.any():
                    continue
                rows, cols = tile.shape
                # Copernicus: pixel centres start on the tile's north-west corner.
                r = (tlat + 1 - glat[sel]) * rows
                c = (glon[sel] - tlon) * cols
                out[sel] = map_coordinates(tile, [r, c], order=1, mode="nearest")
        return cls(lat0, lon0, out, spacing, half)

    @classmethod
    def synthetic(cls, half_km: float = 20.0, spacing: float = 30.0, seed: int = 1, lat0=33.3, lon0=35.45) -> "LocalDEM":
        """Random fractal hills for tests (no download)."""
        rng = np.random.default_rng(seed)
        half = half_km * 1000.0
        n = int(round(2 * half / spacing)) + 1
        z = np.zeros((n, n), np.float32)
        # fixed physical scale (40 km per unit) so terrain character doesn't depend on grid size
        yy, xx = (np.mgrid[0:n, 0:n] - (n - 1) / 2) * spacing / 40_000.0
        for k in range(1, 7):
            f = 2 ** k
            amp = 900.0 / (1.6 ** k)
            for _ in range(3):
                px, py = rng.uniform(0, 2 * np.pi, 2)
                ang = rng.uniform(0, np.pi)
                z += amp * np.sin(f * np.pi * (xx * np.cos(ang) + yy * np.sin(ang)) + px) * np.cos(f * np.pi * yy * 0.7 + py) / 3
        z = z + 1000.0  # absolute offset (not min-based) so every grid size gives the same terrain
        return cls(lat0, lon0, z, spacing, half)
