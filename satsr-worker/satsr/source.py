"""Where the Sentinel-2 pixels come from.

PlanetaryComputerSource: Microsoft Planetary Computer's STAC (collection sentinel-2-l2a, free,
no account; asset links are signed with planetary_computer). Only the 2.56 km box is read from
the cloud-optimised GeoTIFFs, never the whole tile. Another source (e.g. Copernicus Data Space)
only needs the same three methods: search, stats, read.

pick_scene is pure (no network) so the choice of picture is tested offline.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Iterable

import numpy as np

log = logging.getLogger("satsr.source")

BANDS = ("B04", "B03", "B02", "B08")       # red, green, blue, near infrared (all 10 m)
CLOUD_CLASSES = (3, 8, 9, 10)              # SCL: cloud shadow, cloud medium / high probability, thin cirrus
NODATA_CLASS = 0
MAX_NODATA = 0.02                          # skip a box with more than 2 % empty pixels
GDAL_ENV = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_HTTP_MAX_RETRY": "3", "GDAL_HTTP_RETRY_DELAY": "2",
            "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.TIF,.tiff"}


class NoScene(Exception):
    """No usable picture for this place (and date): the job fails as no_scene, the use is given back."""


class SourceError(RuntimeError):
    """The data source could not be reached or read (worth another attempt)."""


@dataclass
class Scene:
    id: str
    date: date                     # UTC day of the acquisition
    cloud_scene: float | None      # whole-tile cloud cover from the catalogue (%)
    baseline: str | None           # s2:processing_baseline, e.g. "05.10"
    hrefs: dict[str, str] = field(default_factory=dict)  # band → (signed) COG link, incl. "SCL"
    mgrs: str | None = None
    when: datetime | None = None


@dataclass
class BoxStats:
    cloud_pct: float               # share of the box in cloud / shadow / cirrus (0..100)
    nodata: float                  # share of empty pixels (0..1)
    inside: bool                   # the whole box lies inside the tile


def boa_offset(baseline: str | None) -> int:
    """Processing baseline 04.00 and later store reflectance + 1000 (BOA_ADD_OFFSET = -1000)."""
    try:
        return 1000 if baseline is not None and float(baseline) >= 4.0 else 0
    except ValueError:
        return 0


def to_reflectance(dn: np.ndarray, baseline: str | None, harmonize: bool) -> np.ndarray:
    """Digital numbers → reflectance 0..1 (float32)."""
    x = dn.astype(np.float32)
    off = boa_offset(baseline) if harmonize else 0
    if off:
        x = np.clip(x - off, 0, None)
    return x / 10000.0


def pick_scene(candidates: Iterable[Scene], read_fn: Callable[[Scene], BoxStats], max_cloud: float = 10.0,
               fixed_date: bool = False) -> tuple[Scene, float]:
    """Choose the picture. Returns (scene, box cloud %), or raises NoScene.

    candidates: newest first. read_fn measures the box in one candidate (SCL band).
    Without a date: the newest whose box cloud is at most max_cloud; otherwise the least cloudy.
    With a date (candidates are that day's tiles): the best one that day, whatever its cloud.
    A box with more than 2 % empty pixels, or not wholly inside the tile, is skipped (an
    overlapping tile of the same pass usually covers it).
    """
    best: tuple[Scene, float] | None = None
    for s in candidates:
        try:
            st = read_fn(s)
        except SourceError as e:
            log.warning("skipping %s: %s", s.id, e)
            continue
        if not st.inside or st.nodata > MAX_NODATA:
            continue
        if not fixed_date and st.cloud_pct <= max_cloud:
            return s, st.cloud_pct
        if best is None or st.cloud_pct < best[1]:
            best = (s, st.cloud_pct)
    if best is None:
        raise NoScene("no usable Sentinel-2 picture for this place" + (" on that day" if fixed_date else ""))
    return best


def box_stats(scl: np.ndarray, b04: np.ndarray, inside: bool = True) -> BoxStats:
    """Cloud % and empty share of a box from its SCL classes (upsampled to 10 m) and its red band."""
    n = scl.size or 1
    empty = (scl == NODATA_CLASS) | (b04 == 0)
    clouds = np.isin(scl, CLOUD_CLASSES) & ~empty
    valid = max(n - int(empty.sum()), 1)
    return BoxStats(cloud_pct=100.0 * float(clouds.sum()) / valid, nodata=float(empty.sum()) / n, inside=inside)


class PlanetaryComputerSource:
    name = "planetary_computer"
    URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
    COLLECTION = "sentinel-2-l2a"

    def __init__(self, harmonize: bool = True, max_items: int = 30):
        self.harmonize = harmonize
        self.max_items = max_items
        self._client = None

    # ── catalogue ──
    def _catalog(self):
        if self._client is None:
            import planetary_computer
            import pystac_client

            self._client = pystac_client.Client.open(self.URL, modifier=planetary_computer.sign_inplace)
        return self._client

    def search(self, lat: float, lng: float, day: date | None = None, days: int = 60) -> list[Scene]:
        """Pictures covering the point: that UTC day, or the last `days` days (newest first)."""
        if day is not None:
            when = f"{day.isoformat()}T00:00:00Z/{day.isoformat()}T23:59:59Z"
            query = None
        else:
            end = datetime.now(timezone.utc)
            when = f"{(end - timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%SZ')}/{end.strftime('%Y-%m-%dT%H:%M:%SZ')}"
            query = {"eo:cloud_cover": {"lt": 90}}
        try:
            search = self._catalog().search(collections=[self.COLLECTION], intersects={"type": "Point", "coordinates": [lng, lat]},
                                            datetime=when, query=query, max_items=self.max_items)
            items = list(search.items())
        except Exception as e:  # noqa: BLE001 - network / API errors are worth a retry
            raise SourceError(f"catalogue search failed: {e}") from e
        scenes = []
        for it in items:
            p = it.properties
            if not all(b in it.assets for b in (*BANDS, "SCL")):
                continue
            scenes.append(Scene(id=it.id, date=it.datetime.date(), when=it.datetime, cloud_scene=p.get("eo:cloud_cover"),
                                baseline=p.get("s2:processing_baseline"), mgrs=p.get("s2:mgrs_tile"),
                                hrefs={b: it.assets[b].href for b in (*BANDS, "SCL")}))
        scenes.sort(key=lambda s: (s.when or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
        if day is not None:  # one day: the clearest tile first
            scenes.sort(key=lambda s: s.cloud_scene if s.cloud_scene is not None else 100)
        return scenes

    # ── pixels ──
    def _window(self, ds, lat, lng, box_px):
        from rasterio.windows import Window

        from .grid import utm_window

        col0, row0, tr = utm_window(lat, lng, ds.transform, ds.crs, box_px)
        inside = col0 >= 0 and row0 >= 0 and col0 + box_px <= ds.width and row0 + box_px <= ds.height
        return Window(col0, row0, box_px, box_px), tr, inside

    def stats(self, scene: Scene, lat: float, lng: float, box_px: int) -> BoxStats:
        import rasterio
        from rasterio.enums import Resampling
        from rasterio.transform import array_bounds
        from rasterio.windows import from_bounds

        try:
            with rasterio.Env(**GDAL_ENV):
                with rasterio.open(scene.hrefs["B04"]) as ds:
                    win, tr, inside = self._window(ds, lat, lng, box_px)
                    if not inside:
                        return BoxStats(cloud_pct=100.0, nodata=1.0, inside=False)
                    b04 = ds.read(1, window=win)
                with rasterio.open(scene.hrefs["SCL"]) as scl_ds:  # 20 m: read the same ground, nearest, at 10 m
                    w20 = from_bounds(*array_bounds(box_px, box_px, tr), transform=scl_ds.transform)
                    scl = scl_ds.read(1, window=w20, out_shape=(box_px, box_px), resampling=Resampling.nearest)
        except Exception as e:  # noqa: BLE001
            raise SourceError(f"{scene.id}: {e}") from e
        return box_stats(scl, b04, inside)

    def read(self, scene: Scene, lat: float, lng: float, box_px: int):
        """→ (x [4, box, box] float32 reflectance B04,B03,B02,B08, window transform, crs, valid mask)."""
        import rasterio

        try:
            with rasterio.Env(**GDAL_ENV):
                bands = []
                for b in BANDS:
                    with rasterio.open(scene.hrefs[b]) as ds:
                        win, tr, inside = self._window(ds, lat, lng, box_px)
                        if not inside:
                            raise SourceError(f"{scene.id}: box outside the tile")
                        bands.append(ds.read(1, window=win))
                        crs = ds.crs
        except SourceError:
            raise
        except Exception as e:  # noqa: BLE001
            raise SourceError(f"{scene.id}: {e}") from e
        dn = np.stack(bands)
        valid = dn[0] > 0
        return to_reflectance(dn, scene.baseline, self.harmonize), tr, crs, valid
