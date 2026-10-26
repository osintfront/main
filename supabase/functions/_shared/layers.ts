// Map layers kept from outside sources:
//  controlSync — areas of control (Israel in Lebanon and Syria, Yemen, Gaza) from a public
//                Google My Maps war map, as KML; run once a day.
//  sectsSync   — Lebanese villages and towns by religious community, from Wikipedia categories.

// deno-lint-ignore no-explicit-any
type Db = any;

export const CONTROL_MAP_ID = "1-crFsqlB5tG8RdLSvXV8wrZL1O_j2B8";
export const CONTROL_MAP_URL = `https://www.google.com/maps/d/viewer?mid=${CONTROL_MAP_ID}`;

const REGIONS: { id: string; s: number; w: number; n: number; e: number }[] = [
  { id: "gaza", s: 31.2, w: 34.2, n: 31.62, e: 34.6 },
  { id: "lebanon", s: 33.03, w: 35.05, n: 34.72, e: 36.65 },
  { id: "syria", s: 32.3, w: 35.6, n: 37.4, e: 42.4 },
  { id: "yemen", s: 11.5, w: 41.5, n: 19.2, e: 54.6 },
];

// Not areas of control: unit order-of-battle diagrams, numbered sketches, sea borders, history.
const SKIP = /order of battle|structure|units|deactivated|^polygon \d+|eez|former|earlier iteration|evacuation|humanitarian|maritime|return|^line \d+$|combat ineffective|non-geographic|al-awda|zeitoun/i;

const decode = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

