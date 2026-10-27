// event-agent: on-demand AI work for one event.
//   {action:"expand", id}        signed-in users — the "expand" button. Writes the full text, religious
//                                meaning and other implications (Hebrew + English) once per event
//                                and caches them in events.translations; later readers get the cache.
//   {action:"edit", id}          cron secret — a foreign-language draft a person published:
//                                run the editor agent (Hebrew headline + summary, English, places).
//   {action:"video", id}         signed-in users — play pressed on a video thumbnail (id = thumbnail): fetch the
//                                video of that post once (max 50 MB) and return its URL.
//   {action:"claude_usage"}      staff (their own session) — the whole Claude API organization's daily
//                                usage and cost (Admin API; needs the secret ANTHROPIC_ADMIN_KEY).
//   {action:"compose", text}     staff (event.create / event.edit.any) — "quick compose" on the report
//                                form: free text in any language → title, summary, category, place…
//                                Nothing is saved; the form is filled for the person to check.
//   {action:"ask", question}     signed-in users — "ask the map": a free-text question about our events
//                                → answer + event ids (shown on the map). 40 questions / hour / user.
//   {action:"classify_channels"} cron secret — region of public Telegram channels without one (batch of 120).
//   {action:"dedupe", minutes?}  cron secret — fold duplicate reports of one incident into one event
//                                (events created since the last run vs. the last 12 hours).
//   {action:"attach_media", event_id, media, post_url?}  staff — save a composed link's pictures to the event.
//   {action:"translate", limit}  cron secret — backfill English/short Hebrew for older events.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { EXPAND_VERSION, countryCode, editReport, expandReport, geocode, foreignShare, formatCategoryLessons, formatDescription, locationsForDb, mainCountry, mainPoint, translationsFor } from "../_shared/editor.ts";
import { setUsageSink } from "../_shared/usage.ts";
import { videoForThumb } from "../_shared/videoOnDemand.ts";
import { claudeUsage } from "../_shared/claudeUsage.ts";
import { askMap } from "../_shared/ask.ts";
import { dedupeRecent } from "../_shared/dedupe.ts";
import { splitEventByCategory } from "../_shared/splitEvent.ts";
import { TRANSLATE_API_URL, translateBriefChain } from "../_shared/translate.ts";
import { AGENT_EXCLUDED_CATEGORIES } from "../_shared/categoryRules.ts";
import { classifyChannels } from "../_shared/channels.ts";
import { fetchLink, firstUrl, type LinkContent } from "../_shared/linkFetch.ts";
import { imageAsBase64 } from "../whatsapp-ingest/telegram.ts";
import { makeRoom } from "../_shared/videoOnDemand.ts";
import { alreadyHas, hashImage } from "../_shared/imageHash.ts";
import { controlSync, hebrewNamesLebanon, hebrewNamesSouthLebanon, learnSouthLebanon, osmWadis, sectsSync } from "../_shared/layers.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
setUsageSink(db, "event-agent");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let secret: string | null = null;
async function cronOk(req: Request) {
  if (secret === null) {
    const { data } = await db.from("intel_config").select("value").eq("key", "cron_secret").maybeSingle();
    secret = data?.value ?? "";
  }
  const given = req.headers.get("x-cron-secret") ?? "";
  return !!secret && given.length === secret.length && given === secret;
}

type Tr = Record<string, Record<string, string | undefined>>;
const asTr = (v: unknown): Tr => (v && typeof v === "object" && !Array.isArray(v) ? (v as Tr) : {});

function expandedView(tr: Tr) {
  const pick = (l: string) => tr[l]?.details ? { details: tr[l].details, religious: tr[l].religious ?? "", implications: tr[l].implications ?? "" } : null;
  return { he: pick("he"), en: pick("en") };
}

