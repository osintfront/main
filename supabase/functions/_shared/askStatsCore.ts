// Statistics dashboard — the counting engine (pure; unit-tested in tests/ask/statsMerge.test.ts and
// tests/ask/statsCompute.test.ts). The model only classifies events; everything counted is counted here.
// Spec: docs/superpowers/specs/2026-11-14-ask-map-dashboard-design.md
import { family } from "./dedupeMatch.ts";
import { narrowPlaceKeys } from "./samePlace.ts";
import type { Lang } from "./askStatsInput.ts";

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
