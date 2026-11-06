// OFI signal adapters: fetch → normalize → score. Deterministic, no LLM, free public sources only.
// Each external source is fetched at most once per run (shared by every signal that needs it) and
// every response is cached in insight_source_cache; when a fetch fails, a cached copy younger than
// the signal's stale window is used instead (metadata.cached = true). If nothing usable exists the
// adapter throws, the runner records the error and the signal goes stale (the engine reduces its
// weight as it ages).
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  balanceVsBaseline, embassyDepartures, fcdoLevel, hashChangeScore, latestReturnZ, levelChangeScore, marketTo24h,
  ratioScore, shareShift, stateDeptLevel, zToScore,
} from './normalize.ts';

export interface SignalRow {
  id: string;
  key: string;
  source_type: string;
  normalization: Record<string, any>;
  config: Record<string, any>;
  stale_after_hours: number;
}
export interface Reading {
  raw_value: number | null;
  score: number;
  metadata: Record<string, unknown>;
}
export interface PrevReading {
  ts: string;
  raw_value: number | null;
  normalized_score: number;
  metadata: Record<string, any>;
}

const UA = 'Osintfront-OFI/1.0 (+https://osintfront.com)';
const TIMEOUT_MS = 12_000;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Per-run context: one fetch per source, results shared between signals. */
export class RunContext {
  private memo = new Map<string, Promise<any>>();
  constructor(readonly db: SupabaseClient, readonly eventId: string) {}

  once<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.memo.has(key)) this.memo.set(key, load());
    return this.memo.get(key)!;
  }

  /** Fetch (text or JSON), cache the response; on failure fall back to a cached copy ≤ maxAgeH old. */
  fetchCached(key: string, url: string, kind: 'json' | 'text', maxAgeH: number, headers: Record<string, string> = {}) {
    return this.once(`fetch:${key}`, async () => {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const body = kind === 'json' ? JSON.parse(text) : text;
        const hash = await sha256(text);
        await this.db.from('insight_source_cache').upsert({
          key, fetched_at: new Date().toISOString(), content_hash: hash, status: res.status,
          body: kind === 'json' ? body : { text: text.slice(0, 500_000) },
        });
        return { body, hash, cached: false, fetched_at: new Date().toISOString() };
      } catch (err) {
        const { data } = await this.db.from('insight_source_cache').select('body,content_hash,fetched_at').eq('key', key).maybeSingle();
        const age = data ? (Date.now() - new Date(data.fetched_at).getTime()) / 3_600_000 : Infinity;
        if (!data || age > maxAgeH) throw new Error(`${key}: ${(err as Error).message}`);
        const body = kind === 'json' ? data.body : (data.body as any)?.text ?? '';
        return { body, hash: data.content_hash as string, cached: true, fetched_at: data.fetched_at as string };
      }
    });
  }

  /** Counts from our own events + HFC alerts (computed in the database, see ofi_internal_stats). */
  internalStats(): Promise<any> {
    return this.once('internal', async () => {
      const { data, error } = await this.db.rpc('ofi_internal_stats', { p_event: this.eventId });
      if (error) throw new Error(`ofi_internal_stats: ${error.message}`);
      if (!data) throw new Error('ofi_internal_stats: no data');
      return data;
    });
  }
}

