import type { PublicEvent } from '@/types/event';

/**
 * One incident reported by several sources sometimes slips past the dedupe agent and is
 * published twice. Both events stay in the feed; on the map, close look-alikes share one pin.
 *
 * Two events look alike when they have the same category, their main pins are within ~2 km,
 * they happened within 3 hours of each other, and their headlines share at least half of
 * their words. Events split from one report (reportGroup) are never grouped, and events with
 * extra places of their own are left out, so no distinct pin is ever lost. The earliest event
 * of a group keeps the pin; the others are hidden from the map only.
 */
export interface LookalikeGroups {
  /** The event whose pin stands for this one (itself when it is not grouped). */
  pinOf(id: string): string;
  /** How many reports a pin stands for (1 when it is not grouped). */
  reports(id: string): number;
  /** Events whose own pin is not drawn. */
  hidden: Set<string>;
}

const NEAR_DEG = 0.02;
const WITHIN_MS = 3 * 3600_000;
const MIN_OVERLAP = 0.5;

function headlineWords(e: PublicEvent): Set<string> {
  const text = (e.translations?.en?.title || e.title || '').toLowerCase();
  return new Set(text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
}

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const all = a.size + b.size - shared;
  return all ? shared / all : 0;
}

export function groupLookalikes(events: PublicEvent[]): LookalikeGroups {
  const eligible = events
    .filter((e) => e.locationPrecision != null && !(e.places?.length) && !e.reportGroup)
    .map((e) => ({ e, t: Date.parse(e.occurredAt), words: headlineWords(e) }))
    .filter((x) => Number.isFinite(x.t) && x.words.size > 0)
    .sort((a, b) => a.t - b.t || a.e.id.localeCompare(b.e.id));

  // Union-find over look-alike pairs; the root is always the earliest event of its group, and
  // every member must also be close to that root (in place and time), so a chain of
  // look-alikes cannot drift a group across a district or a day.
  const parent = new Map<string, string>(eligible.map((x) => [x.e.id, x.e.id]));
  const order = new Map<string, number>(eligible.map((x, i) => [x.e.id, i]));
  const byId = new Map(eligible.map((x) => [x.e.id, x]));
  const closeTo = (p: (typeof eligible)[number], q: (typeof eligible)[number]) =>
    Math.abs(p.t - q.t) <= WITHIN_MS &&
    Math.abs(p.e.latitude - q.e.latitude) < NEAR_DEG && Math.abs(p.e.longitude - q.e.longitude) < NEAR_DEG;
  const find = (id: string): string => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(id, r);
    return r;
  };
  for (let i = 0; i < eligible.length; i++) {
    const a = eligible[i];
    for (let j = i + 1; j < eligible.length; j++) {
      const b = eligible[j];
      if (b.t - a.t > WITHIN_MS) break;
      if (a.e.category.slug !== b.e.category.slug) continue;
      if (Math.abs(a.e.latitude - b.e.latitude) >= NEAR_DEG || Math.abs(a.e.longitude - b.e.longitude) >= NEAR_DEG) continue;
      if (overlap(a.words, b.words) < MIN_OVERLAP) continue;
      const ra = find(a.e.id), rb = find(b.e.id);
      if (ra === rb) continue;
      const [keep, fold] = order.get(ra)! <= order.get(rb)! ? [ra, rb] : [rb, ra];
      // Every member of the folded group must stay close to the surviving root.
      const root = byId.get(keep)!;
      const members = eligible.filter((x) => find(x.e.id) === fold);
      if (!members.every((m) => closeTo(root, m))) continue;
      parent.set(fold, keep);
    }
  }

  const pin = new Map<string, string>();
  const count = new Map<string, number>();
  for (const x of eligible) {
    const root = find(x.e.id);
    count.set(root, (count.get(root) ?? 0) + 1);
    if (root !== x.e.id) pin.set(x.e.id, root);
  }
  return {
    pinOf: (id) => pin.get(id) ?? id,
    reports: (id) => count.get(id) ?? 1,
    hidden: new Set(pin.keys()),
  };
}
