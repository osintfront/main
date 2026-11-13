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

/**
 * Main types whose places are only mentions: a statement names where it was said, past strikes,
 * threats, an attack it condemns. Such an event is never split into incidents, and its places
 * never lend it a strike kind.
 */
export const MENTION_ONLY_MAIN: string[] = ["statements"];

/**
 * For a mention-only main type: the places with every tag set to the main type (untagged stay
 * untagged), or null when there is nothing to change (other main types, or already all tagged so).
 */
export function mentionsOnly<P extends { category_slug?: string }>(own: string | null, places: P[]): P[] | null {
  if (!own || !MENTION_ONLY_MAIN.includes(own)) return null;
  if (!places.some((p) => p?.category_slug && p.category_slug !== own)) return null;
  return places.map((p) => (p?.category_slug ? { ...p, category_slug: own } : p));
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

/**
 * The editor's main type next to the one triage chose. Killed / Wounded / Assassination from the editor
 * wins the main place (the agreed rules), and triage's type joins the secondary types first. When triage
 * already chose one of those, it stays and the editor's becomes secondary. Otherwise nothing changes.
 */
export function withEditorMain(rowMain: string | null, editorMain: string | null, editorSecondary: string[], allowed: Iterable<string>): { main: string | null; secondary: string[] } {
  const ok = new Set(allowed);
  // Wounded takes the main place only when no kind of attack is known (triage gave none / other).
  const knownKind = !!rowMain && !NEVER_SECONDARY.includes(rowMain) && rowMain !== "statements";
  const sticky = !!editorMain && ok.has(editorMain) && STICKY_MAIN.includes(editorMain) && editorMain !== rowMain &&
    !(editorMain === "wounded" && knownKind);
  if (!sticky) {
    // Triage chose a result (Killed / Wounded / Assassination) and the editor the attack itself: keep the attack.
    const editorAttack = !!editorMain && ok.has(editorMain) && editorMain !== rowMain && !NOT_A_KIND.has(editorMain);
    if (editorAttack && rowMain === "wounded") {
      return { main: editorMain, secondary: cleanSecondary([...editorSecondary.filter((x) => x !== "wounded"), "wounded"], ok, editorMain) };
    }
    if (editorAttack && rowMain && STICKY_MAIN.includes(rowMain)) {
      return { main: rowMain, secondary: cleanSecondary([editorMain!, ...editorSecondary], ok, rowMain) };
    }
    // Wounded that did not take the main place is kept as a secondary type.
    const extra = editorMain === "wounded" && ok.has("wounded") && editorMain !== rowMain ? [...editorSecondary, "wounded"] : editorSecondary;
    return { main: rowMain, secondary: cleanSecondary(extra, ok, rowMain) };
  }
  if (rowMain && STICKY_MAIN.includes(rowMain)) return { main: rowMain, secondary: cleanSecondary([editorMain, ...editorSecondary], ok, rowMain) };
  return { main: editorMain, secondary: cleanSecondary([rowMain, ...editorSecondary], ok, editorMain) };
}

/** Kinds that describe the attack or incident itself (not a result, a statement or a catch-all). */
const NOT_A_KIND = new Set(["killed", "wounded", "assassination", "statements", ...NEVER_SECONDARY]);

/**
 * The agreed type rules that need no AI, applied to the final main + secondary types:
 * an assassination always has Killed; a death announced in a statement is Killed (statement secondary);
 * Wounded is main only when no attack kind is known — otherwise the attack is main and Wounded secondary.
 */
export function normalizeTypes(main: string | null, secondary: string[], allowed: Iterable<string>): { main: string | null; secondary: string[] } {
  const ok = new Set(allowed);
  const sec = [...secondary];
  if (main === "assassination" && !sec.includes("killed") && ok.has("killed")) {
    return { main, secondary: cleanSecondary(["killed", ...sec], ok, main) };
  }
  if (main === "statements" && sec.includes("killed")) {
    return { main: "killed", secondary: cleanSecondary(["statements", ...sec.filter((s) => s !== "killed")], ok, "killed") };
  }
  if (main === "wounded" && !sec.includes("killed")) {
    const attack = sec.find((s) => !NOT_A_KIND.has(s));
    if (attack) return { main: attack, secondary: cleanSecondary([...sec.filter((s) => s !== attack), "wounded"], ok, attack) };
  }
  return { main, secondary: cleanSecondary(sec, ok, main) };
}
