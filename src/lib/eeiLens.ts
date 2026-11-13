import type { PublicEvent } from '@/types/event';
import { eventAreas, eventCategorySlugs } from './eventFilters.ts';
import { compileEei, matchesEei } from './eei.ts';
import { SET_COLORS } from './filterSets.ts';

/**
 * Free-text EEI (צי"ח) in the browser: the user's pasted list becomes theatres (an area + topics);
 * the server's AI marks which topics each event is about. An event shows for a theatre when it is
 * from the last 24 h, in the theatre's area, and has at least one topic: the server's mark when there
 * is one (an empty mark = checked, no topic), otherwise keyword + category rules stand in.
 * Pure rules only — tests/eei/eeiLens.test.ts.
 */

export const EEI_HOURS = 24;

export interface EeiTopic {
  key: string;
  label: string;
  priority: boolean;
  categories: string[];
  query: string;
}

export interface EeiTheatre {
  /** The theatre's fingerprint (hash), or 'exceptional'. */
  id: string;
  hash: string | null;
  kind: 'theatre' | 'exceptional';
  name: string;
  areas: string[];
  topics: EeiTopic[];
}

export interface EeiList {
  theatres: EeiTheatre[];
}

/** What the viewer switched off (kept in this browser). topicsOff items: `${theatre.id}:${topic.key}`. */
export interface EeiView {
  off: string[];
  topicsOff: string[];
  priorityOnly: boolean;
}

export const EMPTY_VIEW: EeiView = { off: [], topicsOff: [], priorityOnly: false };

/** theatre hash → event id → topic keys ([] = checked, no topic fits). */
export type EeiTags = ReadonlyMap<string, ReadonlyMap<string, string[]>>;

export interface TagRow {
  h: string;
  e: string;
  t: string[];
  at: string;
}

/** The one "topic" of the exceptional-events theatre (its label comes from i18n). */
export const EXCEPTIONAL_TOPIC: EeiTopic = { key: 'exceptional', label: '', priority: false, categories: [], query: '' };

const queryCache = new Map<string, ReturnType<typeof compileEei>>();
function compiled(q: string) {
  let c = queryCache.get(q);
  if (c === undefined) {
    c = compileEei(q);
    queryCache.set(q, c);
  }
  return c;
}

/** Keyword + category rules (until the server's mark arrives, or when its budget is used up). */
export function topicFallback(e: PublicEvent, topic: EeiTopic): boolean {
  const hasCats = topic.categories.length > 0;
  const hasQuery = topic.query.trim().length > 0;
  if (!hasCats && !hasQuery) return false;
  if (hasCats && !eventCategorySlugs(e, true).some((s) => topic.categories.includes(s))) return false;
  return !hasQuery || matchesEei(e, compiled(topic.query));
}

function inWindow(e: PublicEvent, now: number): boolean {
  const t = new Date(e.occurredAt).getTime();
  return t >= now - EEI_HOURS * 3600_000 && t <= now + 60_000;
}

function inArea(e: PublicEvent, th: EeiTheatre): boolean {
  if (!th.areas.length) return true;
  const areas = eventAreas(e);
  return th.areas.some((a) => areas.has(a));
}

/** The topics the event shows for in this theatre (empty = not shown). */
export function theatreTopics(e: PublicEvent, th: EeiTheatre, tags: EeiTags, view: EeiView, now = Date.now()): EeiTopic[] {
  if (!inWindow(e, now)) return [];
  if (th.kind === 'exceptional') return e.severity === 'critical' || e.isBreaking ? [EXCEPTIONAL_TOPIC] : [];
  if (!inArea(e, th)) return [];
  const mark = th.hash ? tags.get(th.hash)?.get(e.id) : undefined;
  let out = mark ? th.topics.filter((t) => mark.includes(t.key)) : th.topics.filter((t) => topicFallback(e, t));
  if (view.topicsOff.length) out = out.filter((t) => !view.topicsOff.includes(`${th.id}:${t.key}`));
  if (view.priorityOnly) out = out.filter((t) => t.priority);
  return out;
}