const SOCIAL = /(^|\.)(twitter\.com|x\.com|facebook\.com|fb\.watch|instagram\.com|tiktok\.com|youtube\.com|youtu\.be|wa\.me|whatsapp\.com|chat\.whatsapp\.com)$/i;
/** Up to two article links in a report text (not the post's own link, not social networks). */
function articleLinks(text: string, own?: string | null): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const u = m[0].replace(/[.,;:!?]+$/, "");
    let host = "";
    try { host = new URL(u).hostname; } catch { continue; }
    if (SOCIAL.test(host) || (own && u.replace(/\/$/, "") === own.replace(/\/$/, ""))) continue;
    if (/^(t\.me|telegram\.me)$/i.test(host) && !/\/\d+\/?$/.test(u)) continue; // a channel, not a post
    if (!out.includes(u)) out.push(u);
    if (out.length === 2) break;
  }
  return out;
}

async function expand(id: string) {
  const { data: ev } = await db.from("events")
    .select("id,title,description,original_report_text,source_name,source_url,translations,ai_suggestions,status,deleted_at")
    .eq("id", id).maybeSingle();
  if (!ev || ev.deleted_at || !["published", "archived"].includes(ev.status)) return json({ error: "not found" }, 404);
  const tr = asTr(ev.translations);
  // Other reports merged into this event (same incident, other sources): the expansion joins them.
  const { data: merged } = await db.from("whatsapp_ingest_log").select("message_text,chat_name")
    .eq("event_id", id).eq("decision", "merged_duplicate").order("sent_at").limit(6);
  const others = (merged ?? []).filter((m: any) => m.message_text && m.message_text !== ev.original_report_text);
  const cached = expandedView(tr);
  // Links to articles in the report (not the post itself, not social networks): the
  // expansion reads them. Older expansions written without reading the link are redone once.
  const links = articleLinks([ev.original_report_text, ...others.map((m: any) => m.message_text)].join("\n"), ev.source_url);
  const linksDone = !links.length || ev.ai_suggestions?.expand_links_read !== undefined;
  // Cached unless more reports were merged since it was written.
  if (cached.he && linksDone && Number(ev.ai_suggestions?.expanded_sources ?? 0) >= others.length && Number(ev.ai_suggestions?.expand_version ?? 1) >= EXPAND_VERSION) {
    return json({ ok: true, cached: true, ...cached });
  }
  // One writer at a time: a second reader within a minute waits for the first.
  const started = Date.parse(String(ev.ai_suggestions?.expanding_at ?? ""));
  if (Number.isFinite(started) && Date.now() - started < 90_000) return json({ ok: true, pending: true }, 202);
  await db.from("events").update({ ai_suggestions: { ...(ev.ai_suggestions ?? {}), expanding_at: new Date().toISOString() } }).eq("id", id);
  try {
    const pages = (await Promise.all(links.map((u) => fetchLink(u).catch(() => null))))
      .filter((p): p is LinkContent => !!p && p.text.length > 80);
    if (links.length) console.log("expand links", id, links.join(" "), `read ${pages.length}`);
    const r = await expandReport({
      text: [ev.original_report_text || ev.description || ev.title,
        ...pages.map((p) => `--- הכתבה המקושרת (${p.sourceName}, ${p.url}):\n${p.text.slice(0, 6000)}`),
        ...others.map((m: any, i: number) => `--- דיווח נוסף ${i + 1} (${m.chat_name ?? "מקור נוסף"}):\n${String(m.message_text).slice(0, 2000)}`)].join("\n\n"),
      title: ev.title, summary: tr.he?.summary ?? ev.description ?? "", origin: ev.source_name ?? "",
    });
    const next: Tr = {
      ...tr,
      he: { ...(tr.he ?? {}), details: r.he.details, religious: r.he.religious, implications: r.he.implications },
      en: { ...(tr.en ?? {}), details: r.en.details, religious: r.en.religious, implications: r.en.implications },
    };
    const { data: cur } = await db.from("events").select("ai_suggestions").eq("id", id).maybeSingle();
    const ai = { ...(cur?.ai_suggestions ?? {}), expand_model: r.model, expanded_sources: others.length, expand_version: EXPAND_VERSION,
      ...(links.length ? { expand_links_read: pages.length } : {}) };
    delete (ai as Record<string, unknown>).expanding_at;
    await db.from("events").update({ translations: next, ai_suggestions: ai }).eq("id", id);
    return json({ ok: true, cached: false, ...expandedView(next) });
  } catch (e) {
    const { data: cur } = await db.from("events").select("ai_suggestions").eq("id", id).maybeSingle();
    const ai = { ...(cur?.ai_suggestions ?? {}) };
    delete (ai as Record<string, unknown>).expanding_at;
    await db.from("events").update({ ai_suggestions: ai }).eq("id", id);
    console.error("expand failed", String((e as Error)?.message ?? e).slice(0, 300));
    return json({ error: "expand failed" }, 502);
  }
}

