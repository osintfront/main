// Social-media search by map area — "intel" plan and staff only (migration 0074).
//   {action:"search", polygon:[[lat,lng],…], hours?, terms?}  → places in the area (he/ar/en) × event words.
//      X: official API v2 recent search (secret X_BEARER_TOKEN), answered at once.
//      Facebook / Instagram / TikTok: a data provider (Apify, secret APIFY_TOKEN), runs started here;
//      which actor runs for which network: app_settings.social_providers.
//   {action:"poll", id}  → collects finished provider runs and returns every result of the search.
// Media are kept as links to the original post only (nothing is downloaded or stored).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const X_TOKEN = (Deno.env.get("X_BEARER_TOKEN") ?? "").trim();
const APIFY = (Deno.env.get("APIFY_TOKEN") ?? "").trim();
const X_READ_USD = 0.005;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const WORDS = {
  he: ["פיצוץ", "ירי", "תקיפה", "אזעקה", "שיגור", "יירוט", "כטב\"ם"],
  ar: ["انفجار", "قصف", "غارة", "غارات", "استهداف", "اشتباكات", "مسيرة", "صاروخ", "حربي"],
  en: ["explosion", "strike", "airstrike", "attack", "shelling", "drone", "missile"],
};
// Provider results come back loosely matched (a hashtag search for "Tyre" brings tyre shops):
// keep only posts that mention an event word or one of the user's words.
const relevantWord = (text: string | null, terms: string[] | null): string | null => {
  const t = (text ?? "").toLowerCase();
  for (const w of [...(terms ?? []), ...WORDS.ar, ...WORDS.he, ...WORDS.en]) if (w && t.includes(w.toLowerCase())) return w;
  return null;
};

type Result = { platform: string; post_id: string; url: string | null; author: string | null; text: string | null; posted_at: string | null; media: unknown[]; matched: string | null };
type Run = { status: "running" | "done" | "error" | "off"; run_id?: string; dataset_id?: string; error?: string };

let cronSecret: string | null = null;
async function caller(req: Request): Promise<{ uid: string | null; staff: boolean } | null> {
  // Internal checks (pg_net with the cron secret) run as staff without a user.
  const given = req.headers.get("x-cron-secret") ?? "";
  if (given) {
    if (cronSecret === null) {
      const { data } = await db.from("intel_config").select("value").eq("key", "cron_secret").maybeSingle();
      cronSecret = data?.value ?? "";
    }
    if (cronSecret && given === cronSecret) return { uid: null, staff: true };
  }
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get("authorization") ?? "" } },
  });
  const { data: who } = await asUser.auth.getUser();
  const uid = who?.user?.id;
  if (!uid) return null;
  const { data: p } = await db.from("profiles").select("role,status,plan,plan_expires_at").eq("id", uid).maybeSingle();
  if (!p || p.status !== "active") return null;
  const staff = p.role !== "viewer";
  const intel = p.plan === "intel" && (!p.plan_expires_at || Date.parse(p.plan_expires_at) > Date.now());
  return staff || intel ? { uid, staff } : null;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
const orGroup = (xs: string[]) => {
  const q = [...new Set(xs.map(clean).filter((x) => x.length > 1))].map((x) => (x.includes(" ") ? `"${x}"` : x));
  return q.length ? `(${q.join(" OR ")})` : "";
};

