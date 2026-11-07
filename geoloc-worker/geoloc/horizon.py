"""Horizon rendering, the pinhole camera model and terrain ray-casting.

Angles: azimuth in degrees clockwise from true north; elevation in radians above
the local horizontal. Curvature + standard refraction (k = 0.13) are applied as a
height drop of d² (1 − k) / 2R.
"""
from __future__ import annotations

import numpy as np

from .dem import LocalDEM, R_EARTH

REFRACTION_K = 0.13
DROP = (1.0 - REFRACTION_K) / (2.0 * R_EARTH)


def distance_samples(dmin=120.0, dmax=35_000.0, n=360) -> np.ndarray:
    """Denser near the camera, sparser far away (log spacing, then capped steps)."""
    d = np.geomspace(dmin, dmax, n)
    return d


def horizon(dem: LocalDEM, x: float, y: float, zc: float, az_deg: np.ndarray, dists: np.ndarray):
    """Skyline elevation (rad) and the distance (m) of the terrain that forms it, per azimuth."""
    a = np.radians(np.asarray(az_deg, dtype=np.float64))[:, None]
    d = dists[None, :]
    px = x + d * np.sin(a)
    py = y + d * np.cos(a)
    z = dem.height(px, py)
    ang = np.arctan2(z - zc - DROP * d * d, d)
    # Ignore samples off the grid (their height is just the edge value).
    ang = np.where(dem.inside(px, py), ang, -np.pi / 2)
    i = np.argmax(ang, axis=1)
    rows = np.arange(len(i))
    return ang[rows, i], dists[i]


class Camera:
    """Pinhole camera. params: x, y (m), h (m above ground), heading (deg), hfov (deg), pitch, roll (deg)."""

    def __init__(self, width: int, height: int, x, y, h, heading, hfov, pitch=0.0, roll=0.0):
        self.W, self.H = width, height
        self.x, self.y, self.h = x, y, h
        self.heading, self.hfov, self.pitch, self.roll = heading, hfov, pitch, roll

    @property
    def f(self) -> float:
        return (self.W / 2.0) / np.tan(np.radians(self.hfov) / 2.0)

    def rays(self, u, v):
        """Pixel → (azimuth deg, elevation rad)."""
        f = self.f
        xn = (np.asarray(u, float) - self.W / 2.0) / f
        yn = (self.H / 2.0 - np.asarray(v, float)) / f
        cr, sr = np.cos(np.radians(self.roll)), np.sin(np.radians(self.roll))
        xr = xn * cr - yn * sr
        yr = xn * sr + yn * cr
        cp, sp = np.cos(np.radians(self.pitch)), np.sin(np.radians(self.pitch))
        fwd = cp - sp * yr
        up = sp + cp * yr
        az = self.heading + np.degrees(np.arctan2(xr, fwd))
        el = np.arctan2(up, np.hypot(xr, fwd))
        return az, el

    def project(self, az_deg, el):
        """(azimuth deg, elevation rad) → pixel (u, v). Inverse of rays()."""
        a = np.radians(np.asarray(az_deg, float) - self.heading)
        el = np.asarray(el, float)
        # direction in a level frame: right, forward, up
        dx, dy, dz = np.cos(el) * np.sin(a), np.cos(el) * np.cos(a), np.sin(el)
        cp, sp = np.cos(np.radians(self.pitch)), np.sin(np.radians(self.pitch))
        fwd = dy * cp + dz * sp
        up = -dy * sp + dz * cp
        xr, yr = dx / fwd, up / fwd
        cr, sr = np.cos(np.radians(self.roll)), np.sin(np.radians(self.roll))
        xn = xr * cr + yr * sr
        yn = -xr * sr + yr * cr
        return self.W / 2.0 + xn * self.f, self.H / 2.0 - yn * self.f


def raycast(dem: LocalDEM, x, y, zc, az_deg, el, dmax=40_000.0, step=10.0):
    """Where a ray first hits the terrain → (x, y, z, distance) or None if it reaches the sky."""
    d = np.arange(step, dmax, step)
    a = np.radians(az_deg)
    px = x + d * np.cos(el) * np.sin(a)
    py = y + d * np.cos(el) * np.cos(a)
    pz = zc + d * np.sin(el) - DROP * d * d
    zt = dem.height(px, py)
    hit = np.nonzero((pz <= zt) & dem.inside(px, py))[0]
    if len(hit) == 0:
        return None
    k = hit[0]
    if k > 0:  # refine between the last free and first blocked sample
        lo, hi = d[k - 1], d[k]
        for _ in range(20):
            mid = 0.5 * (lo + hi)
            mx, my = x + mid * np.cos(el) * np.sin(a), y + mid * np.cos(el) * np.cos(a)
            mz = zc + mid * np.sin(el) - DROP * mid * mid
            if mz <= dem.height(mx, my):
                hi = mid
            else:
                lo = mid
        dd = hi
    else:
        dd = d[0]
    hx, hy = x + dd * np.cos(el) * np.sin(a), y + dd * np.cos(el) * np.cos(a)
    return float(hx), float(hy), float(dem.height(hx, hy)), float(dd)