async function edit(id: string) {
  const { data: ev } = await db.from("events")
    .select("id,title,description,original_report_text,source_name,source_url,occurred_at,country,translations,ai_suggestions,latitude,coordinates_manually_corrected")
    .eq("id", id).maybeSingle();
  if (!ev) return json({ error: "not found" }, 404);
  // Every place the report names, each with what happened there (split per category below).
  const { data: catRows } = await db.from("event_categories").select("slug,name").eq("is_active", true);
  const cats = (catRows ?? []).filter((c: any) => !["home-front-alerts", "other", "uncategorized"].includes(c.slug));
  const ai = { ...(ev.ai_suggestions ?? {}), sent_to_editor: new Date().toISOString() };
  await db.from("events").update({ ai_suggestions: ai }).eq("id", id);
  // The text the person published (they may have edited it), else the original report.
  const text = foreignShare(`${ev.title} ${ev.description}`) > 0.4 ? `${ev.title}\n\n${ev.description}` : ev.original_report_text || `${ev.title}\n\n${ev.description}`;
  const r = await editReport({ text, mode: "whatsapp", categories: cats, detailedPlaces: true, maxPlaces: 30, origin: { name: ev.source_name ?? "", url: ev.source_url, sentAt: ev.occurred_at } });
  const update: Record<string, unknown> = {
    ai_suggestions: { ...ai, editor_model: r.model, countries: r.countries },
    translations: { ...asTr(ev.translations), ...translationsFor(r) },
  };
  if (r.title) update.title = r.title.slice(0, 200);
  if (r.summary) update.description = formatDescription(r);
  if (!ev.country && mainCountry(r)) update.country = mainCountry(r);
  // A place a person corrected by hand stays; otherwise the editor's places replace the old ones.
  if (!ev.coordinates_manually_corrected) {
    update.locations = locationsForDb(r, 30);
    const pt = mainPoint(r);
    if (pt) Object.assign(update, { latitude: pt.lat, longitude: pt.lng, location_name: pt.name.slice(0, 200), location_precision: pt.precision });
  }
  const { error } = await db.from("events").update(update).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  const { data: after } = await db.from("events").select("locations").eq("id", id).maybeSingle();
  // Places the database could not pin (not found in the gazetteer or GeoNames).
  const kept = new Set(((after?.locations ?? []) as any[]).map((l) => l?.name_en || l?.name));
  const lost = Array.isArray(update.locations) ? (update.locations as any[]).filter((l) => !kept.has(l?.name_en || l?.name)).map((l) => [l.name, l.name_en, l.name_ar ?? ""].join(" / ")) : [];
  let siblings: string[] = [];
  if (!ev.ai_suggestions?.split_from && !ev.ai_suggestions?.split_into) {
    try { siblings = await splitEventByCategory(db, id); } catch (e) { console.error("split failed", String((e as Error)?.message ?? e).slice(0, 200)); }
  }
  return json({ ok: true, id, title: update.title, places: Array.isArray(update.locations) ? (update.locations as unknown[]).length : null, siblings, not_found: lost });
}