// ── A. Our collected events + Home Front Command (no external call) ─────────────────────────
async function internalSignal(ctx: RunContext, s: SignalRow): Promise<Reading> {
  const st = await ctx.internalStats();
  const method = s.normalization?.method;
  if (s.source_type === 'hfc') {
    const h = st.hfc ?? {};
    return {
      raw_value: Number(h.waves_24h ?? 0),
      score: ratioScore(Number(h.waves_24h ?? 0), Number(h.baseline_daily ?? 0)),
      metadata: { waves_24h: h.waves_24h ?? 0, baseline_daily: h.baseline_daily ?? 0, last_alert: h.last_alert ?? null },
    };
  }
  if (s.key === 'internal_volume') {
    return {
      raw_value: Number(st.matched_24h),
      score: ratioScore(Number(st.matched_24h), Number(st.baseline_daily)),
      metadata: { matched_24h: st.matched_24h, baseline_daily: st.baseline_daily, events_24h: st.events_24h },
    };
  }
  if (method === 'share_shift') {
    const n = Number(st.matched_24h), high = Number(st.high_24h), base = Number(st.base_high_share);
    return { raw_value: n ? high / n : null, score: shareShift(high, n, base), metadata: { high_24h: high, matched_24h: n, base_high_share: base } };
  }
  const cats = st.categories ?? {};
  const zero = { w_about: 0, n_about: 0, w_any: 0, n_any: 0, b_w_about: 0, b_n_about: 0, b_w_any: 0, b_n_any: 0 };
  if (method === 'lexicon_balance_vs_baseline') {
    const e = { ...zero, ...cats.escalation }, d = { ...zero, ...cats.de_escalation };
    return {
      raw_value: e.w_about - d.w_about,
      score: balanceVsBaseline(e.w_about, d.w_about, e.b_w_about, d.b_w_about),
      metadata: { escalation: e.w_about, de_escalation: d.w_about, escalation_base: e.b_w_about, de_escalation_base: d.b_w_about },
    };
  }
  if (method === 'ratio_vs_baseline') {
    const cat = (s.config?.categories ?? [])[0];
    if (!cat) throw new Error(`${s.key}: config.categories missing`);
    const c = { ...zero, ...cats[cat] };
    const about = s.config?.require_entity === true;
    const n = about ? c.n_about : c.n_any;
    const b = about ? c.b_n_about : c.b_n_any;
    return { raw_value: n, score: ratioScore(n, b), metadata: { category: cat, count_24h: n, baseline_daily: b, require_entity: about } };
  }
  throw new Error(`${s.key}: unknown method ${method}`);
}

// ── B. Prediction market (Polymarket Gamma, public, no key) ─────────────────────────────────
// config.markets: [{slug, invert}] — invert = the market asks the opposite question (e.g. "ceasefire
// continues through <date>?": the event's probability is 1 − P(yes)). Several markets are fetched in
// one call and combined with the max of their 24 h probabilities (the union of "any of these breaks
// down" is at least as likely as the likeliest one). Legacy config.market_slug = one market, no invert.
async function polymarketSignal(ctx: RunContext, s: SignalRow, prev: PrevReading[]): Promise<Reading> {
  const markets: { slug: string; invert?: boolean }[] = Array.isArray(s.config?.markets) && s.config.markets.length
    ? s.config.markets
    : s.config?.market_slug ? [{ slug: s.config.market_slug, invert: false }] : [];
  if (!markets.length) throw new Error('polymarket: no market chosen (config.markets)');
  // One call. With config.search the public search endpoint is used (it also returns markets that
  // /markets?slug= does not serve, e.g. some US x Iran ones); otherwise /markets?slug=a&slug=b.
  const search = typeof s.config?.search === 'string' && s.config.search.trim() ? s.config.search.trim() : null;
  const url = search
    ? `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(search)}&limit_per_type=50`
    : `https://gamma-api.polymarket.com/markets?${markets.map((m) => `slug=${encodeURIComponent(m.slug)}`).join('&')}`;
  const r = await ctx.fetchCached(search ? `polymarket:search:${search}` : `polymarket:${markets.map((m) => m.slug).join('|')}`, url, 'json', s.stale_after_hours);
  const rows: any[] = search
    ? (r.body?.events ?? []).flatMap((e: any) => e?.markets ?? [])
    : Array.isArray(r.body) ? r.body : [];
  const parts: Record<string, unknown>[] = [];
  for (const want of markets) {
    const m = rows.find((x) => x?.slug === want.slug);
    if (!m) { parts.push({ slug: want.slug, error: 'not found' }); continue; }
    if (m.closed) { parts.push({ slug: want.slug, error: 'closed' }); continue; }
    const outcomes: string[] = typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes ?? [];
    const prices: number[] = (typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices ?? []).map(Number);
    const yes = outcomes.findIndex((o) => String(o).toLowerCase() === 'yes');
    const pYes = prices[yes >= 0 ? yes : 0];
    const p = want.invert ? 1 - pYes : pYes;
    const end = m.endDate ?? m.end_date_iso;
    const hoursLeft = end ? (new Date(end).getTime() - Date.now()) / 3_600_000 : NaN;
    const p24 = marketTo24h(p, hoursLeft);
    parts.push({
      slug: want.slug, question: m.question ?? null, invert: !!want.invert, p_yes: pYes, p_event: p,
      end_date: end, hours_left: Math.round(hoursLeft), p24, expiring_soon: hoursLeft < 72,
    });
  }
  const usable = parts.filter((x) => typeof x.p24 === 'number') as { p24: number; p_event: number }[];
  if (!usable.length) throw new Error(`polymarket: no usable market (${JSON.stringify(parts).slice(0, 200)})`);
  const best = usable.reduce((a, b) => (b.p24 > a.p24 ? b : a));
  const last = prev[0]?.metadata?.p24;
  return {
    raw_value: best.p_event,
    score: best.p24,
    metadata: { p24: best.p24, delta_p24: typeof last === 'number' ? best.p24 - last : null, combine: 'max', markets: parts, cached: r.cached },
  };
}

