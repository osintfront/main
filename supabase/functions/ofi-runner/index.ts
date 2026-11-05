// supabase/functions/ofi-runner/index.ts — OFI Insights data collection (phase 2).
//
// POST {"action":"collect", "slug"?: string, "scope"?: "all" | "internal" | "external"}
//   Reads every enabled signal of the active insight events (or one event), writes one reading per
//   signal, and records failures on the signal (last_error) so it goes stale. No forecast yet —
//   the probability engine and the schedule come in phase 3.
// POST {"action":"polymarket_search", "q": "iran"} — candidate markets for the admin page.
//
// Who may call it: pg_cron (header x-cron-secret = intel_config.cron_secret) or the super admin
// (Authorization: Bearer <session token>). Deployed with verify_jwt = false; checks are done here.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import { INTERNAL_SOURCES, readSignal, RunContext, type PrevReading, type SignalRow } from '../_shared/ofi/adapters.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const db = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function safeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function authorized(req: Request): Promise<'cron' | 'admin' | null> {
  const secret = req.headers.get('x-cron-secret') ?? '';
  if (secret) {
    const { data } = await db.from('intel_config').select('value').eq('key', 'cron_secret').maybeSingle();
    if (typeof data?.value === 'string' && safeEqual(secret, data.value)) return 'cron';
  }
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!anon) return null;
  const asUser = createClient(URL_, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await asUser.rpc('is_super_admin');
  return data === true ? 'admin' : null;
}

async function collect(slug: string | undefined, scope: string) {
  let q = db.from('insight_events').select('id,slug,status');
  q = slug ? q.eq('slug', slug) : q.eq('status', 'active');
  const { data: events, error } = await q;
  if (error) throw error;
  const out: any[] = [];
  for (const ev of events ?? []) {
    const { data: signals, error: e2 } = await db.from('insight_signals')
      .select('id,key,source_type,normalization,config,stale_after_hours')
      .eq('event_id', ev.id).eq('enabled', true).order('key');
    if (e2) throw e2;
    const ctx = new RunContext(db, ev.id);
    const results: any[] = [];
    const wanted = (signals ?? []).filter((s: SignalRow) =>
      scope === 'all' || (scope === 'internal') === INTERNAL_SOURCES.has(s.source_type));
    for (const s of wanted as SignalRow[]) {
      const { data: prev } = await db.from('insight_signal_readings')
        .select('ts,raw_value,normalized_score,metadata').eq('signal_id', s.id)
        .order('ts', { ascending: false }).limit(50);
      try {
        const r = await readSignal(ctx, s, (prev ?? []) as PrevReading[]);
        const score = Math.round(r.score * 1e6) / 1e6;
        const { error: e3 } = await db.from('insight_signal_readings').insert({
          signal_id: s.id, raw_value: r.raw_value, normalized_score: score, metadata: r.metadata,
        });
        if (e3) throw e3;
        await db.from('insight_signals').update({ last_updated: new Date().toISOString(), last_error: null }).eq('id', s.id);
        results.push({ key: s.key, ok: true, score, raw: r.raw_value });
      } catch (err) {
        const msg = String((err as Error)?.message ?? err).slice(0, 300);
        await db.from('insight_signals').update({ last_error: msg }).eq('id', s.id);
        results.push({ key: s.key, ok: false, error: msg });
      }
    }
    out.push({ slug: ev.slug, signals: results });
  }
  return out;
}

async function polymarketSearch(q: string) {
  const res = await fetch(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=20`, {
    headers: { 'User-Agent': 'Osintfront-OFI/1.0 (+https://osintfront.com)' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`polymarket search: HTTP ${res.status}`);
  const body = await res.json();
  const markets: any[] = [];
  for (const e of body?.events ?? []) {
    for (const m of e?.markets ?? []) {
      if (m?.closed) continue;
      markets.push({ slug: m.slug, question: m.question, end_date: m.endDate, prices: m.outcomePrices, event: e.title });
    }
  }
  return markets.slice(0, 40);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const who = await authorized(req);
  if (!who) return json({ error: 'unauthorized' }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  try {
    if (body.action === 'collect') {
      const scope = ['all', 'internal', 'external'].includes(body.scope) ? body.scope : 'all';
      return json({ ok: true, by: who, results: await collect(typeof body.slug === 'string' ? body.slug : undefined, scope) });
    }
    if (body.action === 'polymarket_search' && who === 'admin') {
      return json({ ok: true, markets: await polymarketSearch(String(body.q ?? 'iran').slice(0, 80)) });
    }
    return json({ error: 'unknown action' }, 400);
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err).slice(0, 300) }, 500);
  }
});