async function translate(limit: number, drafts = false) {
  const { data: rows } = await db.from("events")
    .select("id,title,description,original_report_text,translations")
    .is("deleted_at", null).in("status", drafts ? ["draft", "pending_review"] : ["published", "archived"])
    .order("occurred_at", { ascending: false }).limit(400);
  // Drafts: only those still in a foreign language (their headline is rewritten in Hebrew).
  const todo = (rows ?? []).filter((e) => drafts ? foreignShare(e.title) > 0.4 : !asTr(e.translations).en?.title).slice(0, limit);
  let done = 0;
  const errors: string[] = [];
  for (const e of todo) {
    try {
      // Free providers first (site translation chain); Claude only as the last fallback.
      const r = await translateBriefChain(e.title, e.description || e.original_report_text || "");
      if (!r) continue; // nothing could translate it now
      const tr = asTr(e.translations);
      const next: Tr = {
        ...tr,
        he: { ...(tr.he ?? {}), summary: tr.he?.summary || r.summary_he, ...(foreignShare(e.title) > 0.4 ? { title: r.title_he } : {}) },
        en: { ...(tr.en ?? {}), title: r.title_en, summary: r.summary_en, description: tr.en?.description || r.summary_en },
      };
      await db.from("events").update(drafts && foreignShare(e.title) > 0.4
        ? { translations: next, title: r.title_he.slice(0, 200), description: r.summary_he || e.description }
        : { translations: next }).eq("id", e.id);
      done++;
    } catch (err) {
      errors.push(String((err as Error)?.message ?? err).slice(0, 120));
      if (errors.length > 3) break;
    }
  }
  return json({ ok: true, done, left: (rows ?? []).filter((e) => !asTr(e.translations).en?.title).length - done, errors });
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error("event-agent", String((e as Error)?.message ?? e).slice(0, 300));
    return json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, 500);
  }
});

