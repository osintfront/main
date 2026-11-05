// OFI backtest (phase 6) — replays the engine over past escalation windows with the sources that HAVE
// history: the financial signals (daily closes from Yahoo). Our own event data starts in Oct 2026 and
// advisory/market history is not available for free, so this is a partial check, documented as such.
// Deterministic: the same price history gives the same result.
import { computeForecast, type EngineSignal } from './engine.ts';
import { latestReturnZ, zToScore } from './normalize.ts';

const YAHOO: Record<string, string> = { LMT: 'LMT', RTX: 'RTX', NOC: 'NOC', ESLT: 'ESLT', BRENT: 'BZ=F', GOLD: 'GC=F', VIX: '^VIX', USDILS: 'ILS=X' };

/** Days (UTC) with a direct Israel/US ↔ Iran strike — the "it happened" days for the backtest. */
export const DIRECT_DAYS = new Set([
  '2024-04-13', '2024-04-14', '2024-04-19', '2024-10-01', '2024-10-26',
  '2025-06-13', '2025-06-14', '2025-06-15', '2025-06-16', '2025-06-17', '2025-06-18', '2025-06-19',
  '2025-06-20', '2025-06-21', '2025-06-22', '2025-06-23', '2025-06-24',
]);
export const WINDOWS: [string, string][] = [['2024-03-20', '2024-05-05'], ['2024-09-10', '2024-11-10'], ['2025-05-20', '2025-07-10']];

export interface FinanceSignalDef { key: string; name_he: string; name_en: string; weight: number; symbols: string[] }

type Series = { t: number[]; c: number[] };

async function history(symbol: string, from: number, to: number): Promise<Series> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${from}&period2=${to}&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Osintfront-OFI/1.0 (+https://osintfront.com)' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`yahoo ${symbol}: HTTP ${res.status}`);
  const r = (await res.json())?.chart?.result?.[0];
  const t: number[] = r?.timestamp ?? [];
  const c: number[] = r?.indicators?.quote?.[0]?.close ?? [];
  return { t: t.map((x) => x * 1000), c };
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function runBacktest(baseRate: number, defs: FinanceSignalDef[]) {
  const from = Date.UTC(2024, 0, 1) / 1000, to = Date.UTC(2025, 7, 1) / 1000;
  const series: Record<string, Series> = {};
  for (const [k, y] of Object.entries(YAHOO)) {
    try { series[k] = await history(y, from, to); } catch { /* symbol skipped */ }
  }
  const rows: { day: string; p: number; outcome: 0 | 1 }[] = [];
  for (const [a, b] of WINDOWS) {
    let prev: number | null = null;
    for (let d = Date.parse(`${a}T00:00:00Z`); d <= Date.parse(`${b}T00:00:00Z`); d += 86_400_000) {
      // Forecast for day d made from closes known before d (no look-ahead).
      const signals: EngineSignal[] = defs.map((s) => {
        const zs = s.symbols.flatMap((sym) => {
          const ser = series[sym];
          if (!ser) return [];
          const closes = ser.c.filter((_, i) => ser.t[i] < d);
          const z = latestReturnZ(closes, 30);
          return z === null ? [] : [z];
        });
        const z = zs.length ? zs.reduce((x, y) => x + y, 0) / zs.length : null;
        return { key: s.key, name_he: s.name_he, name_en: s.name_en, source_type: 'finance', weight: s.weight, direction: 1,
          is_circuit_breaker: false, score: z === null ? null : zToScore(z), age_hours: 12, stale_after_hours: 96 };
      });
      const r = computeForecast(baseRate, signals, prev);
      prev = r.probability;
      rows.push({ day: day(d), p: r.probability, outcome: DIRECT_DAYS.has(day(d)) ? 1 : 0 });
    }
  }
  const brier = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + (f(r) - r.outcome) ** 2, 0) / rows.length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    days: rows.length,
    event_days: rows.filter((r) => r.outcome).length,
    symbols_loaded: Object.keys(series),
    brier_model: Math.round(brier((r) => r.p) * 1e5) / 1e5,
    brier_base_rate: Math.round(brier(() => baseRate) * 1e5) / 1e5,
    mean_p_event_days: mean(rows.filter((r) => r.outcome).map((r) => r.p)),
    mean_p_other_days: mean(rows.filter((r) => !r.outcome).map((r) => r.p)),
    note: 'Finance signals only (the only sources with free history before Oct 2026).',
    rows,
  };
}