export function theatresOn(list: EeiList | null, view: EeiView): EeiTheatre[] {
  return list ? list.theatres.filter((t) => !view.off.includes(t.id)) : [];
}

export function eeiMatches(e: PublicEvent, on: EeiTheatre[], tags: EeiTags, view: EeiView, now = Date.now()): { theatre: EeiTheatre; topics: EeiTopic[] }[] {
  const out: { theatre: EeiTheatre; topics: EeiTopic[] }[] = [];
  for (const th of on) {
    const topics = theatreTopics(e, th, tags, view, now);
    if (topics.length) out.push({ theatre: th, topics });
  }
  return out;
}

/** Events in a theatre that is on that the AI has not checked yet (each counted once). */
export function waitingCount(events: PublicEvent[], on: EeiTheatre[], tags: EeiTags, now = Date.now()): number {
  const real = on.filter((t) => t.kind === 'theatre' && t.hash);
  let n = 0;
  for (const e of events) {
    if (!inWindow(e, now)) continue;
    if (real.some((th) => inArea(e, th) && !tags.get(th.hash!)?.has(e.id))) n++;
  }
  return n;
}

export function theatreColor(index: number): string {
  return SET_COLORS[((index % SET_COLORS.length) + SET_COLORS.length) % SET_COLORS.length];
}

/** New marks folded in (a later row for the same theatre + event replaces the earlier one). Never mutates. */
export function mergeTags(old: EeiTags, rows: TagRow[]): EeiTags {
  if (!rows.length) return old;
  const out = new Map<string, Map<string, string[]>>();
  old.forEach((m, h) => out.set(h, new Map(m)));
  for (const r of rows) {
    if (!out.has(r.h)) out.set(r.h, new Map());
    out.get(r.h)!.set(r.e, [...r.t]);
  }
  return out;
}

export function lastAt(rows: TagRow[], prev: string | null): string | null {
  let best = prev;
  for (const r of rows) if (!best || r.at > best) best = r.at;
  return best;
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** A list from the server or storage, cleaned; null when unusable. */
export function sanitizeEeiList(raw: unknown): EeiList | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { theatres?: unknown }).theatres)) return null;
  const theatres: EeiTheatre[] = [];
  for (const item of (raw as { theatres: unknown[] }).theatres) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const kind = r.kind === 'exceptional' ? 'exceptional' : 'theatre';
    const hash = typeof r.hash === 'string' && r.hash ? r.hash : null;
    const id = typeof r.id === 'string' && r.id ? r.id : kind === 'exceptional' ? 'exceptional' : hash;
    const name = typeof r.name === 'string' ? r.name : '';
    if (!id || !name) continue;
    const topics: EeiTopic[] = [];
    for (const t of Array.isArray(r.topics) ? r.topics : []) {
      if (!t || typeof t !== 'object') continue;
      const tr = t as Record<string, unknown>;
      if (typeof tr.key !== 'string' || !tr.key || typeof tr.label !== 'string' || !tr.label) continue;
      topics.push({ key: tr.key, label: tr.label, priority: tr.priority === true, categories: strs(tr.categories), query: typeof tr.query === 'string' ? tr.query : '' });
    }
    if (kind === 'theatre' && !topics.length) continue;
    theatres.push({ id, hash: kind === 'theatre' ? hash ?? id : null, kind, name, areas: strs(r.areas), topics });
  }
  return { theatres };
}

export function sanitizeEeiView(raw: unknown): EeiView {
  if (!raw || typeof raw !== 'object') return EMPTY_VIEW;
  const r = raw as Record<string, unknown>;
  return { off: strs(r.off), topicsOff: strs(r.topicsOff), priorityOnly: r.priorityOnly === true };
}
