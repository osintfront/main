// Statistics dashboard in "Ask the map" — the pure request rules (no imports, unit-tested in
// tests/ask/askStatsInput.test.ts): language and clarify reply from the browser, the metric the plan
// step returns, the period, the cache key, the mode a question ends in, who pays the plan call, when
// the 15-minute text cache may answer, the dashboard gate and a dead build.
// Spec: docs/superpowers/specs/2026-11-14-ask-map-dashboard-design.md

export const STATS = { cap: 2000, batch: 40, parallel: 6, credits: 3, cacheMin: 15, staleMin: 5, clarifyMax: 40, defaultDays: 7, maxDays: 90, dailyBuilds: 15 } as const;

export type Lang = "he" | "en";
export type Preset = "24h" | "48h" | "7d" | "30d";
const H = 3600_000;
export const PRESET_MS: Record<Preset, number> = { "24h": 24 * H, "48h": 48 * H, "7d": 7 * 24 * H, "30d": 30 * 24 * H };
export type ClarifyReply = "dashboard" | "text" | "typed" | null;
export type PlanMode = "answer" | "summary" | "stats" | "clarify_stats";

export function cleanLang(v: unknown): Lang | null {
  return v === "he" || v === "en" ? v : null;
}

/** A chip press ("dashboard" / "text"), or a short typed reply to the map's clarifying question. */
export function cleanClarifyReply(v: unknown, question: string): ClarifyReply {
  if (v === "dashboard" || v === "text") return v;
  if (v === "typed") return question.length <= STATS.clarifyMax ? "typed" : null;
  return null;
}

export function cleanPreset(v: unknown): Preset | null {
  return typeof v === "string" && v in PRESET_MS ? (v as Preset) : null;
}

export interface StatsMetric {
  title: string;
  subject: string;
  actor: string | null;
  target: string | null;
  target_country: string | null;
  categories: string[];
  countries: string[];
  places: string[];
  terms: string[];
}

const str = (v: unknown, len: number) => String(v ?? "").trim().slice(0, len);
const opt = (v: unknown, len: number) => str(v, len) || null;
const strs = (v: unknown, max = 20, len = 60) =>
  (Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim().slice(0, len)).filter((x) => x.length >= 2).slice(0, max);

/** The metric the plan step returned, cleaned. null without a title or a subject. */
export function cleanMetric(p: Record<string, unknown>, validSlugs: Set<string>): StatsMetric | null {
  const title = str(p?.title, 80);
  const subject = str(p?.subject, 120);
  if (!title || !subject) return null;
  return {
    title, subject,
    actor: opt(p.actor, 60),
    target: opt(p.target, 60),
    target_country: opt(p.target_country, 40),
    categories: strs(p.categories, 12).filter((s) => validSlugs.has(s)),
    countries: strs(p.countries, 8),
    places: strs(p.places, 20),
    terms: strs(p.terms, 30),
  };
}

export interface Period { since: string; until: string; preset: Preset | null }

/** The plan's window, bounded (≤ 90 days back, never in the future); a span that matches a preset
 *  and ends now is snapped to that preset. No usable start → the last 7 days. */
export function resolvePeriod(since: unknown, until: unknown, nowMs: number): Period {
  let u = Date.parse(String(until ?? ""));
  if (!Number.isFinite(u) || u > nowMs) u = nowMs;
  let s = Date.parse(String(since ?? ""));
  if (!Number.isFinite(s)) s = nowMs - STATS.defaultDays * 24 * H;
  s = Math.max(s, nowMs - STATS.maxDays * 24 * H);
  if (s >= u) u = nowMs;
  if (s >= u) s = u - STATS.defaultDays * 24 * H;
  if (nowMs - u <= 5 * 60_000) {
    for (const p of Object.keys(PRESET_MS) as Preset[]) {
      if (Math.abs((u - s) - PRESET_MS[p]) <= PRESET_MS[p] * 0.02) return { since: new Date(u - PRESET_MS[p]).toISOString(), until: new Date(u).toISOString(), preset: p };
    }
  }
  return { since: new Date(s).toISOString(), until: new Date(u).toISOString(), preset: null };
}

export function presetPeriod(preset: Preset, nowMs: number): Period {
  return { since: new Date(nowMs - PRESET_MS[preset]).toISOString(), until: new Date(nowMs).toISOString(), preset };
}