// ── X (official API) ──
async function searchX(places: { he: string[]; ar: string[]; en: string[] }, terms: string[] | null, hours: number): Promise<{ rows: Result[]; cost: number; error?: string }> {
  if (!X_TOKEN) return { rows: [], cost: 0, error: "not_configured" };
  const groups = [
    { places: places.ar, words: terms ?? WORDS.ar },
    { places: [...places.he, ...places.en], words: terms ?? [...WORDS.he, ...WORDS.en] },
  ];
  const start = new Date(Date.now() - Math.min(hours, 167) * 3600_000).toISOString();
  const rows: Result[] = [];
  let reads = 0;
  for (const g of groups) {
    let pl = g.places.slice(0, 6);
    let q = "";
    // Keep the query under X's 512-character limit by dropping the smallest places.
    while (pl.length) {
      q = `${orGroup(pl)} ${orGroup(g.words)} -is:retweet`;
      if (q.length <= 500) break;
      pl = pl.slice(0, -1);
    }
    if (!pl.length) continue;
    const u = new URL("https://api.x.com/2/tweets/search/recent");
    u.searchParams.set("query", q);
    u.searchParams.set("max_results", "25");
    u.searchParams.set("start_time", start);
    u.searchParams.set("tweet.fields", "created_at,author_id,attachments,lang");
    u.searchParams.set("expansions", "attachments.media_keys,author_id");
    u.searchParams.set("media.fields", "type,url,preview_image_url,variants");
    u.searchParams.set("user.fields", "username,name");
    const res = await fetch(u, { headers: { authorization: `Bearer ${X_TOKEN}` } });
    if (!res.ok) return { rows, cost: reads * X_READ_USD, error: `x_${res.status}` };
    const body = await res.json();
    const users = new Map<string, any>((body.includes?.users ?? []).map((x: any) => [x.id, x]));
    const media = new Map<string, any>((body.includes?.media ?? []).map((m: any) => [m.media_key, m]));
    for (const tw of body.data ?? []) {
      reads++;
      const user = users.get(tw.author_id);
      const m = (tw.attachments?.media_keys ?? []).map((k: string) => media.get(k)).filter(Boolean).map((x: any) => {
        const mp4 = (x.variants ?? []).filter((v: any) => v.content_type === "video/mp4").sort((a: any, b: any) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0];
        return { type: x.type === "photo" ? "image" : "video", url: x.url ?? mp4?.url ?? null, preview: x.preview_image_url ?? x.url ?? null };
      });
      rows.push({
        platform: "x", post_id: String(tw.id),
        url: user?.username ? `https://x.com/${user.username}/status/${tw.id}` : `https://x.com/i/status/${tw.id}`,
        author: user ? `${user.name} (@${user.username})` : null, text: tw.text ?? null, posted_at: tw.created_at ?? null,
        media: m, matched: pl.join(", "),
      });
    }
  }
  return { rows, cost: reads * X_READ_USD };
}

// ── Data provider (Apify) ──
function fill(v: unknown, q: string[], tags: string[]): unknown {
  if (Array.isArray(v)) return v.flatMap((x) => (x === "{q}" ? q : x === "{tag}" ? tags : [fill(x, q, tags)]));
  if (typeof v === "string") return v === "{q}" ? q[0] ?? "" : v === "{tag}" ? tags[0] ?? "" : v;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, q, tags)]));
  return v;
}

