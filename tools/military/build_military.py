"""Military sites of the Middle East (without Israel) for the map's "Military bases" group.

Sources: OpenStreetMap through the Overpass API (ODbL — credit "© OpenStreetMap contributors") and Wikidata (CC0)
for who operates each base. Writes public/data/military.geojson (bases, naval bases, ranges and zones) and
public/data/military-minor.geojson (bunkers and checkpoints). Run by .github/workflows/military-data.yml.

  python3 tools/military/build_military.py
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

COUNTRIES = frozenset('LB SY JO IQ IR SA YE OM AE QA BH KW EG TR CY PS SD ER DJ SO'.split())
UA = 'osintfront.com data build (+https://osintfront.com)'
OVERPASS = 'https://overpass-api.de/api/interpreter'
OVERPASS_MIRROR = 'https://overpass.private.coffee/api/interpreter'  # tried when the main server is full
WIKIDATA = 'https://query.wikidata.org/sparql'
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'data')
MIN_SITES = 1000
MAX_BYTES = 8_000_000
MUST_HAVE = ('TR', 'IR', 'EG', 'SA')
PAUSE = 5           # seconds between Overpass countries
RETRY = (60, 180, 420)  # waits before the 2nd, 3rd and 4th try of a country (the public server is often full)

# ── Classification ──────────────────────────────────────────────────
SKIP_MILITARY = {'airfield', 'trench', 'obstacle_course'}
MINOR = {'bunker', 'checkpoint', 'shelter'}
RANGES = {'range', 'training_area', 'danger_area', 'danger_zone', 'nuclear_explosion_site'}
# Navy / coast guard in English, Arabic, Turkish and Persian.
NAVAL = re.compile(r'naval|navy|coast ?guard|بحري|خفر السواحل|deniz|donanma|sahil güvenlik|دریایی', re.I)
HEBREW = re.compile('[֐-׿]')

# Operator text → country code. First match wins, so the narrower patterns come first.
OPERATORS: list[tuple[str, re.Pattern]] = [(cc, re.compile(p, re.I)) for cc, p in [
    ('IL', r'israel|\bidf\b|צה"ל|צבא'),
    ('UN', r'united nations|\bundof\b|\bunifil\b'),
    ('SU', r'soviet'),
    ('OM', r'\bof oman\b|\bomani\b'),  # "Royal Air Force of Oman" is not British
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
    ('AE', r'emirati|emirates|\buae\b'),
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
    if mil in ('naval_base', 'coastguard') or NAVAL.search(_name(tags)):
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
    # "out bb": bounds for areas, coordinates for points (checked live 2026-11-06; way node lists come along).
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


# ── Wikidata ────────────────────────────────────────────────────────
# Discovery only (sites, labels, classes): the light query that answers in time. Operators, end dates and
# closures come from wbgetentities, because heavier SPARQL queries time out (checked 2026-11-06).
# Q245016 = "military base"; "airbase" (Q695850) and "naval base" are subclasses of it.
WIKIDATA_QUERY = """SELECT ?item ?itemLabel ?he ?coord ?cc (GROUP_CONCAT(DISTINCT ?clsLabel; separator="|") AS ?classes) WHERE {
  VALUES ?cc { %s }
  ?country wdt:P297 ?cc .
  ?item wdt:P17 ?country ; wdt:P625 ?coord ; wdt:P31/wdt:P279* wd:Q245016 .
  OPTIONAL { ?item rdfs:label ?he FILTER(lang(?he) = "he") }
  OPTIONAL { ?item wdt:P31 ?cls . ?cls rdfs:label ?clsLabel FILTER(lang(?clsLabel) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". ?item rdfs:label ?itemLabel . }
} GROUP BY ?item ?itemLabel ?he ?coord ?cc""" % ' '.join(f'"{c}"' for c in sorted(COUNTRIES))

ENTITIES = 'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims%7Clabels&languages=en%7Che&ids='
CLOSED_PROPS = ('P576', 'P3999', 'P582')  # dissolved / closed / end time
DISSOLVED = {'SU', 'YU', 'CS', 'DD'}
NAVAL_CLASS = re.compile(r'naval', re.I)
AIR_CLASS = re.compile(r'air ?base|air station|aerodrome|airport', re.I)
HISTORIC_CLASS = re.compile(r'^(ruins|destroyed building or structure|archaeological site|museum|castle|fortress|palace)$', re.I)
POINT = re.compile(r'Point\(\s*(-?[\d.]+(?:[eE]-?\d+)?)\s+(-?[\d.]+(?:[eE]-?\d+)?)\s*\)')


def parse_wikidata(data: dict) -> list[dict]:
    """SPARQL JSON → items {qid, lat, lng, cc, en, he, naval, air, historic}, one per QID."""
    try:
        rows = data['results']['bindings']
    except (KeyError, TypeError):
        raise ValueError(f'Wikidata: unexpected answer (keys: {sorted(data) if isinstance(data, dict) else type(data)})')
    items: dict[str, dict] = {}
    for b in rows:
        qid = b['item']['value'].rsplit('/', 1)[-1]
        m = POINT.match(b.get('coord', {}).get('value', ''))
        if qid in items or not m:
            continue
        classes = [c for c in b.get('classes', {}).get('value', '').split('|') if c]
        en = b.get('itemLabel', {}).get('value')
        items[qid] = {
            'qid': qid, 'lng': round(float(m.group(1)), 5), 'lat': round(float(m.group(2)), 5), 'cc': b['cc']['value'],
            'en': None if not en or en == qid else en, 'he': b.get('he', {}).get('value'),
            'naval': any(NAVAL_CLASS.search(c) for c in classes), 'air': any(AIR_CLASS.search(c) for c in classes),
            'historic': any(HISTORIC_CLASS.match(c) for c in classes),
        }
    return list(items.values())


def _claims(e: dict, p: str) -> list[dict]:
    return [c for c in (e.get('claims') or {}).get(p, []) if c.get('rank') != 'deprecated']


def _value(c: dict):
    dv = c.get('mainsnak', {}).get('datavalue')
    return dv['value'] if dv else None


def _label(e: dict, lang: str) -> str | None:
    return ((e.get('labels') or {}).get(lang) or {}).get('value')


def site_facts(ents: dict) -> dict[str, dict]:
    """wbgetentities entities → {qid: {closed, ops: [operator QIDs], en, he}}; ended or deprecated operator statements left out."""
    out = {}
    for qid, e in ents.items():
        ops = []
        for c in _claims(e, 'P137'):
            v = _value(c)
            if isinstance(v, dict) and v.get('id') and 'P582' not in (c.get('qualifiers') or {}):
                ops.append(v['id'])
        out[qid] = {'closed': any(_claims(e, p) for p in CLOSED_PROPS), 'ops': ops, 'en': _label(e, 'en'), 'he': _label(e, 'he')}
    return out


def operator_facts(ents: dict) -> dict[str, dict]:
    """{operator QID: {name, cc, gone}}: the country from the name first, then the operator's own code, then its country's code."""
    def code(e: dict | None) -> str | None:
        for c in _claims(e or {}, 'P297'):
            v = _value(c)
            if isinstance(v, str) and v:
                return v.upper()
        return None
    out = {}
    for qid, e in ents.items():
        name = _label(e, 'en')
        cc = operator_cc(name) or code(e)
        if not cc:
            for c in _claims(e, 'P17'):
                v = _value(c)
                cc = code(ents.get(v['id'])) if isinstance(v, dict) else None
                if cc:
                    break
        gone = cc in DISSOLVED
        out[qid] = {'name': name, 'cc': None if gone else cc, 'gone': gone}
    return out


def _set_ops(site: dict, ops: list[tuple[str | None, str | None]]):
    """ops = [(name, cc)]: op = the first foreign country (else the first known one), opn = all names."""
    ccs = [cc for _, cc in ops if cc]
    foreign = [cc for cc in ccs if cc != site['cc']]
    site['op'] = foreign[0] if foreign else (ccs[0] if ccs else None)
    site['opn'] = ' · '.join(n for n, _ in ops if n) or None
    site['f'] = True if foreign else None
    site['_ccs'] = ccs


def merge(sites: list[dict], items: list[dict], facts: dict, ops: dict) -> list[dict]:
    """Operators and Wikidata links onto the OSM sites; unmatched Wikidata sites added; Israeli-operated sites dropped."""
    def wops(qid: str) -> list[tuple[str | None, str | None]]:
        f = facts.get(qid)
        if not f or f['closed']:
            return []
        return [(ops[o]['name'], ops[o]['cc']) for o in f['ops'] if o in ops and not ops[o].get('gone')]

    def link(site: dict, qid: str):
        site['wd'] = qid
        f = facts.get(qid) or {}
        site.setdefault('en', f.get('en'))
        site.setdefault('he', f.get('he'))
        o = wops(qid)
        if o:
            _set_ops(site, o)

    by_tag = {s['tags']['wikidata']: s for s in sites if s['tags'].get('wikidata')}
    linked: set[str] = set()
    out = list(sites)
    for it in items:
        qid = it['qid']
        if (facts.get(qid) or {}).get('closed'):
            continue
        match = by_tag.get(qid)
        if not match:
            near = [s for s in sites if s['k'] in ('base', 'naval') and s['tags'].get('wikidata') in (None, qid)
                    and km(s['lat'], s['lng'], it['lat'], it['lng']) <= 3.0]
            match = min(near, key=lambda s: km(s['lat'], s['lng'], it['lat'], it['lng'])) if near else None
        if match:
            link(match, qid)
            linked.add(qid)
            continue
        if it['historic']:
            continue
        new = {'k': 'naval' if it['naval'] else 'base', 'lat': it['lat'], 'lng': it['lng'], 'cc': it['cc'], 'tags': {}, 'osm': None,
               'km2': None, 'n': it['en'], 'en': it['en'], 'he': it['he'], 'air': True if it['air'] else None}
        link(new, qid)
        if it['air'] and not new.get('f'):
            continue  # the airfields layer shows host-country air bases
        out.append(new)
    for qid, s in by_tag.items():
        if qid not in linked and qid in facts:
            link(s, qid)
    for s in out:
        if not s.get('op') and s['tags'].get('operator'):
            _set_ops(s, [(s['tags']['operator'], operator_cc(s['tags']['operator']))])
    return [s for s in out if not israeli(s['tags'], s['cc'], 'IL' if 'IL' in s.get('_ccs', []) else s.get('op'), s['k'])]


def site_feature(s: dict) -> dict:
    """GeoJSON point with the published properties only; empty values left out."""
    t = s['tags']
    props = {'k': s['k'], 'cc': s['cc'], 'osm': s.get('osm'), 'n': t.get('name') or s.get('n'), 'en': t.get('name:en') or s.get('en'),
             'he': t.get('name:he') or s.get('he'), 'km2': s.get('km2'), 'wd': s.get('wd'), 'op': s.get('op'), 'opn': s.get('opn'),
             'f': s.get('f'), 'air': s.get('air')}
    return {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [s['lng'], s['lat']]},
            'properties': {k: v for k, v in props.items() if v not in (None, '', False)}}


# ── Gate and build ──────────────────────────────────────────────────
def _fc(features: list[dict]) -> dict:
    return {'type': 'FeatureCollection', 'features': features}


def _bytes(features: list[dict]) -> int:
    return len(json.dumps(_fc(features), ensure_ascii=False, separators=(',', ':')).encode())


def size_guard(features: list[dict], limit: int = MAX_BYTES) -> list[dict]:
    """Over the limit: drop unnamed zones under 0.05 km² (a point counts as 0), then fail if still over."""
    if _bytes(features) <= limit:
        return features
    def small_unnamed(f: dict) -> bool:
        p = f['properties']
        return p['k'] == 'range' and not (p.get('n') or p.get('en') or p.get('he')) and (p.get('km2') or 0) < 0.05
    kept = [f for f in features if not small_unnamed(f)]
    size = _bytes(kept)
    if size > limit:
        raise ValueError(f'military.geojson is {size} bytes after dropping small unnamed zones (limit {limit})')
    print(f'size guard: dropped {len(features) - len(kept)} small unnamed zones')
    return kept


def check(main: list[dict], failed: list[str]) -> None:
    if failed:
        raise ValueError(f'Overpass failed for {failed}')
    if len(main) < MIN_SITES:
        raise ValueError(f'only {len(main)} sites (floor {MIN_SITES}) — a short or broken download?')
    have = {f['properties']['cc'] for f in main}
    missing = [cc for cc in MUST_HAVE if cc not in have]
    if missing:
        raise ValueError(f'no sites for {missing}')


def _fetch(url: str, data: bytes | None = None) -> dict:
    accept = 'application/sparql-results+json' if url.startswith(WIKIDATA) else 'application/json'
    req = urllib.request.Request(url, data=data, headers={'user-agent': UA, 'accept': accept})
    with urllib.request.urlopen(req, timeout=360) as r:
        return json.loads(r.read().decode('utf-8'))


def _overpass(cc: str) -> list[dict]:
    data = urllib.parse.urlencode({'data': overpass_query(cc)}).encode()
    last: Exception | None = None
    for n, wait in enumerate((0, *RETRY)):
        if wait:
            time.sleep(wait)
        url = OVERPASS if n % 2 == 0 else OVERPASS_MIRROR
        try:
            return parse_overpass(_fetch(url, data), cc)
        except Exception as e:  # a timeout remark, HTTP 429/504, a dropped connection
            last = e
            print(f'Overpass {cc}: {e}', file=sys.stderr)
    raise last  # type: ignore[misc]


def _entities(ids) -> dict:
    out: dict = {}
    ids = sorted(set(ids))
    for i in range(0, len(ids), 50):
        out.update(_fetch(ENTITIES + '%7C'.join(ids[i:i + 50])).get('entities', {}))
    return out


def _write(name: str, features: list[dict]):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump(_fc(features), f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    print(f'{name}: {len(features)} features, {os.path.getsize(os.path.join(OUT, name))} bytes')


def build() -> None:
    sites: list[dict] = []
    failed: list[str] = []
    for n, cc in enumerate(sorted(COUNTRIES)):
        if n:
            time.sleep(PAUSE)
        try:
            got = _overpass(cc)
            print(f'{cc}: {len(got)} sites')
            sites += got
        except Exception:
            failed.append(cc)
    if failed:
        check([], failed)
    sites = dedupe(sites)
    items = parse_wikidata(_fetch(WIKIDATA + '?format=json&query=' + urllib.parse.quote(WIKIDATA_QUERY)))
    ents = _entities({i['qid'] for i in items} | {s['tags']['wikidata'] for s in sites if s['tags'].get('wikidata')})
    ents.update(_entities({o for f in site_facts(ents).values() for o in f['ops']} - ents.keys()))
    countries = {v['id'] for e in ents.values() for c in _claims(e, 'P17') if isinstance(v := _value(c), dict)}
    ents.update(_entities(countries - ents.keys()))
    feats = [site_feature(s) for s in merge(sites, items, site_facts(ents), operator_facts(ents))]
    feats.sort(key=lambda f: (f['properties']['cc'], f['properties']['k'], f['properties'].get('n') or ''))
    main = [f for f in feats if f['properties']['k'] != 'minor']
    minor = [f for f in feats if f['properties']['k'] == 'minor']
    check(main, [])
    main = size_guard(main)
    counts: dict[str, dict[str, int]] = {}
    for f in feats:
        p = f['properties']
        counts.setdefault(p['cc'], {}).setdefault(p['k'], 0)
        counts[p['cc']][p['k']] += 1
    print('per country and kind:', json.dumps(counts, sort_keys=True))
    print('foreign-operated:', sum(1 for f in main if f['properties'].get('f')), '· from Wikidata only:',
          sum(1 for f in main if 'osm' not in f['properties']))
    _write('military.geojson', main)
    _write('military-minor.geojson', minor)


def main(argv: list[str]) -> int:
    """0 = both files written · 3 = nothing written (last month's files stay)."""
    try:
        build()
    except Exception as e:
        print(f'military bases not updated: {e}', file=sys.stderr)
        return 3
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
