"""Airfields and ports of the Middle East (without Israel) for the map's "Airfields & ports" section.

Sources (public domain): OurAirports (airports.csv, runways.csv) and the NGA World Port Index (Pub. 150).
Writes public/data/airfields.geojson and public/data/ports.geojson. Run by .github/workflows/infra-data.yml.

  python3 tools/infra/build_infra.py                 # both files
  python3 tools/infra/build_infra.py --airfields-only
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import urllib.request

COUNTRIES = frozenset('LB SY JO IQ IR SA YE OM AE QA BH KW EG TR CY PS SD ER DJ SO'.split())
OURAIRPORTS = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/'
WPI = 'https://msi.nga.mil/api/publications/world-port-index?output=csv'
UA = 'osintfront.com data build (+https://osintfront.com)'
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'data')
# Ports are also checked against this box (lat 0–45, lon 24–65), so a code that means another country
# elsewhere (FIPS vs ISO) can never pull in a port outside the region.
REGION = (0.0, 45.0, 24.0, 65.0)

# "AB", "AFB" and "RAF" only in capitals ("Ab Pakhsh", "Rafsanjan" are not bases).
MILITARY = re.compile(r'\b(air ?base|airbase|air force|military|naval|navy|army|air defen[cs]e|forward operating base|قاعدة)\b'
                      r'|(?-i:\b(AB|AFB|RAF)\b)', re.I)
NOT_MILITARY = re.compile(r'hospital|medical|museum', re.I)
MIN_AIRFIELDS = 1500  # ~2,100 today; fewer means a short or broken download
COASTAL = ('LB', 'SY', 'TR', 'CY', 'EG', 'SA', 'YE', 'OM', 'AE', 'QA', 'BH', 'KW', 'IQ', 'IR', 'SD', 'ER', 'DJ', 'SO', 'PS')
CIVIL_TYPES = {'large_airport', 'medium_airport'}

# Country names, ISO 3166 alpha-2 and FIPS 10-4 codes → ISO alpha-2 (the WPI has used each over the years).
COUNTRY_KEYS = {
    'LB': ['lebanon', 'LE'], 'SY': ['syria', 'syrian arab republic'], 'JO': ['jordan'], 'IQ': ['iraq', 'IZ'],
    'IR': ['iran', 'iran, islamic republic of', 'iran (islamic republic of)', 'islamic republic of iran'], 'SA': ['saudi arabia'], 'YE': ['yemen', 'YM'], 'OM': ['oman', 'MU'],
    'AE': ['united arab emirates', 'uae', 'u.a.e.'], 'QA': ['qatar'], 'BH': ['bahrain', 'BA'], 'KW': ['kuwait', 'KU'],
    'EG': ['egypt'], 'TR': ['turkey', 'turkiye', 'türkiye', 'turkey (türkiye)', 'türkiye (turkey)', 'TU'], 'CY': ['cyprus'],
    'PS': ['palestine', 'state of palestine', 'gaza strip', 'gaza', 'west bank', 'palestinian territory', 'palestinian territory, occupied',
           'occupied palestinian territory', 'GZ', 'WE'],
    'SD': ['sudan', 'SU'], 'ER': ['eritrea'], 'DJ': ['djibouti'], 'SO': ['somalia'],
    'IL': ['israel', 'IS'],
}
COUNTRY_LOOKUP = {}
for iso, keys in COUNTRY_KEYS.items():
    COUNTRY_LOOKUP[iso.lower()] = iso
    for k in keys:
        COUNTRY_LOOKUP[k.lower()] = iso

PORT_COLUMNS = {
    'name': ['mainportname', 'portname', 'name'],
    'country': ['countrycode', 'countryname', 'country'],
    # Decimal ycoord/xcoord first: some exports also carry degree-minute "Latitude"/"Longitude" text.
    'lat': ['ycoord', 'latitude', 'lat'],
    'lng': ['xcoord', 'longitude', 'lon', 'lng'],
    'size': ['harborsize', 'harboursize'],
    'type': ['harbortype', 'harbourtype'],
    'ch': ['channeldepthm', 'chdepth', 'channeldepth'],
    'an': ['anchoragedepthm', 'andepth', 'anchoragedepth'],
    'cp': ['cargopierdepthm', 'cpdepth', 'cargopierdepth'],
}
REQUIRED = ('name', 'country', 'lat', 'lng')
SIZES = {'l': 'L', 'large': 'L', 'm': 'M', 'medium': 'M', 's': 'S', 'small': 'S', 'v': 'V', 'very small': 'V', 'verysmall': 'V'}


def _num(v: str) -> float | None:
    try:
        f = float(str(v).strip())
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # NaN → None


def _pt(lng: float, lat: float) -> dict:
    return {'type': 'Point', 'coordinates': [round(lng, 5), round(lat, 5)]}


# ── Airfields ───────────────────────────────────────────────────────
def classify(row: dict) -> str | None:
    if row.get('iso_country') not in COUNTRIES:
        return None
    t = row.get('type', '')
    if t == 'closed':
        return 'closed'
    name = row.get('name', '')
    # Keywords count only for fields without scheduled flights ("Beirut Air Base" is a keyword of Beirut airport).
    text = name if row.get('scheduled_service') == 'yes' else f"{name} {row.get('keywords', '')}"
    if MILITARY.search(text) and not NOT_MILITARY.search(f"{name} {row.get('keywords', '')}"):
        return 'military'
    if t in CIVIL_TYPES or (t == 'small_airport' and (row.get('icao_code') or row.get('iata_code'))):
        return 'civil'
    return 'strip'


def runways_for(rows: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for r in rows:
        if r.get('closed') == '1':
            continue
        length = _num(r.get('length_ft', ''))
        if not length:
            continue
        out.setdefault(r['airport_ident'], []).append({'l': int(length), 's': r.get('surface', '').strip(), 'lit': r.get('lighted') == '1'})
    return out


def airfield_feature(row: dict, runways: list[dict]) -> dict:
    p: dict = {'k': classify(row), 'n': row['name'].strip(), 't': row['type'], 'cc': row['iso_country']}
    for key, src in (('icao', 'icao_code'), ('iata', 'iata_code')):
        if row.get(src, '').strip():
            p[key] = row[src].strip()
    el = _num(row.get('elevation_ft', ''))
    if el is not None:
        p['el'] = int(el)
    if runways:
        p['rw'] = runways
    return {'type': 'Feature', 'geometry': _pt(float(row['longitude_deg']), float(row['latitude_deg'])), 'properties': p}


def feature_collection(features: list[dict]) -> dict:
    return {'type': 'FeatureCollection', 'features': features}


# ── Ports ───────────────────────────────────────────────────────────
def _norm(h: str) -> str:
    return re.sub(r'[^a-z0-9]', '', h.lower())


def port_columns(headers: list[str]) -> dict[str, str]:
    by_norm = {_norm(h): h for h in headers}
    cols = {}
    for logical, candidates in PORT_COLUMNS.items():
        for c in candidates:
            if c in by_norm:
                cols[logical] = by_norm[c]
                break
    missing = [k for k in REQUIRED if k not in cols]
    if missing:
        raise ValueError(f'World Port Index: missing {missing}; headers seen: {headers}')
    return cols


def country_iso(value: str) -> str | None:
    v = str(value or '').strip().lower()
    if v in COUNTRY_LOOKUP:
        return COUNTRY_LOOKUP[v]
    bare = re.sub(r'\s*\(.*?\)\s*', ' ', v).strip()  # "Iran (Islamic Republic of)" → "iran"
    return COUNTRY_LOOKUP.get(bare)


def missing_coastal(features: list[dict]) -> list[str]:
    have = {f['properties']['cc'] for f in features}
    return [cc for cc in COASTAL if cc not in have]


def check_airfields(n: int):
    if n < MIN_AIRFIELDS:
        raise ValueError(f'only {n} airfields (expected at least {MIN_AIRFIELDS}) — download short or format changed')


def port_feature(row: dict, cols: dict[str, str]) -> dict | None:
    iso = country_iso(row.get(cols['country'], ''))
    lat, lng = _num(row.get(cols['lat'], '')), _num(row.get(cols['lng'], ''))
    if iso is None or iso == 'IL' or iso not in COUNTRIES or lat is None or lng is None:
        return None
    if not (REGION[0] <= lat <= REGION[1] and REGION[2] <= lng <= REGION[3]):
        return None
    p: dict = {'n': str(row[cols['name']]).strip(), 'cc': iso}
    if 'size' in cols:
        sz = SIZES.get(str(row.get(cols['size'], '')).strip().lower())
        if sz:
            p['sz'] = sz
    if 'type' in cols and str(row.get(cols['type'], '')).strip():
        p['ty'] = str(row[cols['type']]).strip()
    for key in ('ch', 'an', 'cp'):
        if key in cols:
            v = _num(row.get(cols[key], ''))
            if v is not None and v > 0:
                p[key] = round(v, 1)
    return {'type': 'Feature', 'geometry': _pt(lng, lat), 'properties': p}


# ── Build ───────────────────────────────────────────────────────────
def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={'user-agent': UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode('utf-8-sig')


def _write(name: str, fc: dict):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump(fc, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    print(f'{name}: {len(fc["features"])} features')


def build_airfields():
    airports = list(csv.DictReader(io.StringIO(_get(OURAIRPORTS + 'airports.csv'))))
    runways = runways_for(list(csv.DictReader(io.StringIO(_get(OURAIRPORTS + 'runways.csv')))))
    feats = [airfield_feature(r, runways.get(r['ident'], [])) for r in airports if classify(r)]
    check_airfields(len(feats))
    feats.sort(key=lambda f: (f['properties']['cc'], f['properties']['n']))
    _write('airfields.geojson', feature_collection(feats))


def build_ports():
    rows = list(csv.DictReader(io.StringIO(_get(WPI))))
    if not rows:
        raise ValueError('World Port Index: empty download')
    cols = port_columns(list(rows[0].keys()))
    feats = [f for f in (port_feature(r, cols) for r in rows) if f]
    # Country values we did not recognise (with counts), to spot a new spelling.
    unknown: dict[str, int] = {}
    for r in rows:
        v = str(r.get(cols['country'], '')).strip()
        if v and country_iso(v) is None:
            unknown[v] = unknown.get(v, 0) + 1
    print('ports per country:', {cc: sum(f['properties']['cc'] == cc for f in feats) for cc in COASTAL})
    print('unrecognised country values (top 30):', sorted(unknown.items(), key=lambda kv: -kv[1])[:30])
    gaps = [cc for cc in missing_coastal(feats) if cc != 'PS']  # Gaza may have no listed port
    if gaps:
        raise ValueError(f'World Port Index: no ports for {gaps} — country spelling changed?')
    feats.sort(key=lambda f: (f['properties']['cc'], f['properties']['n']))
    _write('ports.geojson', feature_collection(feats))


def main(argv: list[str]) -> int:
    """0 = both written · 2 = airfields written, ports kept from the last run · 3 = nothing written (airfields failed)."""
    try:
        build_airfields()
    except Exception as e:
        print(f'airfields not updated: {e}', file=sys.stderr)
        return 3
    if '--airfields-only' in argv:
        return 0
    try:
        build_ports()
    except Exception as e:  # keep the previous ports file
        print(f'ports not updated: {e}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