// ── C. Financial war signals (daily closes; z-score vs. 30-day rolling volatility) ─────────────
const YAHOO: Record<string, string> = { LMT: 'LMT', RTX: 'RTX', NOC: 'NOC', ESLT: 'ESLT', BRENT: 'BZ=F', GOLD: 'GC=F', VIX: '^VIX', USDILS: 'ILS=X' };
const STOOQ: Record<string, string> = { LMT: 'lmt.us', RTX: 'rtx.us', NOC: 'noc.us', ESLT: 'eslt.us', BRENT: 'cb.f', GOLD: 'xauusd', VIX: '^vix', USDILS: 'usdils' };
const ALL_SYMBOLS = Object.keys(YAHOO);

/** Closes for every symbol: Yahoo's spark endpoint (one call for all); per-symbol Stooq CSV as fallback. */
function financeCloses(ctx: RunContext, maxAgeH: number): Promise<{ closes: Record<string, number[]>; source: string; cached: boolean }> {
  return ctx.once('finance', async () => {
    const symbols = ALL_SYMBOLS.map((k) => YAHOO[k]).join(',');
    try {
      const r = await ctx.fetchCached('finance:yahoo-spark',
        `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(symbols)}&range=3mo&interval=1d`, 'json', maxAgeH);
      const closes: Record<string, number[]> = {};
      for (const k of ALL_SYMBOLS) {
        const y = YAHOO[k];
        const a = r.body?.[y];                                                    // flat shape
        const b = r.body?.spark?.result?.find((x: any) => x.symbol === y)?.response?.[0]; // nested shape
        const c = a?.close ?? b?.indicators?.quote?.[0]?.close;
        if (Array.isArray(c) && c.length) closes[k] = c;
      }
      if (Object.keys(closes).length >= 4) return { closes, source: 'yahoo', cached: r.cached };
      throw new Error('yahoo spark: too few symbols');
    } catch (yahooErr) {
      const closes: Record<string, number[]> = {};
      let cached = false;
      for (const k of ALL_SYMBOLS) {
        try {
          const r = await ctx.fetchCached(`finance:stooq:${STOOQ[k]}`, `https://stooq.com/q/d/l/?s=${encodeURIComponent(STOOQ[k])}&i=d`, 'text', maxAgeH);
          const rows = String(r.body).trim().split('\n').slice(1).map((l) => Number(l.split(',')[4])).filter(Number.isFinite);
          if (rows.length) closes[k] = rows.slice(-70);
          cached ||= r.cached;
        } catch { /* this symbol stays missing */ }
      }
      if (!Object.keys(closes).length) throw new Error(`finance: no source available (${(yahooErr as Error).message})`);
      return { closes, source: 'stooq', cached };
    }
  });
}

