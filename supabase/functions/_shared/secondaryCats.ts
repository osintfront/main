// Secondary event types: an event has one main type and up to two more (e.g. Killed + Airstrike).
// Pure rules shared by the editor writers and the split. No imports, so the unit tests load it.

export const MAX_SECONDARY = 2;
/** Types that only make sense as a main type. */
export const NEVER_SECONDARY: string[] = ["home-front-alerts", "other", "uncategorized"];
/** Main types kept after a split even when no place carries them. */
export const STICKY_MAIN: string[] = ["killed", "wounded", "assassination"];

/** Strings only, known, not the main, not never-secondary, distinct; `wounded` last; at most two. */
export function cleanSecondary(raw: unknown, allowed: Iterable<string>, main: string | null): string[] {
  if (!Array.isArray(raw)) return [];
  const ok = new Set(allowed);
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !ok.has(v) || v === main || NEVER_SECONDARY.includes(v) || out.includes(v)) continue;
    out.push(v);
  }
  const ordered = [...out.filter((s) => s !== "wounded"), ...out.filter((s) => s === "wounded")];
  return ordered.slice(0, MAX_SECONDARY);
}

/** All tagged places share one kind: when it is not the main type it becomes a secondary type (if there is room). */
export function singleKind(a: { own: string | null; secondary: string[]; kind: string }): { secondary: string[]; relabelPlaces: boolean } {
  if (!a.own || a.kind === a.own) return { secondary: [...a.secondary], relabelPlaces: false };
  const room = a.secondary.length < MAX_SECONDARY && !a.secondary.includes(a.kind) && !NEVER_SECONDARY.includes(a.kind);
  return { secondary: room ? [...a.secondary, a.kind] : [...a.secondary], relabelPlaces: true };
}

/** After a split by place kind (`groups`, in order): the original's main and secondary types. */
export function afterSplit(a: { own: string | null; secondary: string[]; groups: string[] }): {
  keepSlug: string;
  main: string;
  secondary: string[];
  relabelPlaces: boolean;
} {
  const own = a.own;
  const keepSlug = own && a.groups.includes(own) ? own : a.groups[0];
  const rest = a.secondary.filter((s) => !a.groups.includes(s));
  if (own && STICKY_MAIN.includes(own) && !a.groups.includes(own)) {
    return { keepSlug, main: own, secondary: [keepSlug, ...rest.filter((s) => s !== keepSlug && s !== own)].slice(0, MAX_SECONDARY), relabelPlaces: true };
  }
  return { keepSlug, main: keepSlug, secondary: rest.filter((s) => s !== keepSlug), relabelPlaces: false };
}
