/// <reference types="node" />
// POST /api/ofi-alerts (x-push-secret) — delivers queued OFI threshold alerts.
// Woken by public.ofi_queue_alerts() right after the OFI runner stores an estimate that trips an alert.
// Each queued alert goes to every push device of that user (same VAPID keys as /api/push) and, for Max
// users who set one, to their webhook URL. Every message carries the short disclaimer.
import webpush from 'web-push';

const env = (k: string) => (process.env[k] ?? '').trim();
const URL_ = () => env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
const KEY = () => env('SUPABASE_SERVICE_ROLE_KEY');
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const key = KEY();
  const res = await fetch(`${URL_()}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, ...(key.startsWith('sb_') ? {} : { authorization: `Bearer ${key}` }), 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const pct = (p: number) => `${(Number(p) * 100).toFixed(1).replace(/\.0$/, '')}%`;
const DISCLAIMER = {
  he: 'ניסיוני: הערכה סטטיסטית בלבד, לא התרעה רשמית. בחירום פעלו לפי פיקוד העורף.',
  en: 'Experimental estimate only, not an official alert. In an emergency follow the Home Front Command.',
};

function message(q: any, lang: 'he' | 'en') {
  const p = pct(q.probability), prev = pct(q.previous);
  const title = lang === 'he' ? `‏🛰 OFI: ${q.title_he}` : `🛰 OFI: ${q.title_en}`;
  const why = lang === 'he'
    ? (q.kind === 'change' ? `ההערכה זזה מ-${prev} ל-${p}` : `ההערכה ${q.kind === 'above' ? 'חצתה כלפי מעלה' : 'ירדה מתחת ל'} ${pct(q.value)}: עכשיו ${p}`)
    : (q.kind === 'change' ? `The estimate moved from ${prev} to ${p}` : `The estimate went ${q.kind === 'above' ? 'above' : 'below'} ${pct(q.value)}: now ${p}`);
  return { title, body: `${lang === 'he' ? '‏' : ''}${why}. ${DISCLAIMER[lang]}`, url: `/insights/${q.event_slug}`, tag: `ofi-${q.event_slug}` };
}

/** Webhook targets: https only, no local or private addresses written as an IP or "localhost". */
function safeWebhook(u: string | null): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return null;
    const h = url.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^[\d.]+$/.test(h) || h.includes(':')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function deliver() {
  const cfg: { key: string; value: string }[] = await rest('push_config?select=key,value');
  const c = Object.fromEntries(cfg.map((r) => [r.key, r.value]));
  if (c.vapid_public && c.vapid_private) webpush.setVapidDetails('mailto:service@osintfront.com', c.vapid_public, c.vapid_private);
  const queue: any[] = await rest('insight_alert_queue?select=*&sent_at=is.null&order=id.asc&limit=500');
  if (!queue.length) return { queued: 0 };
  const users = [...new Set(queue.map((q) => q.user_id))];
  const subs: any[] = users.length
    ? await rest(`push_subscriptions?select=id,user_id,endpoint,p256dh,auth,lang&user_id=in.(${users.join(',')})`)
    : [];
  let pushed = 0, hooks = 0;
  for (const q of queue) {
    let error: string | null = null;
    if (c.vapid_public && c.vapid_private) {
      for (const s of subs.filter((x) => x.user_id === q.user_id)) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(message(q, s.lang === 'en' ? 'en' : 'he')), { TTL: 3600, urgency: 'high' });
          pushed++;
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.statusCode === 410) await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' });
          else error = `push ${e?.statusCode ?? ''}`;
        }
      }
    }
    const hook = safeWebhook(q.webhook_url);
    if (hook) {
      try {
        const res = await fetch(hook, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'user-agent': 'Osintfront-OFI/1.0' },
          body: JSON.stringify({
            insight: q.event_slug, kind: q.kind, threshold: Number(q.value), probability: Number(q.probability),
            previous: q.previous == null ? null : Number(q.previous), url: `https://osintfront.com/insights/${q.event_slug}`,
            disclaimer: DISCLAIMER.en, sent_at: new Date().toISOString(),
          }),
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) hooks++; else error = `webhook ${res.status}`;
      } catch (e) {
        error = `webhook ${(e as Error).message.slice(0, 80)}`;
      }
    }
    await rest(`insight_alert_queue?id=eq.${q.id}`, { method: 'PATCH', body: JSON.stringify({ sent_at: new Date().toISOString(), error }) });
  }
  return { queued: queue.length, pushed, hooks };
}

export async function POST(req: Request) {
  try {
    const rows: { value: string }[] = await rest('push_config?select=value&key=eq.secret');
    if (!safeEqual(req.headers.get('x-push-secret') ?? '', rows[0]?.value ?? '')) return json({ error: 'unauthorized' }, 401);
    return json({ ok: true, ...(await deliver()) });
  } catch (e) {
    console.error('ofi-alerts', (e as Error).message);
    return json({ error: 'failed' }, 500);
  }
}
