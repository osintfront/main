#!/usr/bin/env python3
"""
Build Osintfront's local place database from GeoNames (one-time, no API, no AI).

  python3 tools/geonames/build_places.py            # download + build
  python3 tools/geonames/build_places.py --offline  # build from files already in --work

Countries: IL SY LB IQ YE SA IR PS (Gaza + West Bank). Languages kept: he, ar, en.

Steps
  1. Download the country dumps   https://download.geonames.org/export/dump/XX.zip
     and their alternate names    https://download.geonames.org/export/dump/alternatenames/XX.zip
     (--global-alternates: the global alternateNamesV2.zip instead — same rows, ~200x bigger).
  2. Extract (streamed straight out of the zip; nothing is loaded whole into memory).
  3a. Read the country files → keep useful feature classes → set of GeoName IDs.
  3b. Stream the alternate names, keep only rows for those IDs in he/ar/en
      (no historic or colloquial names; preferred/short names ranked first).
  3c. Merge coordinates, country, feature, population and the names.
  4. Write data/geonames/places-XX-NN.tsv chunks (< 4 MB each, committed to git) and a
     manifest. The database loads them itself from GitHub: select public.load_geo_places();

Only the Python standard library is used. Memory: the ID set + the kept names
(a few hundred thousand rows), never the 700 MB alternate-names file.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

COUNTRIES = ["IL", "SY", "LB", "IQ", "YE", "SA", "IR", "PS"]
LANGS = ("he", "ar", "en")
BASE = "https://download.geonames.org/export/dump"

# Feature classes/codes worth placing news on (http://www.geonames.org/export/codes.html).
KEEP_CLASSES = {"P", "A", "T", "L"}  # populated places, admin areas, mountains/hills/valleys, areas/regions
KEEP_CODES = {
    # S — spots/buildings that appear in security news
    "AIRB", "AIRF", "AIRH", "AIRP", "AIRQ", "MILB", "INSM", "NVB", "PRT", "PS", "PSH", "PSN", "PO",
    "DAM", "BDG", "CRSSNG", "HSP", "HSPC", "CMP", "CMPRF", "CMPQ", "TOWR", "RSTN", "OILR", "OILT",
    "PRN", "CSTL", "FRT", "MSQE", "SHRN", "UNIV", "STDM", "BRKS", "ITTR", "RESV",
    # H — water features that name front lines
    "WAD", "STM", "LK", "RSV", "BAY", "GULF", "STRT", "SEA", "CHN",
    # V — none; U — none
}

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "data" / "geonames"
CHUNK_BYTES = 4 * 1024 * 1024

COLUMNS = [
    "geonameid", "name", "name_he", "name_ar", "name_en", "names", "country_code",
    "feature_class", "feature_code", "admin1", "population", "lat", "lng",
]


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        log(f"  have {dest.name}")
        return
    log(f"  get  {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "Osintfront geonames builder"})
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
        while True:
            block = r.read(1 << 20)
            if not block:
                break
            f.write(block)
    tmp.rename(dest)


def zip_lines(path: Path, member: str):
    """Yield text lines of one member of a zip, streamed."""
    with zipfile.ZipFile(path) as z:
        name = member if member in z.namelist() else next(n for n in z.namelist() if n.endswith(".txt") and "readme" not in n.lower())
        with z.open(name) as raw:
            for line in io.TextIOWrapper(raw, encoding="utf-8", newline="\n"):
                yield line.rstrip("\n")


def normalize(s: str) -> str:
    """Exactly public.normalize_place() in the database: lower-case, no Hebrew points, punctuation → space."""
    s = (s or "").lower()
    s = re.sub("[\u0591-\u05C7]", "", s)  # Hebrew points / cantillation
    s = re.sub("[^a-z0-9\u05D0-\u05EA\u0600-\u06FF]+", " ", s)
    return s.strip()


def keep_feature(fclass: str, fcode: str) -> bool:
    return fclass in KEEP_CLASSES or fcode in KEEP_CODES


def read_countries(work: Path):
    """Step 3a: places of the 7 countries. Returns {id: row} (row = dict)."""
    places: dict[int, dict] = {}
    for cc in COUNTRIES:
        n = 0
        for line in zip_lines(work / f"{cc}.zip", f"{cc}.txt"):
            f = line.split("\t")
            if len(f) < 19:
                continue
            if not keep_feature(f[6], f[7]):
                continue
            gid = int(f[0])
            places[gid] = {
                "geonameid": gid, "name": f[1], "ascii": f[2], "country_code": f[8],
                "feature_class": f[6], "feature_code": f[7], "admin1": f[10],
                "population": int(f[14] or 0), "lat": f[4], "lng": f[5],
            }
            n += 1
        log(f"  {cc}: {n} places kept")
    return places


def alt_sources(work: Path, global_alternates: bool):
    if global_alternates:
        yield from zip_lines(work / "alternateNamesV2.zip", "alternateNamesV2.txt")
    else:
        for cc in COUNTRIES:
            yield from zip_lines(work / "alternatenames" / f"{cc}.zip", f"{cc}.txt")


def read_names(work: Path, ids: set[int], global_alternates: bool):
    """Step 3b: he/ar/en names of those IDs. Returns {id: {lang: [(rank, name), ...]}}."""
    names: dict[int, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    kept = 0
    for line in alt_sources(work, global_alternates):
        f = line.split("\t")
        if len(f) < 4 or f[2] not in LANGS:
            continue
        try:
            gid = int(f[1])
        except ValueError:
            continue
        if gid not in ids:
            continue
        preferred = len(f) > 4 and f[4] == "1"
        short = len(f) > 5 and f[5] == "1"
        colloquial = len(f) > 6 and f[6] == "1"
        historic = len(f) > 7 and f[7] == "1"
        if colloquial or historic or not f[3].strip():
            continue
        rank = 0 if preferred else 1 if short else 2
        names[gid][f[2]].append((rank, f[3].strip()))
        kept += 1
    log(f"  alternate names kept: {kept}")
    return names


def best(cands: list) -> str:
    return sorted(cands, key=lambda x: (x[0], len(x[1])))[0][1] if cands else ""


def write_chunks(places: dict, names: dict) -> list[dict]:
    """Steps 3c + 4: merged rows → TSV chunks per country."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("places-*.tsv"):
        old.unlink()
    files = []
    by_cc = defaultdict(list)
    for p in places.values():
        by_cc[p["country_code"]].append(p)
    for cc in sorted(by_cc):
        rows = sorted(by_cc[cc], key=lambda p: (-p["population"], p["geonameid"]))
        part, size, fh = 0, 0, None

        def open_part():
            nonlocal part, size, fh
            if fh:
                fh.close()
            part += 1
            path = OUT_DIR / f"places-{cc}-{part:02d}.tsv"
            fh = open(path, "w", encoding="utf-8", newline="")
            size = 0
            files.append({"file": path.name, "country": cc, "rows": 0})

        open_part()
        for p in rows:
            n = names.get(p["geonameid"], {})
            he, ar, en = best(n.get("he", [])), best(n.get("ar", [])), best(n.get("en", []))
            variants = {normalize(x) for x in [p["name"], p["ascii"], *(v for lang in LANGS for _, v in n.get(lang, []))]}
            variants.discard("")
            clean = lambda s: re.sub("[\u0591-\u05C7]", "", s).replace("\t", " ").replace("\n", " ").replace("|", "/").strip()
            row = [p["geonameid"], clean(p["name"]), clean(he), clean(ar), clean(en or p["name"]),
                   "|".join(sorted(variants)), p["country_code"], p["feature_class"], p["feature_code"],
                   p["admin1"], p["population"], p["lat"], p["lng"]]
            # Plain TSV, no quoting: tabs/newlines were removed from every value above.
            line = "\t".join(str(x) for x in row) + "\n"
            if size + len(line.encode()) > CHUNK_BYTES:
                open_part()
            fh.write(line)
            size += len(line.encode())
            files[-1]["rows"] += 1
        fh.close()
    manifest = {"source": "GeoNames (CC BY 4.0) https://www.geonames.org", "countries": COUNTRIES,
                "languages": list(LANGS), "columns": COLUMNS, "files": files,
                "total_rows": sum(f["rows"] for f in files)}
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    return files


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", default=str(ROOT / ".geonames-work"), help="download/extract folder (not committed)")
    ap.add_argument("--offline", action="store_true", help="use files already in --work")
    ap.add_argument("--global-alternates", action="store_true", help="use the global alternateNamesV2.zip")
    a = ap.parse_args()
    work = Path(a.work)
    (work / "alternatenames").mkdir(parents=True, exist_ok=True)

    if not a.offline:
        log("1. download")
        for cc in COUNTRIES:
            download(f"{BASE}/{cc}.zip", work / f"{cc}.zip")
            if not a.global_alternates:
                download(f"{BASE}/alternatenames/{cc}.zip", work / "alternatenames" / f"{cc}.zip")
        if a.global_alternates:
            download(f"{BASE}/alternateNamesV2.zip", work / "alternateNamesV2.zip")

    log("2-3a. read country files")
    places = read_countries(work)
    log(f"  total places: {len(places)}")
    log("3b. filter alternate names (streamed)")
    names = read_names(work, set(places), a.global_alternates)
    log("3c-4. merge + write chunks")
    files = write_chunks(places, names)
    total = sum(f["rows"] for f in files)
    size = sum((OUT_DIR / f["file"]).stat().st_size for f in files)
    with_he = sum(1 for gid in places if names.get(gid, {}).get("he"))
    log(f"done: {total} places in {len(files)} files, {size / 1e6:.1f} MB; Hebrew name for {with_he} ({with_he * 100 // max(total, 1)}%)")
    log(f"next: git add data/geonames && git commit && git push, then in Supabase: select public.load_geo_places();")
    return 0


if __name__ == "__main__":
    sys.exit(main())
