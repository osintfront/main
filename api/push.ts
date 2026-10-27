/// <reference types="node" />
// Push notifications for new events, by each subscriber's own site filters.
//
// GET  /api/push                → { publicKey }  (VAPID public key; the key pair is made once and kept in push_config)
// POST /api/push (x-push-secret) → sends notifications for events published since the last run.
//      Called every minute by pg_cron, only when there are new events.
import webpush from 'web-push';
import { EMPTY_FILTERS, matchesFilters, type EventFilters } from '../src/lib/eventFilters.js';
import type { PublicEvent } from '../src/types/event.js';

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

function message(r: any, lang: string) {
  const en = lang === 'en' ? r.translations?.en : null;
  const title = String(en?.title || r.title || '').slice(0, 120);
  const place = (lang === 'en' ? r.location_name_en : r.location_name_he) || r.location_name || r.country || '';
  return {
    title: `${r.is_breaking ? '🔴 ' : ''}${title}`,
    body: [place, lang === 'en' ? r.category_slug : r.category_name].filter(Boolean).join(' · ').slice(0, 160),
    url: `/?event=${encodeURIComponent(r.id)}`,
    tag: `ev-${r.id}`,
  };
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

  const subs: any[] = await rest('push_subscriptions?select=id,user_id,endpoint,p256dh,auth,filters,muted,lang');
  const ids = [...new Set(subs.map((s) => s.user_id))];
  const active = new Set<string>(
    ids.length ? (await rest(`profiles?select=id&status=eq.active&id=in.(${ids.join(',')})`)).map((p: any) => p.id) : [],
  );
  const leanEvents = events.map((r) => ({ r, e: lean(r) }));
  let sent = 0, removed = 0;
  await Promise.allSettled(subs.filter((s) => active.has(s.user_id)).map(async (s) => {
    const muted = new Set<string>(s.muted ?? []);
    const f: EventFilters | null = s.filters ? { ...EMPTY_FILTERS, ...s.filters, preset: 'live' } : null;
    const hits = leanEvents.filter(({ r, e }) => !muted.has(r.category_slug) && (!f || matchesFilters(e, f)));
    if (!hits.length) return;
    const he = s.lang !== 'en';
    const payload = hits.length <= 3
      ? hits.map(({ r }) => message(r, s.lang))
      : [{ title: he ? `${hits.length} ידיעות חדשות` : `${hits.length} new reports`, body: hits.slice(0, 3).map(({ r }) => message(r, s.lang).title).join(' · ').slice(0, 180), url: '/', tag: 'ev-batch' }];
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
