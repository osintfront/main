// OFI probability engine — pure code, deterministic (same inputs → same output), no LLM, no I/O.
// Shared by the runner (Deno) and the unit tests (Node); the Max scenario explorer can reuse it.
// The full formula is documented in docs/ofi-model.md.
import { clamp01, logit, sigmoid } from './normalize.ts';

export const MODEL_VERSION = 'ofi-1.0';

export interface EngineSignal {
  key: string;
  name_he: string;
  name_en: string;
  source_type: string;
  weight: number;
  direction: 1 | -1;
  is_circuit_breaker: boolean;
  /** Latest normalized score 0..1 (0.5 = neutral); null = never read. */
  score: number | null;
  /** Hours since that reading. */
  age_hours: number | null;
  stale_after_hours: number;
}

export interface EngineParams {
  /** Log-odds per unit of (score − 0.5) per unit weight. */
  k: number;
  /** Weight of the prediction-market anchor when fresh (0..1). */
  alpha: number;
  /** Share of the new estimate when smoothing against the previous one (0..1). */
  smoothing: number;
  min: number;
  max: number;
  /** A circuit-breaker signal "fires" at or above this score. */
  breakerScore: number;
}

export const DEFAULT_PARAMS: EngineParams = { k: 2, alpha: 0.5, smoothing: 0.6, min: 0.01, max: 0.95, breakerScore: 0.75 };

export interface Contribution {
  key: string;
  name_he: string;
  name_en: string;
  source_type: string;
  score: number | null;
  weight: number;
  freshness: number;
  stale: boolean;
  /** Log-odds added by this item. */
  logit: number;
  /** Percentage points added by this item (all items + base = final, exactly). */
  pp: number;
}

export interface EngineResult {
  probability: number;
  confidence_low: number;
  confidence_high: number;
  contributions: Contribution[];
  breaker: boolean;
  model_version: string;
  /** Diagnostics for the admin page. */
  detail: { base_rate: number; alpha_effective: number; smoothed: boolean; stale_share: number; disagreement: number };
}

/** 1 while fresh; then linearly down to 0 at twice the stale window. Never read → 0. */
export function freshness(ageHours: number | null, staleAfter: number): number {
  if (ageHours === null || !Number.isFinite(ageHours)) return 0;
  if (ageHours <= staleAfter) return 1;
  return Math.max(0, 1 - (ageHours - staleAfter) / staleAfter);
}

const MARKET = (s: EngineSignal) => s.source_type === 'polymarket';

