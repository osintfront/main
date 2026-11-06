// OFI — pure normalization math (no I/O, no randomness, no LLM). Every function maps raw inputs to a
// score in 0..1 where 0.5 means "no evidence either way" (it adds nothing to the log-odds).
// Same inputs → same output. Shared by the runner (Deno) and the unit tests (Node).

export const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5);
export const logit = (p: number): number => Math.log(p / (1 - p));
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * A count in the last 24 h against its daily average over the 7 days before.
 * r = (count + 1) / (baseline + 1) — the +1 keeps quiet days from swinging wildly;
 * score = r / (1 + r): 0.5 when equal, → 1 as activity rises, → 0 as it falls.
 */
export function ratioScore(count: number, baselineDaily: number): number {
  const r = (Math.max(0, count) + 1) / (Math.max(0, baselineDaily) + 1);
  return clamp01(r / (1 + r));
}

/**
 * Escalation vs. de-escalation wording today, against the same balance over the baseline.
 * balance = (E + 1) / (E + D + 2); score = sigmoid(logit(balance_today) − logit(balance_baseline)).
 */
export function balanceVsBaseline(e: number, d: number, eBase: number, dBase: number): number {
  const today = (Math.max(0, e) + 1) / (Math.max(0, e) + Math.max(0, d) + 2);
  const base = (Math.max(0, eBase) + 1) / (Math.max(0, eBase) + Math.max(0, dBase) + 2);
  return clamp01(sigmoid(logit(today) - logit(base)));
}

/**
 * Share of high/critical events today vs. the baseline share. The share is pulled toward the baseline
 * by 2 pseudo-events so a handful of events cannot swing it: share = (high + 2·base) / (n + 2).
 * score = 0.5 + (share − base).
 */
export function shareShift(high: number, n: number, baseShare: number): number {
  if (!(n > 0)) return 0.5;
  const share = (Math.max(0, high) + 2 * baseShare) / (n + 2);
  return clamp01(0.5 + (share - baseShare));
}

/** Daily log returns of a close series (oldest → newest); gaps (null / ≤ 0) are skipped. */
export function logReturns(closes: (number | null | undefined)[]): number[] {
  const xs = closes.filter((c): c is number => typeof c === 'number' && Number.isFinite(c) && c > 0);
  const out: number[] = [];
  for (let i = 1; i < xs.length; i++) out.push(Math.log(xs[i] / xs[i - 1]));
  return out;
}

/**
 * z-score of the latest daily return against the previous `window` returns (rolling volatility),
 * not the raw price. null when there is too little history (fewer than 10 returns).
 */
export function latestReturnZ(closes: (number | null | undefined)[], window = 30): number | null {
  const r = logReturns(closes);
  if (r.length < 11) return null;
  const last = r[r.length - 1];
  const hist = r.slice(Math.max(0, r.length - 1 - window), r.length - 1);
  const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
  const variance = hist.reduce((a, b) => a + (b - mean) ** 2, 0) / (hist.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return null;
  return (last - mean) / sd;
}

/** z → 0..1: 0.5 + 0.5·tanh(z / 2) (z = 2 → 0.88, z = −2 → 0.12). */
export const zToScore = (z: number): number => clamp01(0.5 + 0.5 * Math.tanh(z / 2));

/**
 * Travel-advisory level now vs. the levels seen in the last 7 days. A rise (or fall) of one level
 * moves the score by 0.2 from neutral; unchanged → 0.5. Only changes count, never the level itself.
 */
export function levelChangeScore(current: number, recentLevels: number[]): { delta: number; score: number } {
  const all = [...recentLevels.filter(Number.isFinite), current];
  const up = current - Math.min(...all);
  const down = current - Math.max(...all);
  const delta = up > 0 ? up : down < 0 ? down : 0;
  return { delta, score: clamp01(0.5 + 0.2 * delta) };
}

/** A page whose level cannot be parsed: a content change in the last 72 h → 0.6, else neutral. */
export const hashChangeScore = (changedRecently: boolean): number => (changedRecently ? 0.6 : 0.5);

/**
 * A prediction-market probability for "by <end date>" mapped to the next 24 h, assuming a constant
 * hazard over the market's remaining time: p24 = 1 − (1 − P)^(24 / H), H = hours left (≥ 24).
 * A market ending within 24 h is already a ≤ 24 h question: p24 = P.
 */
export function marketTo24h(p: number, hoursLeft: number): number | null {
  if (!(p >= 0 && p <= 1) || !(hoursLeft > 0)) return null;
  const h = Math.max(hoursLeft, 24);
  return clamp01(1 - Math.pow(1 - p, 24 / h));
}

/** UK FCDO alert_status values → level 1..4 (highest wins). */
export function fcdoLevel(statuses: string[]): number {
  const rank: Record<string, number> = {
    avoid_all_travel_to_whole_country: 4,
    avoid_all_travel_to_parts: 3,
    avoid_all_but_essential_travel_to_whole_country: 3,
    avoid_all_but_essential_travel_to_parts: 2,
  };
  return Math.max(1, ...statuses.map((s) => rank[s] ?? 1));
}

/**
 * Embassy staff drawdowns in the US State Dept advisories RSS for the given countries:
 * "ordered departure" (staff must leave) = 2, "authorized departure" (may leave) = 1, embassy
 * "suspended operations" = 2. Returns the total and which countries carry what.
 */
export function embassyDepartures(rss: string, countries: string[]): { total: number; hits: { country: string; kind: string }[] } {
  const items = rss.split(/<item>/i).slice(1);
  const hits: { country: string; kind: string }[] = [];
  let total = 0;
  for (const it of items) {
    const title = (it.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim().toLowerCase();
    const country = countries.find((c) => title.startsWith(c.toLowerCase()));
    if (!country) continue;
    const text = it.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    let kind: string | null = null;
    let w = 0;
    if (/ordered (the )?departure/.test(text)) { kind = 'ordered'; w = 2; }
    else if (/suspended (routine |all )?(embassy |consular )?operations/.test(text)) { kind = 'suspended'; w = 2; }
    else if (/authorized (the )?departure/.test(text)) { kind = 'authorized'; w = 1; }
    if (kind) { hits.push({ country, kind }); total += w; }
  }
  return { total, hits };
}

/** US State Dept RSS: the "Level N" of the item whose title starts with `country`. */
export function stateDeptLevel(rss: string, country: string): number | null {
  const titles = [...rss.matchAll(/<title>([\s\S]*?)<\/title>/gi)].map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim());
  const hit = titles.find((t) => t.toLowerCase().startsWith(country.toLowerCase()));
  const m = hit?.match(/Level\s*([1-4])/i);
  return m ? Number(m[1]) : null;
}
