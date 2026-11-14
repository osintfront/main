// Statistics dashboard in "Ask the map" — the browser's pure rules (no `@/` imports, unit-tested in
// tests/ask/askStatsClient.test.ts). The result shape is the server's (supabase/functions/_shared/
// askStatsCore.ts DashResult), declared again here: src cannot import the edge functions.
// Spec: docs/superpowers/specs/2026-11-14-ask-map-dashboard-design.md

export type Unit = 'hour' | 'day' | 'week';
export type Preset = '24h' | '48h' | '7d' | '30d';
export interface DashIncident { n: number; at: string; place: string; lat: number | null; lng: number | null; title: string; ids: string[]; reports: number }
export interface DashResult {
  v: 1;
  lang: 'he' | 'en';
  title: string;
  generated_at: string;
  metric: { subject: string; actor: string | null; target: string | null; target_country: string | null };
  period: { since: string; until: string; preset: Preset | null; unit: Unit };
  totals: { incidents: number; reports: number; classified: number; unclear: number; previous: number | null; change_pct: number | null; night_pct: number | null };
  buckets: { start: string; count: number; prev: number | null; incidents: number[] }[];
  peak: { index: number; count: number } | null;
  places: { name: string; count: number; share: number; reports: number; lat: number | null; lng: number | null; incidents: number[]; other: boolean }[];
  incidents: DashIncident[];
  insights: string[];
}

export const PRESETS: Preset[] = ['24h', '48h', '7d', '30d'];
export const DASH_CREDITS = 3;
export const CLARIFY_MAX = 40;
export const PREPARED_MAX = 60;
export const POLL_MS = 1500;
export const MAX_POLLS = 600;

/** Stop polling a build: three failed requests in a row (one network blip is not a failure), or 15 minutes. */
export function pollGivesUp(errorsInRow: number, polls: number): boolean {
  return errorsInRow >= 3 || polls > MAX_POLLS;
}

export type DashStage = 'finding' | 'classifying' | 'merging' | 'insights';
export interface DashProgress { done: number; total: number }
export interface DashState {
  id: string;
  status: 'running' | 'done' | 'failed';
  stage: DashStage;
  progress: DashProgress | null;
  result: DashResult | null;
  cached: boolean;
  /** A period chip's build, running while the old result stays on screen. */
  rebuild: { id: string; preset: Preset; stage: DashStage; progress: DashProgress | null } | null;
  note: 'failed' | 'quota' | 'too_many' | 'busy' | null;
}
export interface StatusPayload { status: DashState['status']; stage: DashStage; progress: DashProgress | null; result: DashResult | null; cached: boolean }

/** One poll answer applied to the dashboard (its own build or a period rebuild); other ids change nothing. */
export function applyStatus(d: DashState, pollId: string, s: StatusPayload): DashState {
  if (d.rebuild && pollId === d.rebuild.id) {
    if (s.status === 'done' && s.result) return { ...d, id: pollId, status: 'done', result: s.result, cached: s.cached, rebuild: null, note: null };
    if (s.status === 'failed') return { ...d, rebuild: null, note: 'failed' };
    return { ...d, rebuild: { ...d.rebuild, stage: s.stage, progress: s.progress } };
  }
  if (pollId !== d.id) return d;
  return { ...d, status: s.status, stage: s.stage, progress: s.progress, result: s.status === 'done' ? s.result : d.result, cached: s.cached };
}

/** Is this message the answer to the map's clarifying question? (a chip, or a short typed reply) */
export function clarifyReplyKind(prevMode: string | undefined, text: string, chip?: 'dashboard' | 'text'): 'dashboard' | 'text' | 'typed' | null {
  if (prevMode !== 'clarify_stats') return null;
  if (chip) return chip;
  return text.trim().length <= CLARIFY_MAX ? 'typed' : null;
}

export function showsEvents(mode: string): boolean {
  return mode === 'answer' || mode === 'summary';
}