function coords(text: string): number[][] {
  return text.trim().split(/\s+/).map((c) => c.split(",").map(Number)).filter((p) => p.length >= 2 && isFinite(p[0]) && isFinite(p[1]))
    .map(([lng, lat]) => [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
}

function polygons(pm: string): number[][][][] {
  const out: number[][][][] = [];
  for (const m of pm.matchAll(/<Polygon>([\s\S]*?)<\/Polygon>/g)) {
    const outer = m[1].match(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
    if (!outer) continue;
    const rings = [coords(outer[1])];
    for (const inner of m[1].matchAll(/<innerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) rings.push(coords(inner[1]));
    if (rings[0].length >= 4) out.push(rings);
  }
  return out;
}

function regionOf(points: number[][]): string | null {
  if (!points.length) return null;
  const lng = points.reduce((a, p) => a + p[0], 0) / points.length;
  const lat = points.reduce((a, p) => a + p[1], 0) / points.length;
  return REGIONS.find((r) => lat >= r.s && lat <= r.n && lng >= r.w && lng <= r.e)?.id ?? null;
}

async function hash(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function controlSync(db: Db) {
  const res = await fetch(`https://www.google.com/maps/d/kml?mid=${CONTROL_MAP_ID}&forcekml=1`);
  if (!res.ok) throw new Error(`map HTTP ${res.status}`);
  const kml = await res.text();
  const rows: Record<string, unknown>[] = [];
  for (const folderXml of kml.split("<Folder>").slice(1)) {
    const folder = decode(folderXml.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? "");
    if (/order of battle|battalions/i.test(folder)) continue;
    for (const pm of folderXml.split("<Placemark>").slice(1)) {
      const name = decode(pm.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? "").replace(/\s+/g, " ");
      if (!name || SKIP.test(name)) continue;
      const style = pm.match(/<styleUrl>#?([^<]*)<\/styleUrl>/)?.[1] ?? "";
      const color = `#${(style.match(/^(?:poly|line)-([0-9A-Fa-f]{6})/)?.[1] ?? "607D8B").toUpperCase()}`;
      let geometry: Record<string, unknown> | null = null;
      let kind: "polygon" | "line" = "polygon";
      let pts: number[][] = [];
      const polys = polygons(pm);
      if (polys.length) {
        geometry = polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
        pts = polys.flatMap((p) => p[0]);
      } else {
        const lines = [...pm.matchAll(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)].map((m) => coords(m[1])).filter((l) => l.length >= 2);
        if (!lines.length) continue;
        kind = "line";
        geometry = lines.length === 1 ? { type: "LineString", coordinates: lines[0] } : { type: "MultiLineString", coordinates: lines };
        pts = lines.flat();
      }
      // The name wins over the box (the Golan / Hermon sit inside Lebanon's box).
      const region = /syria|golan|hermon|quneitra|suwayda|daraa/i.test(name) ? "syria" : regionOf(pts);
      if (!region) continue;
      const geoText = JSON.stringify(geometry);
      rows.push({ id: await hash(`${folder}|${name}|${geoText}`), region, name, kind, color, geometry, folder });
    }
  }
  if (!rows.length) throw new Error("no areas found in the map (format changed?)");
  const now = new Date().toISOString();
  const { data: before } = await db.from("control_areas").select("id");
  const known = new Set((before ?? []).map((r: { id: string }) => r.id));
  const fresh = rows.filter((r) => !known.has(r.id as string));
  // New shapes are added; shapes still in the map are touched; shapes gone from the map are removed.
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50).map((r) => ({ ...r, last_seen: now, ...(known.has(r.id as string) ? {} : { first_seen: now }) }));
    const { error } = await db.from("control_areas").upsert(batch, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
  const ids = new Set(rows.map((r) => r.id as string));
  const gone = [...known].filter((id) => !ids.has(id));
  if (gone.length) await db.from("control_areas").delete().in("id", gone);
  const changed = fresh.length > 0 || gone.length > 0;
  await db.from("layer_sync").upsert({
    layer: "control", synced_at: now, items: rows.length, source: CONTROL_MAP_URL,
    ...(changed ? { changed_at: now } : {}),
    detail: `${fresh.length} new, ${gone.length} removed`,
  }, { onConflict: "layer" });
  const byRegion: Record<string, number> = {};
  for (const r of rows) byRegion[r.region as string] = (byRegion[r.region as string] ?? 0) + 1;
  return { ok: true, areas: rows.length, added: fresh.length, removed: gone.length, byRegion };
}

// ── Lebanon: communities by sect (Wikipedia) ──
const SECT_CATEGORIES: Record<string, string> = {
  shia: "Shia_Muslim_communities_in_Lebanon",
  sunni: "Sunni_Muslim_communities_in_Lebanon",
  druze: "Druze_communities_in_Lebanon",
  maronite: "Maronite_Christian_communities_in_Lebanon",
  orthodox: "Eastern_Orthodox_Christian_communities_in_Lebanon",
  melkite: "Melkite_Christian_communities_in_Lebanon",
  armenian: "Armenian_communities_in_Lebanon",
  alawite: "Alawite_communities_in_Lebanon",
  christian: "Christian_communities_in_Lebanon",
};

/** Wikipedia API, politely: one request at a time, waits and retries when asked to slow down. */
async function wiki(params: URLSearchParams): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((r) => setTimeout(r, attempt ? 3000 * attempt : 400));
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}&maxlag=5`, {
      headers: { "user-agent": "OsintfrontMapBot/1.0 (https://osintfront.com)", "api-user-agent": "OsintfrontMapBot/1.0 (https://osintfront.com)" },
    });
    if (res.status === 429 || res.status === 503) {
      const wait = Number(res.headers.get("retry-after"));
      if (Number.isFinite(wait) && wait > 0) await new Promise((r) => setTimeout(r, Math.min(20, wait) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`wikipedia HTTP ${res.status}`);
    const out = await res.json();
    if (out?.error?.code === "maxlag") continue;
    return out;
  }
  throw new Error("wikipedia: too many requests, try later");
}

export async function sectsSync(db: Db) {
  const places = new Map<string, { title: string; name_en: string; name_he: string | null; name_ar: string | null; lat: number; lng: number; sects: Set<string> }>();
  let noCoords = 0;
  for (const [sect, cat] of Object.entries(SECT_CATEGORIES)) {
    let cont: Record<string, string> = {};
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({
        action: "query", format: "json", generator: "categorymembers", gcmtitle: `Category:${cat}`, gcmnamespace: "0", gcmlimit: "200",
        prop: "coordinates|langlinks", colimit: "max", lllimit: "max", ...cont,
      });
      const out = await wiki(params);
      for (const p of Object.values(out?.query?.pages ?? {}) as any[]) {
        const title = String(p?.title ?? "");
        const c = p?.coordinates?.[0];
        const prev = places.get(title);
        const he = (p?.langlinks ?? []).find((l: any) => l?.lang === "he")?.["*"] ?? null;
        const ar = (p?.langlinks ?? []).find((l: any) => l?.lang === "ar")?.["*"] ?? null;
        if (prev) {
          prev.sects.add(sect);
          if (!prev.name_he && he) prev.name_he = he;
          if (!prev.name_ar && ar) prev.name_ar = ar;
          if (c && !prev.lat) { prev.lat = c.lat; prev.lng = c.lon; }
          continue;
        }
        places.set(title, { title, name_en: title.replace(/,\s*Lebanon$/, "").replace(/\s*\(.*\)$/, ""), name_he: he, name_ar: ar, lat: c?.lat ?? 0, lng: c?.lon ?? 0, sects: new Set([sect]) });
      }
      if (!out?.continue) break;
      // Keep the paging keys only (continue tokens for the generator and the props).
      cont = Object.fromEntries(Object.entries(out.continue).map(([k, v]) => [k, String(v)]));
    }
  }
  const rows = [...places.values()].filter((p) => {
    const ok = p.lat && p.lng && p.lat > 33 && p.lat < 34.75 && p.lng > 35 && p.lng < 36.7;
    if (!ok) noCoords++;
    return ok;
  }).map((p) => ({
    title: p.title, name_en: p.name_en, name_he: p.name_he, name_ar: p.name_ar, lat: p.lat, lng: p.lng,
    // "Christian" alone only when no specific church is known.
    sects: [...p.sects].filter((s, _, all) => s !== "christian" || !all.some((x) => ["maronite", "orthodox", "melkite", "armenian"].includes(x))),
    updated_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("lebanon_sects").upsert(rows.slice(i, i + 200), { onConflict: "title" });
    if (error) throw new Error(error.message);
  }
  await db.from("layer_sync").upsert({ layer: "sects", synced_at: new Date().toISOString(), changed_at: new Date().toISOString(), items: rows.length, source: "https://en.wikipedia.org/wiki/Category:Religion_in_Lebanon", detail: `${noCoords} without coordinates skipped` }, { onConflict: "layer" });
  return { ok: true, places: rows.length, skipped_no_coords: noCoords };
}
