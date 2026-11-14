// Statistics dashboard — the counting engine (pure; unit-tested in tests/ask/statsMerge.test.ts and
// tests/ask/statsCompute.test.ts). The model only classifies events; everything counted is counted here.
// Spec: docs/superpowers/specs/2026-11-14-ask-map-dashboard-design.md
import { family } from "./dedupeMatch.ts";
import { narrowPlaceKeys } from "./samePlace.ts";
import type { Lang, Period, StatsMetric } from "./askStatsInput.ts";

export const MERGE = { km: 5, minutes: 60 } as const;

export type Fit = "yes" | "no" | "unsure";

export interface StatsEvent {
  id: string;
  occurred_at: string;
  title: string;
  title_en: string | null;
  description: string | null;
  category_slug: string | null;
  country: string | null;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  location_precision: string | null;
  source_count: number;
}

export interface Classified extends StatsEvent { fits: Fit; actor: string; target: string; place: string; incident: string }

const cut = (v: unknown, len: number) => String(v ?? "").trim().slice(0, len);

/** One row per batch event, in batch order. raw = the tool input { items: [{ n, fits, actor, target,
 *  place, incident }] }, n = 1-based line number. Missing / repeated / unknown → unsure. */
export function cleanClassified(batch: StatsEvent[], raw: unknown): Classified[] {
  const items = Array.isArray((raw as any)?.items) ? (raw as any).items as any[] : [];
  const byLine = new Map<number, any>();
  for (const it of items) {
    const n = Number(it?.n);
    if (Number.isInteger(n) && n >= 1 && n <= batch.length && !byLine.has(n)) byLine.set(n, it);
  }
  return batch.map((e, i) => {
    const it = byLine.get(i + 1);
    const fits: Fit = it?.fits === "yes" || it?.fits === "no" ? it.fits : "unsure";
    return { ...e, fits, actor: cut(it?.actor, 60), target: cut(it?.target, 60), place: cut(it?.place, 80), incident: cut(it?.incident, 160) };
  });
}

/** The event's own report plus the further sources merged into it. */
export function reportCount(sourceCount: number): number {
  return 1 + Math.max(0, Number(sourceCount) || 0);
}

export interface Incident { n: number; at: string; place: string; lat: number | null; lng: number | null; title: string; ids: string[]; reports: number }

const PRECISE = new Set(["exact", "city"]);
const precise = (e: StatsEvent) => e.latitude != null && e.longitude != null && PRECISE.has(String(e.location_precision ?? ""));

function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Same kind, within the hour, no conflicting actors, and the same place (a close precise pin or a
 *  shared town-name key — never a whole country). */
export function sameIncident(a: Classified, b: Classified): boolean {
  if (family(a.category_slug ?? undefined) !== family(b.category_slug ?? undefined)) return false;
  if (Math.abs(Date.parse(a.occurred_at) - Date.parse(b.occurred_at)) > MERGE.minutes * 60_000) return false;
  const aa = a.actor.toLowerCase(), ba = b.actor.toLowerCase();
  if (aa && ba && aa !== ba) return false;
  if (precise(a) && precise(b) && km(a.latitude!, a.longitude!, b.latitude!, b.longitude!) <= MERGE.km) return true;
  const ka = narrowPlaceKeys(a.location_name, a.place);
  const kb = narrowPlaceKeys(b.location_name, b.place);
  return [...ka].some((k) => kb.has(k));
}

const byTime = (a: StatsEvent, b: StatsEvent) => a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** The events that fit, grouped into distinct incidents (no chaining: an event is compared with the
 *  earliest event of each incident). */
export function mergeIncidents(events: Classified[], lang: Lang): Incident[] {
  const groups: Classified[][] = [];
  for (const e of events.filter((x) => x.fits === "yes").sort(byTime)) {
    const g = groups.find((g) => sameIncident(g[0], e));
    if (g) g.push(e); else groups.push([e]);
  }
  return groups.map((g, i) => {
    const first = g[0];
    const pin = g.find(precise) ?? g.find((e) => e.latitude != null && e.longitude != null) ?? null;
    return {
      n: i + 1,
      at: first.occurred_at,
      place: first.place || first.location_name || first.country || "",
      lat: pin?.latitude ?? null,
      lng: pin?.longitude ?? null,
      title: lang === "en" ? (first.title_en || first.title) : first.title,
      ids: g.map((e) => e.id),
      reports: g.reduce((s, e) => s + reportCount(e.source_count), 0),
    };
  });
}