async function startRuns(places: { he: string[]; ar: string[]; en: string[] }, terms: string[] | null): Promise<Record<string, Run>> {
  const { data: s } = await db.from("app_settings").select("value").eq("key", "social_providers").maybeSingle();
  const cfg = (s?.value ?? {}) as Record<string, { actor: string | null; input: unknown }>;
  const top = [...places.ar.slice(0, 2), ...places.en.slice(0, 2), ...places.he.slice(0, 1)].map(clean).filter(Boolean);
  // Place + event word, so the network's own search does the first filtering.
  const q = (terms?.length
    ? top.flatMap((p) => terms.slice(0, 2).map((t) => `${p} ${t}`))
    : [...places.ar.slice(0, 3).flatMap((p) => [`${clean(p)} غارة`, `${clean(p)} قصف`]), ...places.he.slice(0, 1).map((p) => `${clean(p)} פיצוץ`), ...places.en.slice(0, 1).map((p) => `${clean(p)} strike`)]
  ).slice(0, 6);
  const tags = [...new Set(top.map((p) => p.replace(/\s+/g, "")))];
  const runs: Record<string, Run> = {};
  for (const net of ["facebook", "instagram", "tiktok"]) {
    const c = cfg[net];
    if (!APIFY || !c?.actor) { runs[net] = { status: "off", error: !APIFY ? "not_configured" : "no_actor" }; continue; }
    try {
      const res = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(c.actor)}/runs?token=${APIFY}&timeout=240&memory=1024`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fill(c.input, q, tags)),
      });
      const body = await res.json();
      runs[net] = res.ok ? { status: "running", run_id: body.data?.id, dataset_id: body.data?.defaultDatasetId } : { status: "error", error: `apify_${res.status}` };
    } catch (e) {
      runs[net] = { status: "error", error: String((e as Error)?.message ?? e).slice(0, 120) };
    }
  }
  return runs;
}

const pick = (o: any, ...keys: string[]) => { for (const k of keys) { const v = k.split(".").reduce((a, p) => a?.[p], o); if (v != null && v !== "") return v; } return null; };
function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
function normalize(net: string, it: any): Result | null {
  const url = pick(it, "webVideoUrl", "postUrl", "url", "link", "facebookUrl");
  const id = pick(it, "id", "postId", "shortCode", "post_id") ?? url;
  if (!id) return null;
  const preview = pick(it, "videoMeta.coverUrl", "covers.default", "displayUrl", "thumbnail", "image", "full_picture", "media.0.thumbnail");
  const video = pick(it, "videoUrl", "mediaUrls.0") ?? (it.type === "Video" || net === "tiktok" ? url : null);
  const media = preview || video ? [{ type: video ? "video" : "image", url: video ?? preview, preview }] : [];
  return {
    platform: net, post_id: String(id), url: url ? String(url) : null,
    author: pick(it, "authorMeta.name", "ownerUsername", "user.name", "author.name", "pageName", "username"),
    text: pick(it, "text", "caption", "description", "message", "postText"),
    posted_at: toIso(pick(it, "createTimeISO", "timestamp", "time", "date", "createTime", "publishedAt")),
    media, matched: null,
  };
}

async function collect(searchId: string, runs: Record<string, Run>, hours: number, terms: string[] | null): Promise<{ runs: Record<string, Run>; rows: Result[]; cost: number }> {
  const since = Date.now() - hours * 3600_000;
  const rows: Result[] = [];
  let cost = 0;
  for (const [net, r] of Object.entries(runs)) {
    if (r.status !== "running" || !r.run_id) continue;
    const st = await fetch(`https://api.apify.com/v2/actor-runs/${r.run_id}?token=${APIFY}`).then((x) => x.json()).catch(() => null);
    const status = st?.data?.status;
    if (status === "SUCCEEDED") {
      const items = await fetch(`https://api.apify.com/v2/datasets/${r.dataset_id}/items?clean=true&limit=80&token=${APIFY}`).then((x) => x.json()).catch(() => []);
      for (const it of Array.isArray(items) ? items : []) {
        const n = normalize(net, it);
        if (!n || (n.posted_at && Date.parse(n.posted_at) < since)) continue;
        const hit = relevantWord(n.text, terms);
        if (hit) rows.push({ ...n, matched: hit });
      }
      cost += Number(st.data.usageTotalUsd ?? 0);
      runs[net] = { ...r, status: "done" };
    } else if (["FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
      cost += Number(st.data.usageTotalUsd ?? 0);
      runs[net] = { ...r, status: "error", error: status.toLowerCase() };
    }
  }
  return { runs, rows, cost };
}

async function save(searchId: string, rows: Result[]) {
  if (!rows.length) return;
  await db.from("social_results").upsert(rows.map((r) => ({ ...r, search_id: searchId })), { onConflict: "search_id,platform,post_id", ignoreDuplicates: true });
}

async function answer(searchId: string) {
  const [{ data: s }, { data: rows }] = await Promise.all([
    db.from("social_searches").select("id,places,terms,hours,runs,cost_usd,created_at").eq("id", searchId).maybeSingle(),
    db.from("social_results").select("platform,post_id,url,author,text,posted_at,media,matched").eq("search_id", searchId).order("posted_at", { ascending: false, nullsFirst: false }).limit(300),
  ]);
  return json({ ok: true, search: s, results: rows ?? [] });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const body = await req.json().catch(() => ({}));
  const who = await caller(req);
  if (!who) return json({ error: "not_allowed" }, 403);
  const { data: on } = await db.from("app_settings").select("value").eq("key", "social_search_enabled").maybeSingle();
  if (on?.value !== true) return json({ error: "disabled" }, 503);

  if (body?.action === "search") {
    const poly: [number, number][] = Array.isArray(body.polygon) ? body.polygon.filter((p: unknown) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n))) : [];
    if (poly.length < 3) return json({ error: "bad_polygon" }, 400);
    const hours = Math.min(Math.max(Number(body.hours) || 24, 1), 168);
    const terms = Array.isArray(body.terms) ? body.terms.map((t: unknown) => clean(String(t)).slice(0, 40)).filter(Boolean).slice(0, 8) : null;
    if (!who.staff) {
      const { data: f } = await db.from("plan_features").select("limit_value").eq("feature_key", "social_search").eq("plan_id", "intel").maybeSingle();
      const since = new Date(Date.now() - 86400_000).toISOString();
      const { count } = await db.from("social_searches").select("id", { count: "exact", head: true }).eq("user_id", who.uid).gte("created_at", since);
      if (f?.limit_value != null && (count ?? 0) >= f.limit_value) return json({ error: "daily_limit" }, 429);
    }
    const ring = poly.map(([lat, lng]) => [lng, lat]);
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0]);
    const geo = { type: "Polygon", coordinates: [ring] };
    const { data: pl, error: plErr } = await db.rpc("places_in_polygon", { p_polygon: geo, p_limit: 6 });
    if (plErr) return json({ error: "places_failed" }, 502);
    const places = {
      // GeoNames sometimes holds a Latin transliteration in the Arabic/Hebrew slot: keep real script only.
      he: (pl ?? []).map((p: any) => String(p.name_he ?? "").replace(/[\u200e\u200f]/g, "").trim()).filter((n: string) => /[\u0590-\u05FF]/.test(n)),
      ar: (pl ?? []).map((p: any) => String(p.name_ar ?? "").replace(/[\u200e\u200f]/g, "").trim()).filter((n: string) => /[\u0600-\u06FF]/.test(n)),
      en: (pl ?? []).map((p: any) => p.name_en).filter(Boolean),
    };
    if (!places.he.length && !places.ar.length && !places.en.length) return json({ error: "no_places" }, 422);
    const [x, runs] = await Promise.all([searchX(places, terms, hours), startRuns(places, terms)]);
    const allRuns: Record<string, Run> = { x: x.error ? { status: x.error === "not_configured" ? "off" : "error", error: x.error } : { status: "done" }, ...runs };
    const { data: s, error } = await db.from("social_searches").insert({
      user_id: who.uid, polygon: geo, places: [...new Set([...places.he, ...places.en])], terms: terms ?? [], hours, runs: allRuns,
      cost_usd: x.cost, results_count: x.rows.length,
    }).select("id").single();
    if (error || !s) return json({ error: "save_failed" }, 500);
    await save(s.id, x.rows);
    return await answer(s.id);
  }

  if (body?.action === "poll") {
    const id = String(body.id ?? "");
    const { data: s } = await db.from("social_searches").select("id,user_id,runs,hours,cost_usd,terms").eq("id", id).maybeSingle();
    if (!s || (s.user_id !== who.uid && !who.staff)) return json({ error: "not found" }, 404);
    const r = await collect(s.id, { ...(s.runs as Record<string, Run>) }, s.hours, (s.terms as string[] | null)?.length ? (s.terms as string[]) : null);
    await save(s.id, r.rows);
    if (r.rows.length || r.cost) {
      const { count } = await db.from("social_results").select("id", { count: "exact", head: true }).eq("search_id", s.id);
      await db.from("social_searches").update({ runs: r.runs, cost_usd: Number(s.cost_usd) + r.cost, results_count: count ?? 0 }).eq("id", s.id);
    } else {
      await db.from("social_searches").update({ runs: r.runs }).eq("id", s.id);
    }
    return await answer(s.id);
  }
  return json({ error: "unknown action" }, 400);
});