/** Quick compose: free text in any language → every field of the report form (nothing is saved). */
async function compose(body: Record<string, unknown>) {
  let text = String(body?.text ?? "").trim().slice(0, 8000);
  // A link in the text: read the page (article or public Telegram post) — its text, date
  // and pictures join the report.
  const link = firstUrl(text);
  let page: LinkContent | null = null;
  if (link) {
    page = await fetchLink(link).catch(() => null);
    const own = text.replace(link, "").trim();
    if (page?.text) text = [own, page.text].filter(Boolean).join("\n\n").slice(0, 9000);
    else if (own.length < 10) return json({ error: "link_unreadable" }, 422);
  }
  if (text.length < 10) return json({ error: "text too short" }, 400);
  const { data: cats } = await db.from("event_categories").select("id,slug,name").eq("is_active", true);
  const { data: corrections } = await db.from("category_corrections").select("text,from_slug,to_slug").order("created_at", { ascending: false }).limit(25);
  const sentAt = page?.date ?? (typeof body?.sent_at === "string" && !isNaN(Date.parse(body.sent_at)) ? body.sent_at : new Date().toISOString());
  const r = await editReport({
    text,
    mode: "crawler",
    categories: (cats ?? []).filter((c: any) => !AGENT_EXCLUDED_CATEGORIES.has(c.slug)).map((c: any) => ({ slug: c.slug, name: c.name })),
    categoryLessons: formatCategoryLessons(corrections ?? []),
    origin: { name: (page?.sourceName ?? String(body?.source_name ?? "")).slice(0, 120), url: page?.url ?? (typeof body?.source_url === "string" ? body.source_url : undefined), sentAt },
    detailedPlaces: true,
    maxPlaces: 30,
  });
  // Every place: our own places database first (villages the geocoder misses), then the
  // geocoder. A list of places of one report is close together: a first pass finds the area,
  // a second pass picks, for every name, the place nearest to it (no "Qantara" in the north
  // for a report from the south), and the geocoder fills the rest.
  type Hit = { lat: number; lng: number; precision: "exact" | "region"; he: string | null };
  const lookup = async (l: (typeof r.locations)[number], near?: { lat: number; lng: number }): Promise<Hit | null> => {
    // Arabic compounds are written joined or apart ("كفرتبنيت" / "كفر تبنيت"); try both.
    const ar = (l.name_ar ?? "").replace(/^(?:أطراف|اطراف|خراج|محيط)\s+/, "");
    const arSpaced = ar.replace(/^(كفر|دير|بيت|عين|مجدل|تل|جبل|خربة|عيتا|برج)(?=[^\s])/, "$1 ");
    // Places editors corrected by hand come first.
    const { data: lp } = await db.rpc("learned_place", { p_name: l.name, p_name_en: l.name_en || null });
    if (lp && (lp as any).id && (lp as any).latitude != null) return { lat: Number((lp as any).latitude), lng: Number((lp as any).longitude), precision: "exact", he: null };
    for (const name of [ar, arSpaced !== ar ? arSpaced : "", l.name_en, l.name].filter(Boolean) as string[]) {
      const { data: hit } = await db.rpc("geo_lookup", { p_name: name, p_country: l.country || r.country || null, p_lat: near?.lat ?? null, p_lng: near?.lng ?? null });
      const c = (hit as { geom?: { coordinates?: unknown } } | null)?.geom?.coordinates;
      if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
        return { lat: Math.round(c[1] * 1e5) / 1e5, lng: Math.round(c[0] * 1e5) / 1e5, precision: (hit as any).feature_class === "A" ? "region" : "exact", he: (hit as any).name_he ?? null };
      }
    }
    return null;
  };
  const first = await Promise.all(r.locations.map((l) => lookup(l)));
  const found = first.filter(Boolean) as Hit[];
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const anchor = found.length ? { lat: median(found.map((h) => h.lat)), lng: median(found.map((h) => h.lng)) } : null;
  const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180));
  const second = anchor ? await Promise.all(r.locations.map((l) => lookup(l, anchor))) : first;
  let nominatimCalls = 0;
  for (const [i, l] of r.locations.entries()) {
    let h = second[i] ?? first[i];
    // The editor's own coordinates (model / geocoder) as a fallback.
    if (!h && l.lat !== null && l.lng !== null) h = { lat: l.lat, lng: l.lng, precision: l.precision ?? "exact", he: null };
    if (h && anchor && km(h, anchor) > 60) h = null; // far from the rest of the report: not this one
    if (!h && nominatimCalls < 10 && (l.name_en || l.name)) {
      nominatimCalls++;
      const cc = countryCode(l.country || r.country);
      const g = await (cc ? geocode(l.name_en || l.name, cc) : geocode(`${l.name_en || l.name}, ${l.country || r.country || ""}`)).catch(() => null);
      if (g && g.kind !== "country" && (!anchor || km(g, anchor) <= 60)) h = { lat: Math.round(g.lat * 1e5) / 1e5, lng: Math.round(g.lng * 1e5) / 1e5, precision: "exact", he: null };
      await new Promise((res) => setTimeout(res, 1100)); // Nominatim: 1 request a second
    }
    if (h) {
      l.lat = h.lat;
      l.lng = h.lng;
      l.precision = h.precision;
      if (h.he && !/[\u0590-\u05FF]/.test(l.name)) l.name = h.he;
    } else {
      l.lat = null;
      l.lng = null;
    }
  }
  let point = mainPoint(r);
  // Model/geocoder found no coordinates: try our own places database.
  if (!point && r.locations[0]) {
    const l = r.locations[0];
    const { data: hit } = await db.rpc("geo_lookup", { p_name: l.name_en || l.name, p_country: l.country || null });
    // geom comes back as GeoJSON {type:"Point", coordinates:[lng, lat]}.
    const c = (hit as { geom?: { coordinates?: unknown } } | null)?.geom?.coordinates;
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
      point = { lat: c[1], lng: c[0], name: (hit as any).name_he || l.name, precision: (hit as any).feature_class === "A" ? "region" : "exact" };
    }
  }
  const cat = (cats ?? []).find((c: any) => c.slug === r.category_slug);
  return json({
    ok: true,
    title: r.title,
    description: formatDescription(r),
    categoryId: cat?.id ?? null,
    categorySlug: r.category_slug ?? null,
    severity: r.severity,
    isBreaking: r.is_breaking,
    country: mainCountry(r),
    region: r.region,
    city: r.city,
    locationName: point?.name || r.location_name,
    latitude: point?.lat ?? null,
    longitude: point?.lng ?? null,
    precision: point?.precision ?? null,
    locations: locationsForDb(r, 30),
    translations: translationsFor(r),
    model: r.model,
    ...(page
      ? { link: { url: page.url, sourceName: page.sourceName, occurredAt: page.date, media: page.media, text: page.text.slice(0, 6000) } }
      : link ? { link: { url: link, sourceName: "", occurredAt: null, media: [], text: "" } } : {}),
  });
}

