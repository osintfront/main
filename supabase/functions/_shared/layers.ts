import { logUsage } from "./usage.ts";
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
async function wiki(params: URLSearchParams, host = "en.wikipedia.org"): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((r) => setTimeout(r, attempt ? 3000 * attempt : 400));
    const res = await fetch(`https://${host}/w/api.php?${params}&maxlag=5`, {
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

// ── South Lebanon: every village the encyclopedias list, taught to the place database ──
const SOUTH_DISTRICTS: { en: string; ar: string }[] = [
  { en: "Tyre_District", ar: "صور" }, { en: "Bint_Jbeil_District", ar: "بنت جبيل" }, { en: "Marjayoun_District", ar: "مرجعيون" },
  { en: "Nabatieh_District", ar: "النبطية" }, { en: "Hasbaya_District", ar: "حاصبيا" }, { en: "Sidon_District", ar: "صيدا" },
  { en: "Jezzine_District", ar: "جزين" },
];

type Village = { name_ar: string | null; name_en: string | null; name_he: string | null; lat: number; lng: number; source: string };

async function categoryPlaces(host: string, category: string, other: string): Promise<Village[]> {
  const out = new Map<string, Village>();
  let cont: Record<string, string> = {};
  for (let page = 0; page < 15; page++) {
    const params = new URLSearchParams({
      action: "query", format: "json", generator: "categorymembers", gcmtitle: `Category:${category}`, gcmnamespace: "0", gcmlimit: "200",
      prop: "coordinates|langlinks", colimit: "max", lllimit: "max", ...cont,
    });
    const res = await wiki(params, host);
    for (const p of Object.values(res?.query?.pages ?? {}) as any[]) {
      const title = String(p?.title ?? "");
      const c = p?.coordinates?.[0];
      const links = p?.langlinks ?? [];
      const ll = (lang: string) => links.find((l: any) => l?.lang === lang)?.["*"] ?? null;
      const prev = out.get(title);
      const v: Village = prev ?? {
        name_ar: host.startsWith("ar") ? title : ll("ar"),
        name_en: host.startsWith("en") ? title : ll(other === "en" ? "en" : "en"),
        name_he: ll("he"),
        lat: c?.lat ?? 0, lng: c?.lon ?? 0, source: `${host}/${category}`,
      };
      if (prev) {
        if (!v.lat && c) { v.lat = c.lat; v.lng = c.lon; }
        v.name_he ??= ll("he");
        if (host.startsWith("ar")) v.name_en ??= ll("en"); else v.name_ar ??= ll("ar");
      }
      out.set(title, v);
    }
    if (!res?.continue) break;
    cont = Object.fromEntries(Object.entries(res.continue).map(([k, v]) => [k, String(v)]));
  }
  return [...out.values()];
}

export async function learnSouthLebanon(db: Db) {
  const all: Village[] = [];
  for (const d of SOUTH_DISTRICTS) {
    all.push(...await categoryPlaces("en.wikipedia.org", `Populated_places_in_${d.en}`, "ar"));
    all.push(...await categoryPlaces("ar.wikipedia.org", `أماكن_مأهولة_في_قضاء_${d.ar.replace(/ /g, "_")}`, "en"));
  }
  // Southern Lebanon only (south of the Awali river), with coordinates.
  const south = all.filter((v) => v.lat > 33.04 && v.lat < 33.62 && v.lng > 35.1 && v.lng < 35.95);
  // Queued: teaching the database is slow (each place updates a large table), so the database
  // works through the queue itself (cron), outside this request's time limit.
  const rows = south.map((v) => ({ key: `${v.source}|${v.name_ar ?? v.name_en}`.slice(0, 400), row: v, country: "LB", done_at: null }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("place_learn_queue").upsert(rows.slice(i, i + 200), { onConflict: "key" });
    if (error) throw new Error(error.message);
  }
  const matched = 0, added = 0;
  await db.from("layer_sync").upsert({ layer: "south_lebanon_places", synced_at: new Date().toISOString(), changed_at: new Date().toISOString(), items: south.length, source: "Wikipedia (en + ar): populated places by district", detail: `${south.length} queued, ${all.length - south.length} outside / no coordinates` }, { onConflict: "layer" });
  return { ok: true, found: all.length, south: south.length, queued: rows.length, matched, added, with_hebrew: south.filter((v) => v.name_he).length };
}

/**
 * Hebrew names for villages of south Lebanon that have none yet (Claude Haiku transliterates
 * from the Arabic name; marked he_from_ai). One batch per call.
 */
export async function hebrewNamesSouthLebanon(db: Db, limit = 120) {
  const key = (Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("Whatsapp_Key") || "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const { data: rows, error } = await db.rpc("south_lebanon_missing_hebrew", { p_limit: limit });
  if (error) throw new Error(error.message);
  const list = (rows ?? []) as { geonameid: number; name_ar: string | null; name: string }[];
  if (!list.length) return { ok: true, done: 0, left: 0 };
  const model = "claude-haiku-5-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 6000,
      system: "You write the usual Hebrew spelling (as in Israeli media) of village names in south Lebanon. " +
        "Transliterate from the Arabic name; keep the Arabic article as א-/אל- the way Israeli media do (e.g. מרון א-ראס, עייתא א-שעב, כפר כלא, בינת ג'בייל). " +
        "Answer ONLY with JSON: {\"<id>\": \"<Hebrew name>\", ...}. No other text.",
      messages: [{ role: "user", content: JSON.stringify(Object.fromEntries(list.map((r) => [r.geonameid, `${r.name_ar ?? ""} | ${r.name}`]))) }],
    }),
  });
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
  const out = await res.json();
  logUsage("place-names", model, out?.usage ? { input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens } as any : undefined);
  const text = (out?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const names = Object.entries(json).map(([id, he]) => ({ geonameid: Number(id), name_he: String(he).trim().slice(0, 80) }))
    .filter((r) => Number.isFinite(r.geonameid) && /[\u05D0-\u05EA]/.test(r.name_he) && !/[\u0600-\u06FF]/.test(r.name_he));
  const { data: done, error: e2 } = await db.rpc("set_hebrew_place_names", { p_rows: names });
  if (e2) throw new Error(e2.message);
  return { ok: true, done: Number(done ?? 0), asked: list.length };
}

/**
 * Hebrew names for Lebanon (Claude Haiku transliterates from the Arabic name; marked he_from_ai).
 *  kind "village" — every populated place of Lebanon; "wadi" — wadis / streams / valleys of the
 *  place database; "line" — the wadi courses from OpenStreetMap (wadi_lines). One batch per call;
 *  part/parts split the work so several batches can run at once.
 */
export async function hebrewNamesLebanon(db: Db, kind: "village" | "wadi" | "line", limit = 120, part = 0, parts = 1) {
  const key = (Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("Whatsapp_Key") || "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const { data: rows, error } = kind === "line"
    ? await db.rpc("wadi_lines_missing_hebrew", { p_limit: limit })
    : await db.rpc("lebanon_missing_hebrew", { p_kind: kind, p_limit: limit, p_part: part, p_parts: parts });
  if (error) throw new Error(error.message);
  const list = ((rows ?? []) as { geonameid?: number; id?: number; name_ar: string | null; name: string }[])
    .map((r) => ({ id: Number(r.geonameid ?? r.id), name_ar: r.name_ar, name: r.name }));
  if (!list.length) return { ok: true, done: 0, asked: 0 };
  const what = kind === "village"
    ? "village and town names in Lebanon. Keep the Arabic article as א-/אל- the way Israeli media do (e.g. מרון א-ראס, עייתא א-שעב, כפר כלא, בינת ג'בייל, בעלבכ, זחלה)."
    : "names of wadis, streams and valleys in Lebanon. وادي / Wadi → ואדי, نهر / Nahr → נהר, سهل → סהל (e.g. ואדי סלוקי, ואדי אל-חוג'יר, נהר אל-ליטני, ואדי א-שייח'). Keep the Arabic article as א-/אל- as Israeli media do.";
  const model = "claude-haiku-5-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 8000,
      system: `You write the usual Hebrew spelling (as in Israeli media) of ${what} Transliterate from the Arabic name when given, else from the Latin one. ` +
        "Answer ONLY with JSON: {\"<id>\": \"<Hebrew name>\", ...}. No other text.",
      messages: [{ role: "user", content: JSON.stringify(Object.fromEntries(list.map((r) => [r.id, `${r.name_ar ?? ""} | ${r.name}`]))) }],
    }),
  });
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
  const out = await res.json();
  logUsage("place-names", model, out?.usage ? { input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens } as any : undefined);
  const text = (out?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  // No vowel points (niqqud) in names.
  const names = Object.entries(json).map(([id, he]) => ({ geonameid: Number(id), name_he: String(he).replace(/[\u0591-\u05C7]/g, "").trim().slice(0, 80) }))
    .filter((r) => Number.isFinite(r.geonameid) && /[\u05D0-\u05EA]/.test(r.name_he) && !/[\u0600-\u06FF]/.test(r.name_he));
  const { data: done, error: e2 } = await db.rpc(kind === "line" ? "set_hebrew_wadi_names" : "set_hebrew_place_names", { p_rows: names });
  if (e2) throw new Error(e2.message);
  return { ok: true, done: Number(done ?? 0), asked: list.length };
}

