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

/** Streams one member of a remote zip, line by line. The zip (a few MB) is read from
 *  its central directory; the member is inflated by the runtime's native
 *  DecompressionStream and decoded as a stream, so the unzipped text never sits whole
 *  in memory and the small per-call CPU budget is spent on our filtering, not on
 *  inflating in JavaScript. */
async function zipLines(url: string, member: string, onLine: (line: string) => void): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": "Osintfront geonames importer" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const zip = new Uint8Array(await res.arrayBuffer());
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // End of central directory record.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`not a zip: ${url}`);
  const entries = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const enc = new TextDecoder();
  let local = -1, size = 0, method = 0;
  for (let n = 0; n < entries; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error(`bad central directory: ${url}`);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    if (enc.decode(zip.subarray(p + 46, p + 46 + nameLen)) === member) {
      method = dv.getUint16(p + 10, true);
      size = dv.getUint32(p + 20, true);
      local = dv.getUint32(p + 42, true);
      break;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (local < 0) throw new Error(`${member} not in ${url}`);
  const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
  let stream: ReadableStream<Uint8Array> = new Blob([zip.subarray(start, start + size)]).stream();
  if (method === 8) stream = stream.pipeThrough(new DecompressionStream("deflate-raw"));
  else if (method !== 0) throw new Error(`zip method ${method} not supported`);
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += value;
    let i = 0;
    for (let j = rest.indexOf("\n"); j >= 0; j = rest.indexOf("\n", i)) {
      onLine(rest.slice(i, j));
      i = j + 1;
    }
    rest = rest.slice(i);
  }
  if (rest) onLine(rest);
}

async function importCountry(cc: string, part = 0, parts = 1) {
  // 3a
  type P = { name: string; ascii: string; fc: string; fcode: string; admin1: string; pop: number; lat: string; lng: string };
  const places = new Map<number, P>();
  await zipLines(`${BASE}/${cc}.zip`, `${cc}.txt`, (line) => {
    // Cheap checks before split() — the CPU budget per call is small.
    if (parts > 1 && Number(line.slice(0, line.indexOf("\t"))) % parts !== part) return;
    const f = line.split("\t");
    if (f.length < 19 || f[8] !== cc) return;
    if (!KEEP_CLASSES.has(f[6]) && !KEEP_CODES.has(f[7])) return;
    if (Number(f[0]) % parts !== part) return; // big countries (IR) can be split into parts
    places.set(Number(f[0]), { name: f[1], ascii: f[2], fc: f[6], fcode: f[7], admin1: f[10], pop: Number(f[14] || 0), lat: f[4], lng: f[5] });
  });
  // 3b
  const names = new Map<number, Record<string, [number, string][]>>();
  let kept = 0;
  await zipLines(`${BASE}/alternatenames/${cc}.zip`, `${cc}.txt`, (line) => {
    // Field 3 is the language: skip other languages (most of the file) without split().
    const t1 = line.indexOf("\t");
    const t2 = line.indexOf("\t", t1 + 1);
    const t3 = line.indexOf("\t", t2 + 1);
    if (t3 - t2 !== 3) return; // "he" / "ar" / "en" are two letters
    if (!places.has(Number(line.slice(t1 + 1, t2)))) return;
    const f = line.split("\t");
    if (f.length < 4 || !LANGS.has(f[2])) return;
    const gid = Number(f[1]);
    if (!places.has(gid)) return;
    if (f[6] === "1" || f[7] === "1" || !f[3]?.trim()) return; // colloquial / historic / empty
    const rank = f[4] === "1" ? 0 : f[5] === "1" ? 1 : 2;
    const byLang = names.get(gid) ?? {};
    (byLang[f[2]] ??= []).push([rank, f[3].trim()]);
    names.set(gid, byLang);
    kept++;
  });
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