// ── Figures ─────────────────────────────────────────────────────────────────────────────────────

export type Unit = "hour" | "day" | "week";
const HOUR = 3600_000, DAY = 24 * HOUR;

export function bucketUnit(spanMs: number): Unit {
  return spanMs <= 48 * HOUR ? "hour" : spanMs <= 31 * DAY ? "day" : "week";
}

const IL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
/** Israel wall-clock parts of an instant. */
function ilParts(ms: number): { y: number; m: number; d: number; h: number; min: number } {
  const p = Object.fromEntries(IL.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}
/** The instant of an Israel wall-clock midnight (y, m, d may overflow: Date.UTC normalises it). */
function ilMidnight(y: number, m: number, d: number): number {
  const wall = Date.UTC(y, m - 1, d);
  let t = wall - 2 * HOUR;
  for (let i = 0; i < 3; i++) {
    const p = ilParts(t);
    const diff = wall - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    if (!diff) break;
    t += diff;
  }
  return t;
}

/** Bucket starts (ISO), on Israel-time boundaries; the first holds `since`, the last starts before `until`. */
export function bucketStarts(since: string, until: string, unit: Unit): string[] {
  const s = Date.parse(since), u = Date.parse(until);
  const out: string[] = [];
  if (unit === "hour") {
    for (let t = Math.floor(s / HOUR) * HOUR; t < u; t += HOUR) out.push(new Date(t).toISOString());
    return out;
  }
  const p = ilParts(s);
  let d = p.d;
  if (unit === "week") d -= new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  const step = unit === "week" ? 7 : 1;
  for (let t = ilMidnight(p.y, p.m, d); t < u; d += step, t = ilMidnight(p.y, p.m, d)) out.push(new Date(t).toISOString());
  return out;
}

export function pctChange(cur: number, prev: number | null): number | null {
  if (prev == null) return null;
  if (prev > 0) return Math.round(((cur - prev) / prev) * 100);
  return cur === 0 ? 0 : null;
}

export interface DashResult {
  v: 1;
  lang: Lang;
  title: string;
  generated_at: string;
  metric: { subject: string; actor: string | null; target: string | null; target_country: string | null };
  period: { since: string; until: string; preset: "24h" | "48h" | "7d" | "30d" | null; unit: Unit };
  totals: { incidents: number; reports: number; classified: number; unclear: number; previous: number | null; change_pct: number | null; night_pct: number | null };
  buckets: { start: string; count: number; prev: number | null; incidents: number[] }[];
  peak: { index: number; count: number } | null;
  places: { name: string; count: number; share: number; reports: number; lat: number | null; lng: number | null; incidents: number[]; other: boolean }[];
  incidents: Incident[];
  insights: string[];
}
export type Figures = Pick<DashResult, "totals" | "buckets" | "peak" | "places"> & { unit: Unit };

/** Index of the bucket holding an instant (start <= at < next start), or -1 outside. */
function bucketOf(starts: number[], at: number, end: number): number {
  if (at < starts[0] || at >= end) return -1;
  let i = starts.length - 1;
  while (i > 0 && starts[i] > at) i--;
  return i;
}

const round = (x: number) => Math.round(x);

export function computeStats(cur: Incident[], prev: Incident[] | null, period: Period, counts: { classified: number; unclear: number }): Figures {
  const s = Date.parse(period.since), u = Date.parse(period.until), span = u - s;
  const unit = bucketUnit(span);
  const startsIso = bucketStarts(period.since, period.until, unit);
  const starts = startsIso.map(Date.parse);
  const buckets: Figures["buckets"] = startsIso.map((start) => ({ start, count: 0, prev: prev ? 0 : null, incidents: [] }));
  for (const i of cur) {
    const b = bucketOf(starts, Date.parse(i.at), u);
    if (b >= 0) { buckets[b].count++; buckets[b].incidents.push(i.n); }
  }
  for (const i of prev ?? []) {
    const b = bucketOf(starts, Date.parse(i.at) + span, u);
    if (b >= 0) buckets[b].prev = (buckets[b].prev ?? 0) + 1;
  }
  let peak: Figures["peak"] = null;
  buckets.forEach((b, index) => { if (b.count > 0 && (!peak || b.count > peak.count)) peak = { index, count: b.count }; });

  const n = cur.length;
  const night = cur.filter((i) => { const h = ilParts(Date.parse(i.at)).h; return h >= 22 || h < 5; }).length;

  // Hotspots: grouped by the place's first name key, named by its most frequent spelling.
  const groups = new Map<string, Incident[]>();
  for (const i of cur) {
    const key = [...narrowPlaceKeys(i.place)][0] ?? i.place.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const mean = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const entry = (g: Incident[], name: string, other: boolean) => ({
    name, other, count: g.length, share: n ? round((g.length / n) * 100) : 0,
    reports: g.reduce((a, i) => a + i.reports, 0),
    lat: other ? null : mean(g.map((i) => i.lat)), lng: other ? null : mean(g.map((i) => i.lng)),
    incidents: g.map((i) => i.n),
  });
  const named = [...groups.values()].map((g) => {
    const freq = new Map<string, number>();
    for (const i of g) freq.set(i.place, (freq.get(i.place) ?? 0) + 1);
    const name = [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    return entry(g, name, false);
  }).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const rest = named.slice(5);
  const places = named.slice(0, 5);
  if (rest.length) {
    const all = rest.flatMap((p) => cur.filter((i) => p.incidents.includes(i.n)));
    places.push(entry(all, "", true));
  }

  return {
    unit,
    totals: {
      incidents: n,
      reports: cur.reduce((a, i) => a + i.reports, 0),
      classified: counts.classified,
      unclear: counts.unclear,
      previous: prev ? prev.length : null,
      change_pct: pctChange(n, prev ? prev.length : null),
      night_pct: n ? round((night / n) * 100) : null,
    },
    buckets,
    peak,
    places,
  };
}

/** Every number an insight may state (as written, no leading zeros). */
export function allowedNumbers(f: Figures, period: Period): Set<string> {
  const out = new Set<string>(["0"]);
  const add = (x: number | null | undefined) => { if (x != null && Number.isFinite(x)) out.add(String(Math.abs(x))); };
  const t = f.totals;
  [t.incidents, t.reports, t.classified, t.unclear, t.previous, t.change_pct, t.night_pct].forEach(add);
  if (t.previous != null) add(t.incidents - t.previous);
  if (t.night_pct != null) add(100 - t.night_pct);
  for (const b of f.buckets) { add(b.count); add(b.prev); }
  add(f.buckets.length);
  add(f.buckets.filter((b) => b.count > 0).length);
  add(f.peak?.count);
  for (const p of f.places) { add(p.count); add(p.share); add(p.reports); }
  add(f.places.length);
  const span = Date.parse(period.until) - Date.parse(period.since);
  add(round(span / HOUR)); add(round(span / DAY)); add(round(span / (7 * DAY)));
  return out;
}

/** Citations, clock times, dates and years aside, every number in the text is one of the figures. */
export function insightOk(text: string, allowed: Set<string>): boolean {
  const rest = text
    .replace(/\[\d+\]/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b/g, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/%/g, " ");
  for (const m of rest.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const v = String(Number(m[0].replace(",", ".")));
    if (!allowed.has(v)) return false;
  }
  return true;
}

/** The model's bullets: strings, cut, wrong citations removed, numbers checked, at most 5. */
export function cleanInsights(raw: unknown, f: Figures, period: Period): string[] {
  if (!Array.isArray(raw) || f.totals.incidents === 0) return [];
  const allowed = allowedNumbers(f, period);
  const max = f.totals.incidents;
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().slice(0, 300).replace(/\[(\d+)\]/g, (m, n) => (Number(n) >= 1 && Number(n) <= max ? m : "")).replace(/\s{2,}/g, " ").trim())
    .filter((x) => x && insightOk(x, allowed))
    .slice(0, 5);
}

export function buildResult(o: { lang: Lang; title: string; metric: StatsMetric; period: Period; figures: Figures; incidents: Incident[]; insights: string[]; nowIso: string }): DashResult {
  const { unit, ...fig } = o.figures;
  return {
    v: 1,
    lang: o.lang,
    title: o.title,
    generated_at: o.nowIso,
    metric: { subject: o.metric.subject, actor: o.metric.actor, target: o.metric.target, target_country: o.metric.target_country },
    period: { since: o.period.since, until: o.period.until, preset: o.period.preset, unit },
    ...fig,
    incidents: o.incidents,
    insights: o.insights,
  };
}
