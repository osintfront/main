/// <reference types="node" />
// Push notifications for new events, by each subscriber's own site filters.
//
// GET  /api/push                → { publicKey }  (VAPID public key; the key pair is made once and kept in push_config)
// POST /api/push (x-push-secret) → sends notifications for events published since the last run.
//      Called every minute by pg_cron, only when there are new events.
import webpush from 'web-push';
import { EMPTY_FILTERS, matchesFilters, type EventFilters } from '../src/lib/eventFilters.js';
import type { PublicEvent } from '../src/types/event.js';
import { formatPush, severityOf, SEVERITY_RANK, type FormatIssues } from './_lib/pushFormat.js';

const env = (k: string) => (process.env[k] ?? '').trim();
const URL_ = () => env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
const KEY = () => env('SUPABASE_SERVICE_ROLE_KEY');
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const key = KEY();
  const res = await fetch(`${URL_()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      ...(key.startsWith('sb_') ? {} : { authorization: `Bearer ${key}` }),
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

async function config(): Promise<Record<string, string>> {
  const rows: { key: string; value: string }[] = await rest('push_config?select=key,value');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
const setConfig = (key: string, value: string) =>
  rest('push_config?on_conflict=key', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });

async function vapid(cfg: Record<string, string>) {
  if (cfg.vapid_public && cfg.vapid_private) return { publicKey: cfg.vapid_public, privateKey: cfg.vapid_private };
  const k = webpush.generateVAPIDKeys();
  await setConfig('vapid_public', k.publicKey);
  await setConfig('vapid_private', k.privateKey);
  return k;
}

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/** The fields the site's filter needs, from a published_events row. */
function lean(r: any): PublicEvent {
  const lat = num(r.latitude), lng = num(r.longitude);
  const pinned = Number.isFinite(lat) && Number.isFinite(lng);
  const places = (Array.isArray(r.locations) ? r.locations : [])
    .map((p: any) => ({ latitude: num(p?.lat ?? p?.latitude), longitude: num(p?.lng ?? p?.longitude), name: String(p?.name ?? ''), nameEn: String(p?.name_en ?? ''), precision: p?.precision ?? null }))
    .filter((p: any) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  return {
    id: r.id,
    title: r.title ?? '',
    severity: r.severity ?? 'medium',
    latitude: pinned ? lat : 0,
    longitude: pinned ? lng : 0,
    locationName: r.location_name ?? '',
    locationPrecision: pinned ? r.location_precision ?? 'exact' : null,
    country: r.country ?? '',
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    sourceType: r.source_type,
    places,
    occurredAt: r.occurred_at,
    isBreaking: !!r.is_breaking,
    isVerified: !!r.is_verified,
    category: { slug: r.category_slug ?? 'other' },
    mediaKinds: Array.isArray(r.media_kinds) ? r.media_kinds : [],
  } as unknown as PublicEvent;
}

/** Log for the operator: Vercel logs + push_config row "<what>" (last event id). */
async function note(what: string, eventId: string) {
  console.warn('push note', what, eventId);
  try { await setConfig(`note:${what}`.slice(0, 120), String(eventId)); } catch { /* logging only */ }
}

async function send(): Promise<Record<string, unknown>> {
  const cfg = await config();
  const keys = await vapid(cfg);
  webpush.setVapidDetails('mailto:osintfront@gmail.com', keys.publicKey, keys.privateKey);
  const since = cfg.cursor || new Date(Date.now() - 5 * 60_000).toISOString();
  const cols = 'id,title,severity,latitude,longitude,location_name,location_name_he,location_name_en,location_precision,locations,country,source_name,source_url,source_type,occurred_at,published_at,is_breaking,is_verified,translations,category_slug,category_name,media_kinds';
  const events: any[] = await rest(`published_events?select=${cols}&published_at=gt.${encodeURIComponent(since)}&order=published_at.asc&limit=60`);
  if (!events.length) return { events: 0 };
  await setConfig('cursor', events[events.length - 1].published_at);

  const subs: any[] = await rest('push_subscriptions?select=id,user_id,endpoint,p256dh,auth,filters,muted,lang,min_severity');
  const ids = [...new Set(subs.map((s) => s.user_id))];
  const active = new Set<string>(
    ids.length ? (await rest(`profiles?select=id&status=eq.active&id=in.(${ids.join(',')})`)).map((p: any) => p.id) : [],
  );
  // A picture for the notification (Android / desktop show it; iOS does not): only our own public storage.
  const imgPrefix = `${URL_()}/storage/v1/object/public/event-media/`;
  const images = new Map<string, string>();
  try {
    const media: any[] = await rest(`event_media?select=event_id,public_url&ready=is.true&kind=in.(image,video_thumb)&event_id=in.(${events.map((e) => e.id).join(',')})&order=created_at.asc`);
    for (const m of media) if (!images.has(m.event_id) && typeof m.public_url === 'string' && m.public_url.startsWith(imgPrefix)) images.set(m.event_id, m.public_url);
  } catch (e) {
    console.warn('push images skipped', (e as Error).message); // never block the notification
  }
  // Hebrew text once per event; report categories without a Hebrew name and events without severity.
  const leanEvents = events.map((r) => {
    const issues: FormatIssues = {};
    const msg = { ...formatPush(r, issues), ...(images.has(r.id) ? { image: images.get(r.id) } : {}) };
    const sev = severityOf(r);
    if (issues.missingCategory) void note(`missing_category:${issues.missingCategory}`, r.id);
    if (sev.missing) void note('missing_severity', r.id);
    return { r, e: lean(r), msg, rank: sev.rank };
  });
  let sent = 0, removed = 0;
  await Promise.allSettled(subs.filter((s) => active.has(s.user_id)).map(async (s) => {
    const muted = new Set<string>(s.muted ?? []);
    const f: EventFilters | null = s.filters ? { ...EMPTY_FILTERS, ...s.filters, preset: 'live' } : null;
    const min = SEVERITY_RANK[s.min_severity] ?? SEVERITY_RANK.high;
    const hits = leanEvents.filter(({ r, e, rank }) => rank >= min && !muted.has(r.category_slug) && (!f || matchesFilters(e, f)));
    if (!hits.length) return;
    // One notification per event (tag = event: an update replaces it); a flood → the first 5 + one summary.
    const payload = hits.slice(0, 5).map((h) => h.msg);
    if (hits.length > 5) payload.push({ title: `\u200F📰 עוד ${hits.length - 5} ידיעות חדשות`, body: '\u200Fפתחו את המפה לכל הידיעות', url: '/', tag: 'ev-more' });
    for (const p of payload) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(p), { TTL: 3600, urgency: 'high' });
        sent++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' });
          removed++;
          return;
        }
        console.warn('push failed', e?.statusCode, String(e?.body ?? e?.message ?? '').slice(0, 160));
      }
    }
    await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'PATCH', body: JSON.stringify({ last_sent_at: new Date().toISOString() }) });
  }));
  return { events: events.length, subscribers: subs.length, sent, removed };
}

export async function GET() {
  try {
    return json({ publicKey: (await vapid(await config())).publicKey });
  } catch (e) {
    console.error('vapid', (e as Error).message);
    return json({ error: 'not configured' }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const cfg = await config();
    if (!safeEqual(req.headers.get('x-push-secret') ?? '', cfg.secret ?? '')) return json({ error: 'unauthorized' }, 401);
    return json({ ok: true, ...(await send()) });
  } catch (e) {
    console.error('push', (e as Error).message);
    return json({ error: 'failed' }, 500);
  }
}
