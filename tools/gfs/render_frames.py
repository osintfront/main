"""Forecast clouds and rain for the map's weather timeline.

Every 6 hours (GitHub Actions, .github/workflows/gfs-frames.yml) this downloads the newest NOAA GFS 0.25°
run for the Middle East box only (NOMADS grib filter: total cloud cover + precipitation rate, +1…+72 h),
renders one Web-Mercator PNG per hour per layer and uploads them to the public Supabase Storage bucket
`weather`, then writes gfs/latest.json (the list the map reads) and removes runs older than the previous one.

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. GFS data: NOAA, public domain.
"""
from __future__ import annotations

import io
import json
import math
import os
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

import numpy as np

WEST, EAST, SOUTH, NORTH = 25.0, 65.0, 10.0, 45.0
WIDTH = 800
HOURS = list(range(1, 73))
BUCKET = 'weather'
NOMADS = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25_1hr.pl'
UA = 'osintfront.com weather frames (+https://osintfront.com)'

CLOUD_RGB = (0xF1, 0xF5, 0xF9)
RAIN_BANDS = [  # lower bound in mm/h → colour
    (0.1, '#93c5fd'), (0.5, '#3b82f6'), (2.0, '#1d4ed8'), (5.0, '#facc15'), (10.0, '#dc2626'),
]
RAIN_ALPHA = 210


# ── Pure parts (tested) ─────────────────────────────────────────────
def _merc_y(lat: float) -> float:
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def merc_rows(lat_top: float, lat_bottom: float, height: int) -> np.ndarray:
    """Latitude of the centre of each output row, rows evenly spaced in Web-Mercator y (north first)."""
    y0, y1 = _merc_y(lat_top), _merc_y(lat_bottom)
    ys = y0 - (np.arange(height) + 0.5) * (y0 - y1) / height
    return np.degrees(2 * np.arctan(np.exp(ys)) - math.pi / 2)


def mercator_height(width: int) -> int:
    per_rad = width / math.radians(EAST - WEST)
    return int(round((_merc_y(NORTH) - _merc_y(SOUTH)) * per_rad))


def resample(grid: np.ndarray, lats: np.ndarray, lons: np.ndarray, width: int) -> np.ndarray:
    """Bilinear resample of a lat/lon grid (rows = lats) onto the Mercator raster of the box."""
    if lats[0] > lats[-1]:  # make latitude increasing for interpolation
        lats, grid = lats[::-1], grid[::-1]
    height = mercator_height(width)
    row_lat = merc_rows(NORTH, SOUTH, height)
    col_lon = WEST + (np.arange(width) + 0.5) * (EAST - WEST) / width
    fy = np.interp(row_lat, lats, np.arange(len(lats)))
    fx = np.interp(col_lon, lons, np.arange(len(lons)))
    y0 = np.clip(np.floor(fy).astype(int), 0, len(lats) - 1)
    x0 = np.clip(np.floor(fx).astype(int), 0, len(lons) - 1)
    y1 = np.clip(y0 + 1, 0, len(lats) - 1)
    x1 = np.clip(x0 + 1, 0, len(lons) - 1)
    wy = (fy - y0)[:, None]
    wx = (fx - x0)[None, :]
    top = grid[np.ix_(y0, x0)] * (1 - wx) + grid[np.ix_(y0, x1)] * wx
    bot = grid[np.ix_(y1, x0)] * (1 - wx) + grid[np.ix_(y1, x1)] * wx
    return top * (1 - wy) + bot * wy


