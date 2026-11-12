// supabase/functions/ofi-runner/index.ts — OFI Insights: data collection + probability engine.
//
// POST {"action":"tick"}  (pg_cron, every 15 min; answers 202 at once and works in the background)
//   · an active event whose next_run_at is due → collect every source, compute, schedule the next run;
//   · otherwise, once an hour → collect our own data only (no external call) and, if the circuit
//     breaker fires, publish an extra forecast (trigger = circuit_breaker) at most every 6 h.
// POST {"action":"collect", "slug"?, "scope"?: "all" | "internal" | "external"} — readings only.
// POST {"action":"recompute", "slug"}  (admin "Recompute now") — collect everything + compute.
// POST {"action":"compute", "slug"}    (admin, e.g. after a manual parameter) — compute only.
// POST {"action":"polymarket_search", "q": "iran"} — candidate markets for the admin page.
// POST {"action":"backtest", "slug"}  (admin) — replay the engine over Apr 2024 / Oct 2024 / Jun 2025.
// Page views never reach this function: readers only read stored forecasts.
//
// Who may call it: pg_cron (header x-cron-secret = intel_config.cron_secret) or the super admin
// (Authorization: Bearer <session token>). Deployed with verify_jwt = false; checks are done here.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import { INTERNAL_SOURCES, readSignal, RunContext, type PrevReading, type SignalRow } from '../_shared/ofi/adapters.ts';
import { computeForecast, summaries, type EngineSignal } from '../_shared/ofi/engine.ts';
import { runBacktest } from '../_shared/ofi/backtest.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const HOUR = 3_600_000;

const URL_ = Deno.env.get('SUPABASE_URL')!;
const db = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// The admin page calls this from the browser (supabase.functions.invoke), so it needs CORS.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

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
    // The manual parameter is never collected — only the super admin sets it.
    const wanted = (signals ?? []).filter((s: SignalRow) => s.source_type !== 'manual' &&
      (scope === 'all' || (scope === 'internal') === INTERNAL_SOURCES.has(s.source_type)));
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


/** Run the engine on the latest reading of every enabled signal and (unless dry) store the forecast. */
async function compute(eventId: string, trigger: 'schedule' | 'manual' | 'circuit_breaker', dry = false) {
  const { data: ev, error } = await db.from('insight_events')
    .select('id,slug,base_rate,refresh_interval_hours').eq('id', eventId).single();
  if (error) throw error;
  const { data: sigs, error: e2 } = await db.from('insight_signals')
    .select('id,key,name_he,name_en,source_type,weight,direction,is_circuit_breaker,stale_after_hours')
    .eq('event_id', eventId).eq('enabled', true);
  if (e2) throw e2;
  const now = Date.now();
  const signals: EngineSignal[] = [];
  for (const s of sigs ?? []) {
    const { data: r } = await db.from('insight_signal_readings').select('ts,normalized_score')
      .eq('signal_id', s.id).order('ts', { ascending: false }).limit(1).maybeSingle();
    signals.push({
      key: s.key, name_he: s.name_he, name_en: s.name_en, source_type: s.source_type,
      weight: Number(s.weight), direction: s.direction === -1 ? -1 : 1, is_circuit_breaker: !!s.is_circuit_breaker,
      score: r ? Number(r.normalized_score) : null,
      age_hours: r ? (now - new Date(r.ts).getTime()) / HOUR : null,
      stale_after_hours: s.stale_after_hours,
    });
  }
  const { data: prevRow } = await db.from('insight_forecasts').select('probability,ts,trigger')
    .eq('event_id', eventId).order('ts', { ascending: false }).limit(1).maybeSingle();
  const previous = prevRow ? Number(prevRow.probability) : null;
  const result = computeForecast(Number(ev.base_rate), signals, previous);
  if (dry) return { slug: ev.slug, result, stored: false };
  const text = summaries(result, previous);
  const { data: stored, error: e3 } = await db.from('insight_forecasts').insert({
    event_id: eventId, probability: result.probability, confidence_low: result.confidence_low,
    confidence_high: result.confidence_high, contributions: result.contributions, model_version: result.model_version,
    trigger, summary_he: text.he, summary_en: text.en,
  }).select('id').single();
  if (e3) throw e3;
  // Threshold alerts tripped by this estimate (queued in the DB; /api/ofi-alerts delivers them).
  const { error: e4 } = await db.rpc('ofi_queue_alerts', { p_forecast: stored.id });
  if (e4) console.warn('ofi_queue_alerts', e4.message);
  const upd: Record<string, unknown> = { last_run_at: new Date().toISOString() };
  if (trigger !== 'circuit_breaker') upd.next_run_at = new Date(now + Number(ev.refresh_interval_hours) * HOUR).toISOString();
  await db.from('insight_events').update(upd).eq('id', eventId);
  return { slug: ev.slug, probability: result.probability, breaker: result.breaker, stored: true, trigger };
}