export function computeForecast(
  baseRate: number,
  signals: EngineSignal[],
  previous: number | null,
  params: EngineParams = DEFAULT_PARAMS,
): EngineResult {
  const p0 = Math.min(Math.max(baseRate, 0.001), 0.999);
  const L0 = logit(p0);
  // Signals in a fixed order so that floating-point sums are identical run to run.
  const sorted = [...signals].sort((a, b) => a.key.localeCompare(b.key));

  // 1. Weighted log-odds from the ordinary signals.
  const terms = sorted.filter((s) => !MARKET(s)).map((s) => {
    const f = s.score === null ? 0 : freshness(s.age_hours, s.stale_after_hours);
    const term = s.score === null ? 0 : s.direction * s.weight * params.k * (clamp01(s.score) - 0.5) * f;
    return { s, f, term };
  });

  // 2. Circuit breaker: two breaker signals firing, or one firing very strongly (≥ 0.9).
  const firing = terms.filter((t) => t.s.is_circuit_breaker && t.f > 0 && (t.s.score ?? 0) >= params.breakerScore);
  const breaker = firing.length >= 2 || firing.some((t) => (t.s.score ?? 0) >= 0.9);

  // 3. Market anchor, scaled by its freshness.
  const market = sorted.find((s) => MARKET(s) && s.score !== null);
  const fm = market ? freshness(market.age_hours, market.stale_after_hours) : 0;
  const alpha = market ? params.alpha * fm : 0;
  const pm = market ? Math.min(Math.max(market.score!, 0.001), 0.999) : p0;

  // 4. Smoothing against the previous estimate (skipped when the breaker fires).
  const smoothed = previous !== null && !breaker;
  const s = smoothed ? params.smoothing : 1;

  // L = L0 + s(1−α)·Σterm + sα·(logit(pm) − L0) + (1−s)·(logit(prev) − L0)
  const items: { c: number; base: Omit<Contribution, 'logit' | 'pp'> }[] = terms.map((t) => ({
    c: s * (1 - alpha) * t.term,
    base: {
      key: t.s.key, name_he: t.s.name_he, name_en: t.s.name_en, source_type: t.s.source_type,
      score: t.s.score, weight: t.s.weight, freshness: round(t.f, 3), stale: t.f < 1,
    },
  }));
  if (market) {
    items.push({
      c: s * alpha * (logit(pm) - L0),
      base: {
        key: market.key, name_he: market.name_he, name_en: market.name_en, source_type: market.source_type,
        score: market.score, weight: market.weight, freshness: round(fm, 3), stale: fm < 1,
      },
    });
  }
  if (smoothed) {
    const prev = Math.min(Math.max(previous!, 0.001), 0.999);
    items.push({
      c: (1 - s) * (logit(prev) - L0),
      base: { key: 'previous', name_he: 'ההערכה הקודמת', name_en: 'Previous estimate', source_type: 'engine', score: null, weight: 0, freshness: 1, stale: false },
    });
  }

  const sumC = items.reduce((a, i) => a + i.c, 0);
  const L = L0 + sumC;
  const raw = sigmoid(L);
  const probability = Math.min(params.max, Math.max(params.min, raw));

  // 5. Percentage points per item (integrated gradients along the straight path L0 → L: every item
  //    gets c_i × average slope, so the items sum exactly to raw − base). Clamping adds one more item.
  const slope = Math.abs(sumC) < 1e-9 ? p0 * (1 - p0) : (raw - p0) / sumC;
  const contributions: Contribution[] = items.map((i) => ({ ...i.base, logit: round(i.c, 6), pp: round(i.c * slope * 100, 4) }));
  if (probability !== raw) {
    contributions.push({
      key: 'clamp', name_he: 'גבולות 1%–95%', name_en: 'Bounds 1%–95%', source_type: 'engine',
      score: null, weight: 0, freshness: 1, stale: false, logit: 0, pp: round((probability - raw) * 100, 4),
    });
  }
  contributions.sort((a, b) => Math.abs(b.pp) - Math.abs(a.pp) || a.key.localeCompare(b.key));

  // 6. Confidence band in log-odds: wider when signals disagree and when weight is stale.
  const wTotal = terms.reduce((a, t) => a + t.s.weight, 0) || 1;
  const staleShare = terms.reduce((a, t) => a + t.s.weight * (1 - t.f), 0) / wTotal;
  const fresh = terms.filter((t) => t.f > 0 && t.s.score !== null);
  const wFresh = fresh.reduce((a, t) => a + t.s.weight, 0);
  const vals = fresh.map((t) => t.s.direction * (t.s.score! - 0.5) * 2);
  const mean = wFresh ? fresh.reduce((a, t, i) => a + t.s.weight * vals[i], 0) / wFresh : 0;
  const disagreement = wFresh ? Math.sqrt(fresh.reduce((a, t, i) => a + t.s.weight * (vals[i] - mean) ** 2, 0) / wFresh) : 1;
  const hw = 0.3 + 1.2 * staleShare + 0.8 * Math.min(1, disagreement);
  const Lp = logit(probability);

  return {
    probability: round(probability, 6),
    confidence_low: round(sigmoid(Lp - hw), 6),
    confidence_high: round(sigmoid(Lp + hw), 6),
    contributions,
    breaker,
    model_version: MODEL_VERSION,
    detail: { base_rate: p0, alpha_effective: round(alpha, 4), smoothed, stale_share: round(staleShare, 4), disagreement: round(disagreement, 4) },
  };
}

function round(x: number, d: number): number {
  const m = 10 ** d;
  return Math.round(x * m) / m;
}

const pts = (x: number) => Math.abs(Math.round(x * 1000) / 10).toFixed(1).replace(/\.0$/, '');

/** OFI's speech bubble — templates only, no LLM. */
export function summaries(result: EngineResult, previous: number | null): { he: string; en: string } {
  const p = (result.probability * 100).toFixed(1).replace(/\.0$/, '');
  // The biggest factor pushing the same way as the change (any direction for a first estimate).
  const dir = previous === null ? 0 : Math.sign(result.probability - previous);
  const top = result.contributions.find((c) => c.key !== 'previous' && c.key !== 'clamp' && (dir === 0 || Math.sign(c.pp) === dir))
    ?? result.contributions.find((c) => c.key !== 'previous' && c.key !== 'clamp');
  const topHe = top ? top.name_he : '';
  const topEn = top ? top.name_en : '';
  if (previous === null) {
    return {
      he: `הערכה ראשונה: ${p}%. הגורם המשפיע ביותר: ${topHe}.`,
      en: `First estimate: ${p}%. Biggest factor: ${topEn}.`,
    };
  }
  const d = result.probability - previous;
  if (Math.abs(d) < 0.0005) {
    return { he: `ההערכה לא השתנתה מאז העדכון הקודם (${p}%).`, en: `The estimate is unchanged since the last update (${p}%).` };
  }
  const breakerHe = result.breaker ? ' (עדכון חירום)' : '';
  const breakerEn = result.breaker ? ' (circuit-breaker update)' : '';
  return d > 0
    ? { he: `מאז העדכון הקודם ההערכה עלתה ב-${pts(d)} נק' ל-${p}%, בעיקר בגלל ${topHe}${breakerHe}.`,
        en: `Since the last update the estimate rose ${pts(d)} pts to ${p}%, mainly due to ${topEn}${breakerEn}.` }
    : { he: `מאז העדכון הקודם ההערכה ירדה ב-${pts(d)} נק' ל-${p}%, בעיקר בגלל ${topHe}${breakerHe}.`,
        en: `Since the last update the estimate fell ${pts(d)} pts to ${p}%, mainly due to ${topEn}${breakerEn}.` };
}