def cloud_rgba(pct: np.ndarray) -> np.ndarray:
    pct = np.asarray(pct, dtype=float)
    out = np.zeros(pct.shape + (4,), dtype=np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = CLOUD_RGB
    out[..., 3] = (np.clip((pct - 10) / 90, 0, 1) * 0.85 * 255).astype(np.uint8)
    return out


def rain_rgba(mmh: np.ndarray) -> np.ndarray:
    mmh = np.asarray(mmh, dtype=float)
    out = np.zeros(mmh.shape + (4,), dtype=np.uint8)
    for lower, hexc in RAIN_BANDS:  # later (heavier) bands overwrite lighter ones
        m = mmh >= lower
        out[m, 0], out[m, 1], out[m, 2] = (int(hexc[i:i + 2], 16) for i in (1, 3, 5))
        out[m, 3] = RAIN_ALPHA
    return out


def _iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def manifest(run: datetime, hours: list[int]) -> dict:
    tag = run.strftime('%Y%m%d%H')
    return {
        'run': _iso(run),
        'bounds': [[int(SOUTH), int(WEST)], [int(NORTH), int(EAST)]],
        'frames': [
            {'time': _iso(run + timedelta(hours=h)), 'cloud': f'gfs/{tag}/cloud/{h:03d}.png', 'rain': f'gfs/{tag}/rain/{h:03d}.png'}
            for h in hours
        ],
    }


# ── Network parts ───────────────────────────────────────────────────
def _filter_url(run: datetime, h: int) -> str:
    d, c = run.strftime('%Y%m%d'), run.strftime('%H')
    return (f'{NOMADS}?dir=%2Fgfs.{d}%2F{c}%2Fatmos&file=gfs.t{c}z.pgrb2.0p25.f{h:03d}'
            f'&var_TCDC=on&var_PRATE=on&lev_entire_atmosphere=on&lev_surface=on'
            f'&subregion=&leftlon={WEST:g}&rightlon={EAST:g}&toplat={NORTH:g}&bottomlat={SOUTH:g}')


def _get(session, url: str, tries: int = 3) -> bytes | None:
    for i in range(tries):
        try:
            r = session.get(url, timeout=60)
            if r.ok and r.content[:4] == b'GRIB':
                return r.content
        except Exception as e:  # network hiccup: retry
            print('download error', e, file=sys.stderr)
        time.sleep(2 * (i + 1))
    return None


def newest_run(session, now: datetime) -> datetime:
    """The newest cycle whose last hour (f072) is already published."""
    base = now.replace(minute=0, second=0, microsecond=0, hour=now.hour - now.hour % 6)
    for back in range(0, 5):
        run = base - timedelta(hours=6 * back)
        r = session.get(_filter_url(run, HOURS[-1]), timeout=60)
        if r.ok and r.content[:4] == b'GRIB':
            return run
    raise RuntimeError('no complete GFS run found in the last 24 hours')


def decode(blob: bytes) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """→ (lats, lons, cloud %, rain mm/h). Prefers instantaneous fields when both instant and average exist."""
    import eccodes  # imported here so the pure tests run without eccodes installed

    fields: dict[str, tuple[str, np.ndarray, np.ndarray, np.ndarray]] = {}
    with tempfile.TemporaryFile() as f:  # eccodes reads from a real file descriptor
        f.write(blob)
        f.seek(0)
        while True:
            gid = eccodes.codes_grib_new_from_file(f)
            if gid is None:
                break
            try:
                name = eccodes.codes_get(gid, 'shortName')
                step_type = eccodes.codes_get(gid, 'stepType')
                ni, nj = eccodes.codes_get(gid, 'Ni'), eccodes.codes_get(gid, 'Nj')
                lats = np.linspace(eccodes.codes_get(gid, 'latitudeOfFirstGridPointInDegrees'),
                                   eccodes.codes_get(gid, 'latitudeOfLastGridPointInDegrees'), nj)
                lons = np.linspace(eccodes.codes_get(gid, 'longitudeOfFirstGridPointInDegrees'),
                                   eccodes.codes_get(gid, 'longitudeOfLastGridPointInDegrees'), ni)
                vals = eccodes.codes_get_values(gid).reshape(nj, ni)
                if name not in fields or (step_type == 'instant' and fields[name][0] != 'instant'):
                    fields[name] = (step_type, lats, lons, vals)
            finally:
                eccodes.codes_release(gid)
    if 'tcc' not in fields or 'prate' not in fields:
        raise RuntimeError(f'missing fields: {sorted(fields)}')
    _, lats, lons, tcc = fields['tcc']
    return lats, lons, tcc, fields['prate'][3] * 3600.0


def _png(rgba: np.ndarray) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(rgba, 'RGBA').save(buf, 'PNG', optimize=True)
    return buf.getvalue()


class Storage:
    def __init__(self, session, url: str, key: str):
        self.s, self.base = session, url.rstrip('/') + '/storage/v1'
        self.h = {'authorization': f'Bearer {key}', 'apikey': key}

    def put(self, path: str, body: bytes, ctype: str, max_age: int):
        r = self.s.post(f'{self.base}/object/{BUCKET}/{path}', data=body,
                        headers={**self.h, 'content-type': ctype, 'x-upsert': 'true', 'cache-control': f'max-age={max_age}'}, timeout=60)
        if not r.ok:
            raise RuntimeError(f'upload {path}: {r.status_code} {r.text[:200]}')

    def get_json(self, path: str) -> dict | None:
        r = self.s.get(f'{self.base}/object/public/{BUCKET}/{path}', timeout=30)
        return r.json() if r.ok else None

    def list(self, prefix: str) -> list[str]:
        r = self.s.post(f'{self.base}/object/list/{BUCKET}', json={'prefix': prefix, 'limit': 1000}, headers=self.h, timeout=30)
        return [o['name'] for o in r.json()] if r.ok else []

    def delete(self, paths: list[str]):
        if paths:
            self.s.delete(f'{self.base}/object/{BUCKET}', json={'prefixes': paths}, headers=self.h, timeout=60)


def main() -> int:
    import requests

    url, key = os.environ.get('SUPABASE_URL', ''), os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not url or not key:
        print('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required', file=sys.stderr)
        return 2
    s = requests.Session()
    s.headers['user-agent'] = UA
    store = Storage(s, url, key)
    run = newest_run(s, datetime.now(timezone.utc))
    tag = run.strftime('%Y%m%d%H')
    print('GFS run', tag)

    done: list[int] = []
    for h in HOURS:
        blob = _get(s, _filter_url(run, h))
        if blob is None:
            print(f'f{h:03d}: not available, skipped', file=sys.stderr)
            continue
        lats, lons, tcc, rain = decode(blob)
        store.put(f'gfs/{tag}/cloud/{h:03d}.png', _png(cloud_rgba(resample(tcc, lats, lons, WIDTH))), 'image/png', 21600)
        store.put(f'gfs/{tag}/rain/{h:03d}.png', _png(rain_rgba(resample(rain, lats, lons, WIDTH))), 'image/png', 21600)
        done.append(h)
        time.sleep(1)  # be gentle with NOMADS
    if len(done) < len(HOURS) // 2:
        print(f'only {len(done)} hours rendered — keeping the previous manifest', file=sys.stderr)
        return 1

    previous = (store.get_json('gfs/latest.json') or {}).get('run', '')
    store.put('gfs/latest.json', json.dumps(manifest(run, done)).encode(), 'application/json', 300)

    keep = {tag}
    if previous:
        keep.add(datetime.strptime(previous, '%Y-%m-%dT%H:%M:%SZ').strftime('%Y%m%d%H'))
    for old in store.list('gfs/'):
        if old.isdigit() and old not in keep:
            store.delete([f'gfs/{old}/{kind}/{f}' for kind in ('cloud', 'rain') for f in store.list(f'gfs/{old}/{kind}/')])
            print('removed run', old)
    print(f'done: {len(done)} hours')
    return 0


if __name__ == '__main__':
    sys.exit(main())
