"""Sanctioned vessels (by IMO number) for the map's ship layer.

Sources: US OFAC SDN list and the UK Sanctions List. Writes public/data/sanctioned-vessels.json =
{ "updated": ISO date, "vessels": { "<IMO>": { "n": name, "l": ["OFAC", "UK"] } } }.
Run weekly by .github/workflows/sanctions-data.yml. A source that yields no vessels fails the build
(its first row is printed) and the previous file stays.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

OFAC = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV'
UK = 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv'
UA = 'osintfront.com data build (+https://osintfront.com)'
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'data', 'sanctioned-vessels.json')
IMO_IN_TEXT = re.compile(r'IMO\D{0,20}?(\d{7})(?!\d)', re.I)
NAME_KEYS = ('name 6', 'name', 'primary name', 'full name', 'name of ship', 'vessel name')


def imo_valid(imo: str) -> bool:
    s = str(imo).strip()
    if not re.fullmatch(r'\d{7}', s):
        return False
    return sum(int(d) * w for d, w in zip(s[:6], range(7, 1, -1))) % 10 == int(s[6])


def imos_in(text: str) -> list[str]:
    out: list[str] = []
    for m in IMO_IN_TEXT.finditer(text or ''):
        if imo_valid(m.group(1)) and m.group(1) not in out:
            out.append(m.group(1))
    return out


def _name(row: list[str] | dict) -> str:
    if isinstance(row, list):
        return row[1].strip() if len(row) > 1 else ''
    lower = {k.strip().lower(): (v or '').strip() for k, v in row.items() if k}
    for k in NAME_KEYS:
        if lower.get(k):
            return lower[k]
    return next((v for k, v in lower.items() if 'name' in k and v), '')


def vessels_from_rows(rows: list, source: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for row in rows:
        if isinstance(row, dict):
            found = [str(v).strip() for k, v in row.items() if k and 'imo' in k.lower() and imo_valid(str(v or '').strip())]
            found += imos_in(' '.join(str(v or '') for v in row.values()))
        else:
            found = imos_in(' '.join(row))
        name = _name(row)
        for imo in dict.fromkeys(found):
            out.setdefault(imo, {'n': name, 'l': [source]})
    return out


def merge(*parts: dict) -> dict:
    out: dict[str, dict] = {}
    for part in parts:
        for imo, v in part.items():
            cur = out.setdefault(imo, {'n': v['n'], 'l': []})
            cur['n'] = cur['n'] or v['n']
            cur['l'] = sorted(set(cur['l']) | set(v['l']))
    return out


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={'user-agent': UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode('utf-8-sig', errors='replace')


def _rows_uk(text: str) -> list[dict]:
    lines = text.splitlines()
    # Some UK exports start with a title line before the header: start at the first line with several columns.
    start = next((i for i, l in enumerate(lines[:5]) if l.count(',') >= 3), 0)
    return list(csv.DictReader(io.StringIO('\n'.join(lines[start:]))))


def main() -> int:
    parts = {}
    ofac_rows = list(csv.reader(io.StringIO(_get(OFAC))))
    parts['OFAC'] = vessels_from_rows(ofac_rows, 'OFAC')
    uk_rows = _rows_uk(_get(UK))
    parts['UK'] = vessels_from_rows(uk_rows, 'UK')
    for src, rows in (('OFAC', ofac_rows), ('UK', uk_rows)):
        print(f'{src}: {len(parts[src])} vessels from {len(rows)} rows')
        if not parts[src]:
            print(f'{src}: no vessels found — format changed? first row: {rows[0] if rows else None}', file=sys.stderr)
            return 1
    data = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%d'), 'vessels': merge(parts['OFAC'], parts['UK'])}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    print(f'written: {len(data["vessels"])} vessels')
    return 0


if __name__ == '__main__':
    sys.exit(main())
