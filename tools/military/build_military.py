"""Military sites of the Middle East (without Israel) for the map's "Military bases" group.

Sources: OpenStreetMap through the Overpass API (ODbL — credit "© OpenStreetMap contributors") and Wikidata (CC0)
for who operates each base. Writes public/data/military.geojson (bases, naval bases, ranges and zones) and
public/data/military-minor.geojson (bunkers and checkpoints). Run by .github/workflows/military-data.yml.

  python3 tools/military/build_military.py
"""
from __future__ import annotations

import math
import os
import re

COUNTRIES = frozenset('LB SY JO IQ IR SA YE OM AE QA BH KW EG TR CY PS SD ER DJ SO'.split())
UA = 'osintfront.com data build (+https://osintfront.com)'
OVERPASS = 'https://overpass-api.de/api/interpreter'
WIKIDATA = 'https://query.wikidata.org/sparql'
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'data')
MIN_SITES = 1000
MAX_BYTES = 8_000_000

# ── Classification ──────────────────────────────────────────────────
SKIP_MILITARY = {'airfield', 'trench', 'obstacle_course'}
MINOR = {'bunker', 'checkpoint'}
RANGES = {'range', 'training_area', 'danger_area', 'nuclear_explosion_site'}
# Navy / coast guard in English, Arabic, Turkish and Persian.
NAVAL = re.compile(r'naval|navy|coast ?guard|بحري|خفر السواحل|deniz|donanma|sahil güvenlik|دریایی', re.I)
HEBREW = re.compile('[֐-׿]')

# Operator text → country code. First match wins, so the narrower patterns come first.
OPERATORS: list[tuple[str, re.Pattern]] = [(cc, re.compile(p, re.I)) for cc, p in [
    ('IL', r'israel|\bidf\b|צה"ל|צבא'),
    ('GB', r'royal air force|royal navy|british|\bRAF\b'),
    ('US', r'united states|\bu\.s\.|\bus (?:navy|army|air force|marine)|usaf|centcom'),
    ('FR', r'french|france|armée|marine nationale'),
    ('RU', r'russia'),
    ('TR', r'turkish|türk|\btsk\b'),
    ('IR', r'iran|irgc'),
    ('IT', r'italian|italia'),
    ('DE', r'german|bundeswehr'),
    ('CN', r'chinese|china|\bpla\b'),
    ('JP', r'japan'),
    ('IN', r'\bindian\b|\bindia\b'),
    ('AE', r'emirati|\buae\b'),
    ('SA', r'saudi'),
    ('EG', r'egypt'),
]]


def _name(tags: dict) -> str:
    return (tags.get('name') or '') + ' ' + (tags.get('name:en') or '')


def classify(tags: dict[str, str]) -> str | None:
    """base / naval / range / minor, or None for sites this layer leaves out."""
    mil = tags.get('military')
    if mil in SKIP_MILITARY or tags.get('aeroway') == 'aerodrome' or tags.get('disused') == 'yes' or tags.get('abandoned') == 'yes':
        return None
    if mil in MINOR:
        return 'minor'
    if mil == 'naval_base' or NAVAL.search(_name(tags)):
        return 'naval'
    if mil in RANGES:
        return 'range'
    if mil or tags.get('name'):
        return 'base'
    return 'range'  # an unnamed landuse=military: a military zone


def operator_cc(text: str | None) -> str | None:
    if not text:
        return None
    for cc, rx in OPERATORS:
        if rx.search(text):
            return cc
    return None


def israeli(tags: dict, cc: str, op_cc: str | None, kind: str) -> bool:
    """Sites operated by Israel are left out everywhere (name:he alone is only a display name)."""
    if op_cc == 'IL' or HEBREW.search(tags.get('name') or ''):
        return True
    return cc == 'PS' and kind == 'minor' and tags.get('military') == 'checkpoint'


# ── Overpass ────────────────────────────────────────────────────────
def overpass_query(cc: str) -> str:
    return (f'[out:json][timeout:300];area["ISO3166-1"="{cc}"][admin_level=2]->.a;'
            '(nwr["military"](area.a);nwr["landuse"="military"](area.a););out bb qt;')


def _sig2(v: float) -> float:
    return float(f'{v:.2g}') if v > 0 else 0.0


def area_km2(b: dict) -> float | None:
    """Rough area of a bounding box in km², 2 significant figures."""
    try:
        dlat = (b['maxlat'] - b['minlat']) * 111.32
        dlng = (b['maxlon'] - b['minlon']) * 111.32 * math.cos(math.radians((b['maxlat'] + b['minlat']) / 2))
    except (KeyError, TypeError):
        return None
    return _sig2(abs(dlat * dlng))


def parse_overpass(data: dict, cc: str) -> list[dict]:
    """Overpass JSON → sites {k, lat, lng, cc, tags, osm, km2}. A timeout or error remark is a failure, not a short answer."""
    remark = str(data.get('remark') or '')
    if re.search(r'error|timed out', remark, re.I):
        raise ValueError(f'Overpass {cc}: {remark}')
    elements = data.get('elements')
    if not isinstance(elements, list):
        raise ValueError(f'Overpass {cc}: no "elements" in the answer (keys: {sorted(data)})')
    sites = []
    for el in elements:
        tags = el.get('tags') or {}
        k = classify(tags)
        if not k or israeli(tags, cc, operator_cc(tags.get('operator')), k):
            continue
        b = el.get('bounds')
        if 'lat' in el:
            lat, lng = el['lat'], el['lon']
        elif el.get('center'):
            lat, lng = el['center']['lat'], el['center']['lon']
        elif b:
            lat, lng = (b['minlat'] + b['maxlat']) / 2, (b['minlon'] + b['maxlon']) / 2
        else:
            continue
        sites.append({'k': k, 'lat': round(lat, 5), 'lng': round(lng, 5), 'cc': cc, 'tags': tags,
                      'osm': el['type'][0] + str(el['id']), 'km2': area_km2(b) if b else None})
    return sites


def km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lng - a_lng) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def dedupe(sites: list[dict]) -> list[dict]:
    """A base mapped twice (a named point inside its named area): one site of the same kind and name within 1 km, the larger kept."""
    keep: list[dict] = []
    groups: dict[tuple[str, str], list[dict]] = {}
    for s in sites:
        name = (s['tags'].get('name') or '').strip()
        if not name:
            keep.append(s)
            continue
        group = groups.setdefault((s['k'], name), [])
        for i, g in enumerate(group):
            if km(s['lat'], s['lng'], g['lat'], g['lng']) <= 1.0:
                if (s['km2'] or 0) > (g['km2'] or 0):
                    group[i] = s
                break
        else:
            group.append(s)
    for group in groups.values():
        keep.extend(group)
    return keep