async function financeSignal(ctx: RunContext, s: SignalRow): Promise<Reading> {
  const { closes, source, cached } = await financeCloses(ctx, s.stale_after_hours);
  const window = Number(s.normalization?.window_days ?? 30);
  const per: Record<string, unknown> = {};
  const zs: number[] = [];
  for (const sym of s.config?.symbols ?? []) {
    const z = closes[sym] ? latestReturnZ(closes[sym], window) : null;
    per[sym] = z === null ? null : Math.round(z * 100) / 100;
    if (z !== null) zs.push(z);
  }
  if (!zs.length) throw new Error(`${s.key}: no usable price history`);
  const z = zs.reduce((a, b) => a + b, 0) / zs.length;
  return { raw_value: z, score: zToScore(z), metadata: { z_by_symbol: per, z_mean: z, source, cached } };
}

// ── D. Official travel advisories (only a change in level scores) ─────────────────────────────
async function advisorySignal(ctx: RunContext, s: SignalRow, prev: PrevReading[]): Promise<Reading> {
  const country = s.config?.country;
  const since = Date.now() - 7 * 24 * 3_600_000;
  const recentLevels = prev.filter((p) => new Date(p.ts).getTime() >= since && Number.isFinite(p.raw_value)).map((p) => Number(p.raw_value));
  if (country === 'US' && s.config?.mode === 'departures') {
    // Same RSS as the US advisory signal (fetched once per run): embassy drawdowns across the region.
    const r = await ctx.fetchCached('advisory:us-state', 'https://travel.state.gov/_res/rss/TAsTWs.xml', 'text', s.stale_after_hours);
    const { total, hits } = embassyDepartures(String(r.body), s.config?.countries ?? []);
    const { delta, score } = levelChangeScore(total, recentLevels);
    return { raw_value: total, score, metadata: { total, delta, hits, cached: r.cached } };
  }
  if (country === 'US') {
    const r = await ctx.fetchCached('advisory:us-state', 'https://travel.state.gov/_res/rss/TAsTWs.xml', 'text', s.stale_after_hours);
    const level = stateDeptLevel(String(r.body), s.config?.match ?? 'Israel');
    if (level === null) throw new Error('advisory_us: Israel item not found in the RSS');
    const { delta, score } = levelChangeScore(level, recentLevels);
    return { raw_value: level, score, metadata: { level, delta, hash: r.hash, cached: r.cached } };
  }
  if (country === 'UK') {
    const r = await ctx.fetchCached('advisory:uk-fcdo', `https://www.gov.uk/api/content/foreign-travel-advice/${s.config?.page ?? 'israel'}`, 'json', s.stale_after_hours);
    const statuses: string[] = r.body?.details?.alert_status ?? [];
    const level = fcdoLevel(statuses);
    const { delta, score } = levelChangeScore(level, recentLevels);
    return { raw_value: level, score, metadata: { level, delta, alert_status: statuses, updated: r.body?.public_updated_at ?? null, cached: r.cached } };
  }
  // Israel NSC: no machine-readable level. Hash the configured page; a change in the last 72 h scores.
  const url = s.config?.url;
  if (!url) throw new Error('advisory_il: no page URL configured (config.url)');
  const r = await ctx.fetchCached(`advisory:il-nsc`, url, 'text', s.stale_after_hours);
  const lastHash = prev[0]?.metadata?.hash;
  const changedAt = lastHash && lastHash !== r.hash ? new Date().toISOString() : prev[0]?.metadata?.changed_at ?? null;
  const recent = !!changedAt && Date.now() - new Date(changedAt).getTime() < 72 * 3_600_000;
  return { raw_value: recent ? 1 : 0, score: hashChangeScore(recent), metadata: { hash: r.hash, changed_at: changedAt, cached: r.cached } };
}

/** Read one signal. Throws when nothing usable is available (the runner marks it stale). */
export function readSignal(ctx: RunContext, s: SignalRow, prev: PrevReading[]): Promise<Reading> {
  switch (s.source_type) {
    case 'internal_events':
    case 'hfc':
    case 'rhetoric':
      return internalSignal(ctx, s);
    case 'polymarket':
      return polymarketSignal(ctx, s, prev);
    case 'finance':
      return financeSignal(ctx, s);
    case 'advisory':
      return advisorySignal(ctx, s, prev);
    default:
      return Promise.reject(new Error(`${s.source_type}: adapter not implemented yet (optional source)`));
  }
}

export const INTERNAL_SOURCES = new Set(['internal_events', 'hfc', 'rhetoric']);
