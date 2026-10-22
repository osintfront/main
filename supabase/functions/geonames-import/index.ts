// geonames-import: builds the local place database (public.geo_places) from GeoNames,
// on the server, one country per call. Same rules as tools/geonames/build_places.py:
//   1. download https://download.geonames.org/export/dump/XX.zip + alternatenames/XX.zip
//   2. unzip in memory (country files are a few MB; the global 700 MB file is never used)
//   3a. keep useful feature classes/codes → set of GeoName IDs
//   3b. keep only he/ar/en alternate names of those IDs (no historic/colloquial)
//   3c. merge → TSV rows → public.load_geo_places_tsv() in chunks
// No AI and no paid API. Auth: header x-cron-secret (public.intel_config.cron_secret).
// Body: { "country": "IL" }   (IL SY LB IQ YE SA IR); big countries: { "country": "IR", "part": 0, "parts": 4 }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const BASE = "https://download.geonames.org/export/dump";
const COUNTRIES = new Set(["IL", "SY", "LB", "IQ", "YE", "SA", "IR"]);
const LANGS = new Set(["he", "ar", "en"]);
const KEEP_CLASSES = new Set(["P", "A", "T", "L"]);
const KEEP_CODES = new Set([
  "AIRB", "AIRF", "AIRH", "AIRP", "AIRQ", "MILB", "INSM", "NVB", "PRT", "PS", "PSH", "PSN", "PO",
  "DAM", "BDG", "CRSSNG", "HSP", "HSPC", "CMP", "CMPRF", "CMPQ", "TOWR", "RSTN", "OILR", "OILT",
  "PRN", "CSTL", "FRT", "MSQE", "SHRN", "UNIV", "STDM", "BRKS", "ITTR", "RESV",
  "WAD", "STM", "LK", "RSV", "BAY", "GULF", "STRT", "SEA", "CHN",
]);
const CHUNK_ROWS = 800; // small enough for the API statement timeout

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

/** Exactly public.normalize_place(). */
function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/[֑-ׇ]/g, "").replace(/[^a-z0-9א-ת؀-ۿ]+/g, " ").trim();
}
const clean = (s: string) => (s || "").replace(/[֑-ׇ]/g, "").replace(/[\t\n|]/g, " ").trim();

async function zipText(url: string, member: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "Osintfront geonames importer" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()), { filter: (f) => f.name === member });
  const data = files[member];
  if (!data) throw new Error(`${member} not in ${url}`);
  return strFromU8(data);
}

function* lines(text: string) {
  let i = 0;
  while (i < text.length) {
    let j = text.indexOf("\n", i);
    if (j < 0) j = text.length;
    yield text.slice(i, j);
    i = j + 1;
  }
}

async function importCountry(cc: string, part = 0, parts = 1) {
  // 3a
  type P = { name: string; ascii: string; fc: string; fcode: string; admin1: string; pop: number; lat: string; lng: string };
  const places = new Map<number, P>();
  for (const line of lines(await zipText(`${BASE}/${cc}.zip`, `${cc}.txt`))) {
    const f = line.split("\t");
    if (f.length < 19 || f[8] !== cc) continue;
    if (!KEEP_CLASSES.has(f[6]) && !KEEP_CODES.has(f[7])) continue;
    if (Number(f[0]) % parts !== part) continue; // big countries (IR) are split into parts
    places.set(Number(f[0]), { name: f[1], ascii: f[2], fc: f[6], fcode: f[7], admin1: f[10], pop: Number(f[14] || 0), lat: f[4], lng: f[5] });
  }
  // 3b
  const names = new Map<number, Record<string, [number, string][]>>();
  let kept = 0;
  for (const line of lines(await zipText(`${BASE}/alternatenames/${cc}.zip`, `${cc}.txt`))) {
    const f = line.split("\t");
    if (f.length < 4 || !LANGS.has(f[2])) continue;
    const gid = Number(f[1]);
    if (!places.has(gid)) continue;
    if (f[6] === "1" || f[7] === "1" || !f[3]?.trim()) continue; // colloquial / historic / empty
    const rank = f[4] === "1" ? 0 : f[5] === "1" ? 1 : 2;
    const byLang = names.get(gid) ?? {};
    (byLang[f[2]] ??= []).push([rank, f[3].trim()]);
    names.set(gid, byLang);
    kept++;
  }
  const best = (c?: [number, string][]) => (c?.length ? [...c].sort((a, b) => a[0] - b[0] || a[1].length - b[1].length)[0][1] : "");
  // 3c + load
  let rows: string[] = [];
  let loaded = 0;
  const flush = async () => {
    if (!rows.length) return;
    const { data, error } = await db.rpc("load_geo_places_tsv", { p_content: rows.join("\n") });
    if (error) throw new Error(error.message);
    loaded += Number(data ?? 0);
    rows = [];
  };
  for (const [gid, p] of places) {
    const n = names.get(gid) ?? {};
    const variants = new Set([p.name, p.ascii, ...Object.values(n).flat().map((x) => x[1])].map(normalize));
    variants.delete("");
    rows.push([
      gid, clean(p.name), clean(best(n.he)), clean(best(n.ar)), clean(best(n.en) || p.name),
      [...variants].map((v) => v.replace(/\|/g, " ")).join("|"), cc, p.fc, p.fcode, p.admin1, p.pop, p.lat, p.lng,
    ].join("\t"));
    if (rows.length >= CHUNK_ROWS) await flush();
  }
  await flush();
  return { country: cc, part, parts, places: places.size, alternate_names: kept, loaded };
}

let secret: string | null = null;
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (secret === null) {
    const { data } = await db.from("intel_config").select("value").eq("key", "cron_secret").maybeSingle();
    secret = data?.value ?? "";
  }
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const cc = String(body?.country ?? "").toUpperCase();
  if (!COUNTRIES.has(cc)) return json({ error: "country must be one of IL SY LB IQ YE SA IR" }, 400);
  try {
    const parts = Math.min(Math.max(Number(body?.parts ?? 1) | 0, 1), 16);
    const part = Math.min(Math.max(Number(body?.part ?? 0) | 0, 0), parts - 1);
    return json({ ok: true, ...(await importCountry(cc, part, parts)) });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