/** Save the pictures of a composed link to a new event (staff, after "save"). */
async function attachMedia(body: Record<string, unknown>) {
  const eventId = String(body?.event_id ?? "");
  if (!UUID.test(eventId)) return json({ error: "bad id" }, 400);
  const postUrl = typeof body?.post_url === "string" && /^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{3,}\/\d+$/.test(body.post_url) ? body.post_url : null;
  const items = (Array.isArray(body?.media) ? body.media : []).slice(0, 4) as { url?: string; kind?: string }[];
  const d = new Date();
  let n = 0, videoIndex = 0;
  const { data: had } = await db.from("event_media").select("sha256,phash").eq("event_id", eventId);
  const known: { sha?: string | null; phash?: string | null }[] = (had ?? []).map((r: any) => ({ sha: r.sha256, phash: r.phash }));
  for (const [i, m] of items.entries()) {
    if (typeof m?.url !== "string" || !/^https:\/\//.test(m.url)) continue;
    const img = await imageAsBase64(m.url);
    if (!img) continue;
    const bytes = Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0));
    const fp = await hashImage(bytes, img.mime);
    if (alreadyHas(known, fp)) continue;
    known.push(fp);
    await makeRoom(db, bytes.length);
    const ext = img.mime === "image/jpeg" ? "jpg" : img.mime.split("/")[1];
    const path = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${eventId}/link-${i}.${ext}`;
    const up = await db.storage.from("event-media").upload(path, bytes, { contentType: img.mime, upsert: true });
    if (up.error) continue;
    const url = db.storage.from("event-media").getPublicUrl(path).data.publicUrl;
    const video = m.kind === "video_thumb";
    await db.from("event_media").upsert({
      event_id: eventId, kind: video ? "video_thumb" : "image", storage_path: path, public_url: url, bytes: bytes.length,
      source_msg_key: `link:${eventId}`, sha256: fp.sha, phash: fp.phash,
      ...(video ? { source_url: postUrl, source_index: videoIndex++ } : {}),
    }, { onConflict: "storage_path" });
    n++;
  }
  return json({ ok: true, saved: n });
}

/**
 * The same photo posted by several channels (or brought in when two events were merged):
 * fingerprint the pictures of recent events that have none yet, then keep one copy of each
 * (a video thumbnail before a plain picture, then the oldest) and delete the rest.
 */
async function mediaDedupe(hours: number, eventIds: string[] = []) {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  let q = db.from("event_media")
    .select("id,event_id,kind,storage_path,public_url,sha256,phash,created_at,mime")
    .in("kind", ["image", "video_thumb"]);
  q = eventIds.length ? q.in("event_id", eventIds) : q.gte("created_at", since);
  const { data: rows } = await q.order("created_at").limit(2000);
  let hashed = 0;
  // Decoding pictures costs CPU: a few dozen per run, the rest on the next runs.
  for (const r of rows ?? []) {
    if (r.sha256) continue;
    if (hashed >= 30) break;
    try {
      const res = await fetch(r.public_url);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const fp = await hashImage(bytes, /\.png$/i.test(r.storage_path) ? "image/png" : /\.webp$/i.test(r.storage_path) ? "image/webp" : "image/jpeg");
      r.sha256 = fp.sha;
      r.phash = fp.phash;
      await db.from("event_media").update({ sha256: fp.sha, phash: fp.phash }).eq("id", r.id);
      hashed++;
    } catch { /* try again next run */ }
  }
  const byEvent = new Map<string, any[]>();
  for (const r of rows ?? []) if (r.sha256) byEvent.set(r.event_id, [...(byEvent.get(r.event_id) ?? []), r]);
  const drop: any[] = [];
  for (const list of byEvent.values()) {
    list.sort((a, b) => (a.kind === b.kind ? a.created_at.localeCompare(b.created_at) : a.kind === "video_thumb" ? -1 : 1));
    const kept: { sha?: string | null; phash?: string | null }[] = [];
    for (const r of list) {
      if (alreadyHas(kept, { sha: r.sha256, phash: r.phash })) drop.push(r);
      else kept.push({ sha: r.sha256, phash: r.phash });
    }
  }
  if (drop.length) {
    await db.storage.from("event-media").remove(drop.map((r) => r.storage_path));
    await db.from("event_media").delete().in("id", drop.map((r) => r.id));
  }
  return json({ ok: true, checked: rows?.length ?? 0, hashed, left: (rows ?? []).filter((r) => !r.sha256).length, removed: drop.length, events: [...new Set(drop.map((r) => r.event_id))].length });
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  const id = String(body?.id ?? "");
  // Members-only site: the reader actions need a signed-in, active account (or the cron secret).
  if (action === "expand" || action === "video") {
    if (!(await cronOk(req))) {
      const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        auth: { persistSession: false },
        global: { headers: { Authorization: req.headers.get("authorization") ?? "" } },
      });
      const { data: who } = await asUser.auth.getUser();
      const uid = who?.user?.id;
      if (!uid) return json({ error: "sign in required" }, 401);
      const { data: prof } = await db.from("profiles").select("status").eq("id", uid).maybeSingle();
      if (prof?.status !== "active") return json({ error: "unauthorized" }, 401);
    }
  }
  if (action === "expand") {
    if (!UUID.test(id)) return json({ error: "bad id" }, 400);
    return await expand(id);
  }
  if (action === "claude_usage") {
    // Staff only: check the caller's own session.
    const auth = req.headers.get("authorization") ?? "";
    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: auth } },
    });
    const { data: ok } = await asUser.rpc("has_permission", { p_permission: "ai.usage.view" });
    if (ok !== true) return json({ error: "unauthorized" }, 401);
    try {
      return json({ ok: true, ...(await claudeUsage(30)) });
    } catch (e) {
      return json({ ok: false, configured: true, error: String((e as Error)?.message ?? e).slice(0, 300) }, 502);
    }
  }
  if (action === "compose" || action === "attach_media") {
    // Staff who may create or edit events: check the caller's own session.
    const auth = req.headers.get("authorization") ?? "";
    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: auth } },
    });
    const [{ data: a }, { data: b }] = await Promise.all([
      asUser.rpc("has_permission", { p_permission: "event.create" }),
      asUser.rpc("has_permission", { p_permission: "event.edit.any" }),
    ]);
    if (a !== true && b !== true && !(await cronOk(req))) return json({ error: "unauthorized" }, 401);
    try {
      if (action === "attach_media") return await attachMedia(body);
      return await compose(body);
    } catch (e) {
      return json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, 502);
    }
  }
  if (action === "ask") {
    const question = String(body?.question ?? "").trim().slice(0, 500);
    if (question.length < 3) return json({ error: "question too short" }, 400);
    const auth = req.headers.get("authorization") ?? "";
    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: auth } },
    });
    // Signed-in active users (40 / hour); the cron secret too (internal checks).
    let uid: string | null = null;
    if (!(await cronOk(req))) {
      const { data: who } = await asUser.auth.getUser();
      uid = who?.user?.id ?? null;
      if (!uid) return json({ error: "sign in required" }, 401);
      const { data: prof } = await db.from("profiles").select("status").eq("id", uid).maybeSingle();
      if (prof?.status !== "active") return json({ error: "unauthorized" }, 401);
      const { count } = await db.from("ai_search_log").select("id", { count: "exact", head: true })
        .eq("user_id", uid).gte("at", new Date(Date.now() - 3600_000).toISOString());
      if ((count ?? 0) >= 40) return json({ error: "rate_limited" }, 429);
    }
    try {
      const r = await askMap(db, question);
      await db.from("ai_search_log").insert({ user_id: uid, question, results: r.ids.length });
      return json({ ok: true, ...r });
    } catch (e) {
      return json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, 502);
    }
  }
  if (action === "video") {
    if (!UUID.test(id)) return json({ error: "bad id" }, 400);
    const r = await videoForThumb(db, id);
    return r ? json({ ok: true, ...r }) : json({ error: "not found" }, 404);
  }
  if (!(await cronOk(req))) return json({ error: "unauthorized" }, 401);
  if (action === "edit") {
    if (!UUID.test(id)) return json({ error: "bad id" }, 400);
    return await edit(id);
  }
  if (action === "hebrew_south_lebanon") {
    try {
      return json(await hebrewNamesSouthLebanon(db, Math.min(200, Number(body?.limit) || 120)));
    } catch (e) {
      return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, 502);
    }
  }
  if (action === "hebrew_lebanon") {
    const kind = ["village", "wadi", "line"].includes(String(body?.kind)) ? String(body.kind) as "village" | "wadi" | "line" : "village";
    try {
      return json(await hebrewNamesLebanon(db, kind, Math.min(200, Number(body?.limit) || 120), Math.max(0, Number(body?.part) || 0), Math.max(1, Number(body?.parts) || 1)));
    } catch (e) {
      return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, 502);
    }
  }
  if (action === "osm_wadis") {
    try {
      return json(await osmWadis(db));
    } catch (e) {
      return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, 502);
    }
  }
  if (action === "control_sync" || action === "sects_sync" || action === "learn_south_lebanon") {
    try {
      return json(action === "control_sync" ? await controlSync(db) : action === "sects_sync" ? await sectsSync(db) : await learnSouthLebanon(db));
    } catch (e) {
      return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, 502);
    }
  }
  if (action === "media_dedupe") {
    const ids = (Array.isArray(body?.event_ids) ? body.event_ids : []).map(String).filter((x: string) => UUID.test(x)).slice(0, 50);
    return await mediaDedupe(Math.min(24 * 30, Math.max(1, Number(body?.hours) || 48)), ids);
  }
  if (action === "translate_test") {
    // Health check of the site's translation chain (each free provider on its own).
    const url = TRANSLATE_API_URL, secret = Deno.env.get("TRANSLATE_SECRET") ?? "";
    if (!url || !secret) return json({ ok: false, error: "TRANSLATE_API_URL / TRANSLATE_SECRET not set in Supabase" });
    const chainReq = body?.chain === true
      ? fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-translate-secret": secret }, body: JSON.stringify({ texts: [String(body?.text ?? "")], target: body?.target === "en" ? "en" : "he" }) })
      : fetch(`${url}?test=1${body?.paid === true ? "&paid=1" : ""}${typeof body?.only === "string" ? `&only=${encodeURIComponent(body.only)}` : ""}`, { headers: { "x-translate-secret": secret } });
    const res = await chainReq;
    const out = { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
    // Kept for reading later (the answer of a long test may not reach the caller).
    await db.from("layer_sync").upsert({ layer: "translate_test", synced_at: new Date().toISOString(), detail: JSON.stringify(out).slice(0, 20000) }, { onConflict: "layer" });
    return json(out);
  }
  if (action === "split") {
    if (!UUID.test(id)) return json({ error: "bad id" }, 400);
    return json({ ok: true, created: await splitEventByCategory(db, id) });
  }
  if (action === "classify_channels") {
    try {
      return json({ ok: true, ...(await classifyChannels(db)) });
    } catch (e) {
      return json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, 502);
    }
  }
  if (action === "dedupe") {
    const m = Number(body?.minutes);
    try {
      return json({ ok: true, ...(await dedupeRecent(db, Number.isFinite(m) && m > 0 ? Math.min(m, 48 * 60) : undefined, body?.dry === true)) });
    } catch (e) {
      return json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, 502);
    }
  }
  if (action === "translate") return await translate(Math.min(Math.max(Number(body?.limit ?? 20) | 0, 1), 60), body?.drafts === true);
  return json({ error: "unknown action" }, 400);
}