/** The equal span that ends where this one starts (the comparison). */
export function previousPeriod(p: Period): { since: string; until: string } {
  const s = Date.parse(p.since);
  const span = Date.parse(p.until) - s;
  return { since: new Date(s - span).toISOString(), until: p.since };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Short stable hash (djb2) of a string. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** The dashboard cache key: the words, the language, the period and — so a follow-up in another
 *  conversation ("and how many last week?") never gets someone else's dashboard — the metric built. */
export function statsCacheKey(question: string, p: Period, lang: Lang, metric?: unknown): string {
  const range = p.preset ? `p:${p.preset}` : `r:${new Date(p.since).toISOString().slice(0, 13)}/${new Date(p.until).toISOString().slice(0, 13)}`;
  return `${norm(question)}|${lang}|${range}${metric === undefined ? "" : `|m:${hash(JSON.stringify(metric))}`}`;
}

/** A short typed message after a clarify turn is the reply to it only when the plan step says so
 *  (else it is a new question, charged and cached as one). Chips always are replies. */
export function effectiveClarify(clarify: ClarifyReply, planSaysAnswer: unknown): ClarifyReply {
  if (clarify === "typed") return planSaysAnswer === true ? "typed" : null;
  return clarify;
}

const MODES = new Set<PlanMode>(["answer", "summary", "stats", "clarify_stats"]);

/** The mode a question ends in. Old clients (no lang) never get stats; no plan → text + upgrade
 *  line; a clarify reply decides by itself; a second clarify is never asked. */
export function finalMode(planMode: unknown, o: { client: boolean; canDashboard: boolean; clarify: ClarifyReply; hasMetric: boolean }): { mode: PlanMode; upgradeHint: boolean } {
  let m: PlanMode = MODES.has(planMode as PlanMode) ? (planMode as PlanMode) : "answer";
  if (o.clarify === "dashboard") m = "stats";
  else if (o.clarify === "text" && (m === "stats" || m === "clarify_stats")) m = "answer";
  else if (o.clarify === "typed" && m === "clarify_stats") m = "answer";
  if (m === "stats" || m === "clarify_stats") {
    if (!o.client) return { mode: "answer", upgradeHint: false };
    if (!o.canDashboard) return { mode: "answer", upgradeHint: m === "stats" };
    if (m === "stats" && !o.hasMetric) return { mode: "answer", upgradeHint: false };
  }
  return { mode: m, upgradeHint: false };
}

/** Who the plan call is charged to: nobody for a clarify turn or a clarify reply. */
export function planUsage(mode: PlanMode, clarify: ClarifyReply, uid: string | null): { uid: string | null; purpose: "ask_plan" | "ask_dashboard_plan" } {
  if (clarify || mode === "clarify_stats") return { uid: null, purpose: "ask_plan" };
  return { uid, purpose: mode === "stats" ? "ask_dashboard_plan" : "ask_plan" };
}

/** May a cached text answer (saved with the intent its plan had) answer this caller? */
export function cacheServes(hitIntent: unknown, o: { canDashboard: boolean; clarify: ClarifyReply }): { serve: boolean; upgradeHint: boolean } {
  if (hitIntent === "stats") {
    if (o.clarify === "text") return { serve: true, upgradeHint: false };
    return o.canDashboard ? { serve: false, upgradeHint: false } : { serve: true, upgradeHint: true };
  }
  if (hitIntent === "clarify_stats") return o.canDashboard ? { serve: false, upgradeHint: false } : { serve: true, upgradeHint: false };
  return { serve: true, upgradeHint: false };
}

export type Gate = { ok: true } | { ok: false; status: 409 | 429; error: "busy" | "budget" | "quota_dashboard" | "quota"; needed?: 3; left?: number };

/** One running build per user; then (not staff) at most 15 builds started today — failed and stale
 *  builds cost real model money and charge nothing — and (limits on) the daily budget and 3 credits left. */
export function dashboardGate(
  q: { enabled: boolean; staff: boolean; limit: number | null; used: number; budget_usd: number | null; spent_today_usd: number } | null,
  running: number,
  startedToday = 0,
): Gate {
  if (running > 0) return { ok: false, status: 409, error: "busy" };
  if (q?.staff) return { ok: true };
  if (q && startedToday >= STATS.dailyBuilds) return { ok: false, status: 429, error: "quota" };
  if (!q || !q.enabled) return { ok: true };
  if (q.budget_usd != null && Number(q.spent_today_usd) >= Number(q.budget_usd)) return { ok: false, status: 429, error: "budget" };
  if (q.limit != null && Number(q.limit) - Number(q.used) < STATS.credits) {
    return { ok: false, status: 429, error: "quota_dashboard", needed: 3, left: Math.max(0, Math.floor(Number(q.limit) - Number(q.used))) };
  }
  return { ok: true };
}

/** A running build with no sign of life (heartbeat, else its start) for 5 minutes is dead. */
export function staleBuild(row: { status: string; created_at: string; heartbeat_at?: string | null } | null, nowMs: number): boolean {
  return !!row && row.status === "running" && nowMs - Date.parse(row.heartbeat_at || row.created_at) > STATS.staleMin * 60_000;
}