/**
 * Named waterways and valleys of Lebanon from OpenStreetMap (Overpass), as lines → osm_waterways,
 * in four latitude bands (one request each, to stay inside the time limit), then "build" joins
 * them into one course per wadi (wadi_lines). Run once; again to add new ones.
 */
const LEBANON_BANDS: Record<string, string> = {
  // south, south-centre, centre, north (lat bands; Lebanon's box 33.05–34.70 N, 35.10–36.63 E)
  s1: "33.05,35.10,33.40,36.10", s2: "33.40,35.10,33.75,36.30", s3: "33.75,35.10,34.15,36.63", s4: "34.15,35.10,34.70,36.63",
};
/** Fetch one band (s1…s4) from Overpass into osm_waterways; "build" joins them into wadi_lines. */
export async function osmWadis(db: Db, band = "s1") {
  if (band === "build") {
    const { data: courses, error } = await db.rpc("build_wadi_lines");
    if (error) throw new Error(error.message);
    const { count } = await db.from("wadi_lines").select("id", { count: "exact", head: true });
    await db.from("layer_sync").upsert({ layer: "wadis", synced_at: new Date().toISOString(), changed_at: new Date().toISOString(), items: count ?? 0, source: "OpenStreetMap (waterways and valleys with a name)", detail: `${courses} new courses` }, { onConflict: "layer" });
    return { ok: true, new_courses: Number(courses ?? 0), courses: count };
  }
  const box = LEBANON_BANDS[band];
  if (!box) throw new Error("band must be s1..s4 or build");
  // Lebanon = OSM relation 184843 (area 3600184843).
  const q = `[out:json][timeout:90];area(id:3600184843)->.lb;` +
    `(way["waterway"~"^(river|stream|wadi|canal|ditch|drain)$"]["name"](${box})(area.lb);way["natural"="valley"]["name"](${box})(area.lb););out tags geom;`;
  let data: any = null;
  let lastErr = "";
  const t0 = Date.now();
  for (const host of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]) {
    if (Date.now() - t0 > 110_000) break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55_000);
    try {
      const res = await fetch(`${host}?data=${encodeURIComponent(q)}`, {
        headers: { "User-Agent": "Osintfront/1.0 (https://osintfront.com; map of the conflict)", Accept: "application/json, */*;q=0.8", Referer: "https://osintfront.com/" },
        signal: ctrl.signal,
      });
      if (!res.ok) { lastErr += ` ${host} HTTP ${res.status};`; continue; }
      data = await res.json();
      break;
    } catch (e) { lastErr += ` ${host} ${String((e as Error)?.message ?? e).slice(0, 80)};`; } finally { clearTimeout(timer); }
  }
  if (!data) throw new Error(`Overpass: ${lastErr}`);
  const rows = (data.elements ?? []).filter((e: any) => e.type === "way" && Array.isArray(e.geometry) && e.geometry.length > 1).map((e: any) => ({
    way_id: e.id,
    kind: e.tags?.waterway ?? (e.tags?.natural === "valley" ? "valley" : "waterway"),
    name: String(e.tags?.name ?? "").slice(0, 200),
    name_ar: e.tags?.["name:ar"] ?? (/[\u0600-\u06FF]/.test(e.tags?.name ?? "") ? e.tags.name : null),
    name_en: e.tags?.["name:en"] ?? null,
    name_he: e.tags?.["name:he"] ?? null,
    geometry: { type: "LineString", coordinates: e.geometry.map((p: any) => [Math.round(p.lon * 1e6) / 1e6, Math.round(p.lat * 1e6) / 1e6]) },
  }));
  let saved = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const { data: n, error } = await db.rpc("upsert_osm_waterways", { p_rows: rows.slice(i, i + 400) });
    if (error) throw new Error(error.message);
    saved += Number(n ?? 0);
  }
  return { ok: true, band, ways: rows.length, saved, elements: (data.elements ?? []).length, remark: data.remark ?? null };
}
