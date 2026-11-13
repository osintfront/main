// Quick compose (shared by the report form and the map's quick report): the editor agent's
// result → report form fields, and a report with places of several kinds → one event per kind.
import type { ComposeResult } from '@/services/composeService';
import type { EventCategory } from '@/types/category';
import type { EventInput, PlaceInput } from '@/types/event';

// The secondary-type rules of supabase/functions/_shared/secondaryCats.ts (the browser must not
// import from there); tests/categories/quickReport.test.ts keeps both sides equal.
const MAX_SECONDARY = 2;
const NEVER_SECONDARY = ['home-front-alerts', 'other', 'uncategorized'];
const STICKY_MAIN = ['killed', 'wounded', 'assassination'];

function singleKind(a: { own: string; secondary: string[]; kind: string }): { secondary: string[] } {
  const room = a.secondary.length < MAX_SECONDARY && !a.secondary.includes(a.kind) && !NEVER_SECONDARY.includes(a.kind);
  return { secondary: room ? [...a.secondary, a.kind] : [...a.secondary] };
}

function afterSplit(a: { own: string | null; secondary: string[]; groups: string[] }) {
  const keepSlug = a.own && a.groups.includes(a.own) ? a.own : a.groups[0];
  const rest = a.secondary.filter((s) => !a.groups.includes(s));
  if (a.own && STICKY_MAIN.includes(a.own) && !a.groups.includes(a.own)) {
    const own = a.own;
    return { keepSlug, main: own, secondary: [keepSlug, ...rest.filter((s) => s !== keepSlug && s !== own)].slice(0, MAX_SECONDARY), relabelPlaces: true };
  }
  return { keepSlug, main: keepSlug, secondary: rest.filter((s) => s !== keepSlug), relabelPlaces: false };
}

export function emptyEventInput(): EventInput {
  return {
    title: '',
    description: '',
    originalReportText: '',
    categoryId: null,
    severity: 'medium',
    latitude: null,
    longitude: null,
    locationName: '',
    country: '',
    region: '',
    city: '',
    address: '',
    locationPrecision: null,
    sourceName: '',
    sourceUrl: '',
    sourceType: 'manual_report',
    occurredAt: new Date().toISOString(),
    isBreaking: false,
    isVerified: false,
    geocodingConfidence: null,
    coordinatesManuallyCorrected: false,
  };
}

/** Fill the form from the agent's result (`text` = what was pasted). */
export function applyCompose(prev: EventInput, r: ComposeResult, text: string, categories: EventCategory[]): EventInput {
  return {
    ...prev,
    // A link: the original report is the post / page itself, not the pasted link.
    originalReportText: r.link?.text ? r.link.text.slice(0, 10000) : text,
    ...(r.link?.url ? { sourceUrl: r.link.url } : {}),
    ...(r.link?.sourceName ? { sourceName: r.link.sourceName } : {}),
    ...(r.link?.occurredAt ? { occurredAt: r.link.occurredAt } : {}),
    title: r.title || prev.title,
    description: r.description || prev.description,
    categoryId: r.categoryId && categories.some((c) => c.id === r.categoryId) ? r.categoryId : prev.categoryId,
    secondarySlugs: Array.isArray(r.secondarySlugs) ? r.secondarySlugs.filter((s) => typeof s === 'string').slice(0, 2) : [],
    severity: r.severity || prev.severity,
    isBreaking: r.isBreaking,
    country: r.country || prev.country,
    region: r.region || prev.region,
    city: r.city || prev.city,
    locationName: r.locationName || prev.locationName,
    locations: Array.isArray(r.locations) ? r.locations : prev.locations,
    ...(r.latitude !== null && r.longitude !== null
      ? { latitude: r.latitude, longitude: r.longitude, locationPrecision: r.precision ?? 'exact', geocodingConfidence: null, coordinatesManuallyCorrected: false }
      : {}),
  };
}

/**
 * Places of different kinds → one event per kind: its own category, its places (pinned at
 * the first one), a headline "<kind>: <places>", and the report's summary and original text.
 */
export function splitByCategory(
  base: EventInput,
  categories: EventCategory[],
  label: (c: EventCategory) => string,
  andMore: (count: number) => string,
): EventInput[] {
  const places = base.locations ?? [];
  const groups = new Map<string, PlaceInput[]>();
  for (const p of places) {
    if (!p.category_slug) continue;
    groups.set(p.category_slug, [...(groups.get(p.category_slug) ?? []), p]);
  }
  const own = categories.find((c) => c.id === base.categoryId)?.slug ?? null;
  const secondary = base.secondarySlugs ?? [];
  const relabel = (list: PlaceInput[], to: string) => list.map((p) => (p.category_slug ? { ...p, category_slug: to } : p));
  if (groups.size < 2) {
    // One kind only: it is this report's incident, so its pins show the report's category;
    // the place kind is kept as a secondary type.
    const [kind] = groups.keys();
    if (groups.size === 1 && own && kind !== own) {
      const r = singleKind({ own, secondary, kind });
      return [{ ...base, secondarySlugs: r.secondary, locations: relabel(places, own) }];
    }
    return [{ ...base, secondarySlugs: secondary }];
  }
  const kinds = [...groups.keys()].filter((s) => categories.some((c) => c.slug === s));
  const kept = kinds.length >= 2 ? afterSplit({ own, secondary, groups: kinds }) : null;
  const out: EventInput[] = [];
  for (const [slug, list0] of groups) {
    const isKept = kept?.keepSlug === slug;
    const cat = categories.find((c) => c.slug === (isKept ? kept!.main : slug));
    if (!cat) continue;
    const list = isKept && kept!.relabelPlaces ? relabel(list0, kept!.main) : list0;
    const names = list.map((p) => p.name).filter(Boolean);
    const shown = names.slice(0, 4).join(', ');
    const more = names.length > 4 ? ` ${andMore(names.length - 4)}` : '';
    const first = list.find((p) => p.lat !== null && p.lng !== null);
    out.push({
      ...base,
      title: `${label(cat)}: ${shown}${more}`.slice(0, 200),
      categoryId: cat.id,
      secondarySlugs: isKept ? kept!.secondary : [],
      locations: list,
      locationName: first?.name ?? list[0]?.name ?? base.locationName,
      latitude: first ? first.lat : null,
      longitude: first ? first.lng : null,
      locationPrecision: first ? ((first.precision as EventInput['locationPrecision']) ?? 'exact') : null,
    });
  }
  return out.length > 1 ? out : [{ ...base, secondarySlugs: secondary }];
}

/** A public Telegram post link (its pictures are fetched again when saved). */
export function telegramPost(url: string | null | undefined): string | null {
  return url && /^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{3,}\/\d+$/.test(url) ? url : null;
}