/** The scheduler's work (see the header). */
async function tick() {
  const { data: events } = await db.from('insight_events').select('id,slug,next_run_at').eq('status', 'active');
  const out: unknown[] = [];
  for (const ev of events ?? []) {
    try {
      if (new Date(ev.next_run_at).getTime() <= Date.now()) {
        await collect(ev.slug, 'all');
        out.push(await compute(ev.id, 'schedule'));
        continue;
      }
      const { data: internal } = await db.from('insight_signals').select('last_updated')
        .eq('event_id', ev.id).eq('enabled', true).in('source_type', [...INTERNAL_SOURCES])
        .order('last_updated', { ascending: true, nullsFirst: true }).limit(1).maybeSingle();
      const oldest = internal?.last_updated ? new Date(internal.last_updated).getTime() : 0;
      if (Date.now() - oldest < 55 * 60_000) continue;
      await collect(ev.slug, 'internal');
      const dry = await compute(ev.id, 'circuit_breaker', true) as { result: { breaker: boolean } };
      if (!dry.result.breaker) { out.push({ slug: ev.slug, hourly: 'quiet' }); continue; }
      const { data: recent } = await db.from('insight_forecasts').select('id').eq('event_id', ev.id)
        .eq('trigger', 'circuit_breaker').gte('ts', new Date(Date.now() - 6 * HOUR).toISOString()).limit(1);
      if (recent?.length) { out.push({ slug: ev.slug, hourly: 'breaker (already published)' }); continue; }
      out.push(await compute(ev.id, 'circuit_breaker'));
    } catch (err) {
      out.push({ slug: ev.slug, error: String((err as Error)?.message ?? err).slice(0, 300) });
    }
  }
  return out;
}

async function eventIdBySlug(slug: unknown): Promise<string> {
  if (typeof slug !== 'string') throw new Error('slug required');
  const { data } = await db.from('insight_events').select('id').eq('slug', slug).maybeSingle();
  if (!data) throw new Error('unknown event');
  return data.id;
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const who = await authorized(req);
  if (!who) return json({ error: 'unauthorized' }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  try {
    if (body.action === 'tick') {
      const work = tick().then((r) => console.log('ofi tick', JSON.stringify(r).slice(0, 2000)));
      if (typeof EdgeRuntime !== 'undefined') { EdgeRuntime.waitUntil(work); return json({ ok: true, accepted: true }, 202); }
      await work;
      return json({ ok: true });
    }
    if (body.action === 'recompute' && who === 'admin') {
      const id = await eventIdBySlug(body.slug);
      const collected = await collect(body.slug, 'all');
      return json({ ok: true, collected, forecast: await compute(id, 'manual') });
    }
    if (body.action === 'compute' && who === 'admin') {
      return json({ ok: true, forecast: await compute(await eventIdBySlug(body.slug), 'manual') });
    }
    if (body.action === 'collect') {
      const scope = ['all', 'internal', 'external'].includes(body.scope) ? body.scope : 'all';
      return json({ ok: true, by: who, results: await collect(typeof body.slug === 'string' ? body.slug : undefined, scope) });
    }
    if (body.action === 'backtest') {
      const id = await eventIdBySlug(body.slug);
      const { data: ev } = await db.from('insight_events').select('base_rate').eq('id', id).single();
      const { data: fin } = await db.from('insight_signals').select('key,name_he,name_en,weight,config')
        .eq('event_id', id).eq('source_type', 'finance').eq('enabled', true);
      const result = await runBacktest(Number(ev?.base_rate ?? 0.02), (fin ?? []).map((f: any) => ({
        key: f.key, name_he: f.name_he, name_en: f.name_en, weight: Number(f.weight), symbols: f.config?.symbols ?? [] })));
      await db.from('insight_source_cache').upsert({ key: `backtest:${body.slug}`, fetched_at: new Date().toISOString(), body: result });
      const { rows: _rows, ...summary } = result;
      return json({ ok: true, ...summary });
    }
    if (body.action === 'polymarket_search' && who === 'admin') {
      return json({ ok: true, markets: await polymarketSearch(String(body.q ?? 'iran').slice(0, 80)) });
    }
    return json({ error: 'unknown action' }, 400);
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err).slice(0, 300) }, 500);
  }
});