/** Whole credits left today; null when nothing limits the user. */
export function creditsLeft(q: { enabled: boolean; staff: boolean; limit: number | null; used: number } | null): number | null {
  if (!q || !q.enabled || q.staff || q.limit == null) return null;
  return Math.max(0, Math.floor(q.limit - q.used));
}

const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export function fmtNum(n: number): string {
  return NUM.format(n);
}

export function changeText(pct: number | null, none: string): string {
  if (pct == null) return none;
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

const IL = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', numberingSystem: 'latn', hourCycle: 'h23', ...o });
const DAY = IL({ day: '2-digit', month: '2-digit' });
const HOUR = IL({ hour: '2-digit' });
const DATE = IL({ day: '2-digit', month: '2-digit', year: 'numeric' });

export function bucketLabel(start: string, unit: Unit): string {
  return unit === 'hour' ? `${HOUR.format(new Date(start))}:00` : DAY.format(new Date(start));
}

export function periodDates(since: string, until: string): string {
  return `${DATE.format(new Date(since))} – ${DATE.format(new Date(until))}`;
}

/** The dashboard as one line of conversation history (follow-up questions may refer to it). */
export function historyLine(r: DashResult, l: { dashboard: string; incidents: string }): string {
  return `${l.dashboard}: ${r.title} — ${fmtNum(r.totals.incidents)} ${l.incidents}, ${periodDates(r.period.since, r.period.until)}`;
}

export function withDashLines<T extends { mode: string; answer: string; dashboard?: DashState }>(turns: T[], l: { dashboard: string; incidents: string }): T[] {
  return turns.map((t) => (t.mode === 'stats' && t.dashboard?.result ? { ...t, answer: historyLine(t.dashboard.result, l) } : t));
}

export type DashSelection = { kind: 'all' } | { kind: 'place'; index: number } | { kind: 'bucket'; index: number } | { kind: 'incident'; n: number };

/** The reports behind a press on the dashboard: the incidents chosen, all their events. */
export function selectionEvents(r: DashResult, sel: DashSelection): { ids: string[]; incidents: number; reports: number } {
  let ns: number[];
  if (sel.kind === 'all') ns = r.incidents.map((i) => i.n);
  else if (sel.kind === 'place') ns = r.places[sel.index]?.incidents ?? [];
  else if (sel.kind === 'bucket') ns = r.buckets[sel.index]?.incidents ?? [];
  else ns = [sel.n];
  const chosen = r.incidents.filter((i) => ns.includes(i.n));
  return { ids: chosen.flatMap((i) => i.ids), incidents: chosen.length, reports: chosen.reduce((s, i) => s + i.reports, 0) };
}

/** The header of the events shown on the map: the dashboard's numbers, plus how many could not be loaded. */
export function shownSummary(sel: { ids: string[]; incidents: number; reports: number }, loadedIds: string[]): { incidents: number; reports: number; missing: number } {
  const have = new Set(loadedIds);
  return { incidents: sel.incidents, reports: sel.reports, missing: sel.ids.filter((id) => !have.has(id)).length };
}

/** Touch: the first tap shows the tooltip, a second tap on the same mark acts. Mouse: acts at once. */
export function tapAction(shown: string | null, target: string, pointerType: string): 'tip' | 'act' {
  if (pointerType !== 'touch' && pointerType !== 'pen') return 'act';
  return shown === target ? 'act' : 'tip';
}

export function slugify(title: string): string {
  return title.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

export function exportFileName(title: string, ext: 'pdf' | 'jpg', now: Date = new Date()): string {
  const slug = slugify(title);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return `osintfront-dashboard-${slug ? `${slug}-` : ''}${day}.${ext}`;
}

/** The PDF's sources page: one line per incident, linking its first event. */
export function sourceLines(r: DashResult, siteUrl: string): { n: number; title: string; url: string }[] {
  return r.incidents.map((i) => ({ n: i.n, title: i.title.replace(/\s+/g, ' ').trim(), url: `${siteUrl}/e/${i.ids[0]}` }));
}
