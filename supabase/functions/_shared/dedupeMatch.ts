// Pure matching rules of the dedupe agent (no I/O, no Deno APIs: unit-tested under node).
//
// couldBeSame: the broad rule — could two events be one incident at all (time, kind, country)?
// textTwin / focusedPass: the focused pass. The broad list hands the cheap model every statement
// of the last hours (~120 lines) and it misses many re-posts of one statement in another
// language. The focused pass shows each NEW event next to the few events whose headlines
// (Hebrew title + English translation) look most like it, so the twin is right there.

// deno-lint-ignore no-explicit-any
type Any = any;

export interface MatchRow {
  id: string; created_at: string; occurred_at: string; title: string;
  country: string | null; category_id: string | null; translations?: Any; ai_suggestions?: Any;
}

/** Kinds of event that can be the same incident (statements never pair with strikes). */
const FAMILY: Record<string, string> = {
  airstrike: "kinetic", "missile-rocket-attack": "kinetic", uav: "kinetic", drone: "kinetic", "artillery-shelling": "kinetic",
  explosion: "kinetic", "shooting-gunfire": "kinetic", assassination: "kinetic", killed: "kinetic", wounded: "kinetic", infiltration: "kinetic",
  "terror-security-incident": "kinetic", "military-activity": "kinetic", "force-sighting": "kinetic",
  statements: "words", "political-event": "words",
};
const family = (slug: string | undefined) => (slug ? FAMILY[slug] ?? slug : "-");
const countryKey = (c: string | null) => (c ?? "").toLowerCase().split(/[/,]/).map((x) => x.trim()).filter(Boolean);
/** A single strike or blast is one moment; reports of a situation (advances, control, claims,
 *  statements) get repeated for many hours. */
const MOMENT = new Set(["airstrike", "missile-rocket-attack", "uav", "drone", "artillery-shelling", "explosion", "shooting-gunfire", "assassination", "infiltration", "terror-security-incident"]);
// Incidents on a border are often filed under either side.
const NEIGHBOURS: Record<string, string[]> = {
  israel: ["lebanon", "syria", "palestine", "jordan", "egypt"], lebanon: ["israel", "syria"], syria: ["israel", "lebanon", "jordan", "iraq", "turkey"],
  palestine: ["israel", "egypt", "jordan"], jordan: ["israel", "syria", "iraq", "palestine", "saudi arabia"], iraq: ["syria", "iran", "jordan", "turkey", "kuwait", "saudi arabia"],
  iran: ["iraq", "turkey"], turkey: ["syria", "iraq", "iran"], egypt: ["israel", "palestine"], yemen: ["saudi arabia", "oman"], "saudi arabia": ["yemen", "jordan", "iraq"],
};
const sameOrNext = (a: string[], b: string[]) => a.some((x) => b.includes(x) || (NEIGHBOURS[x] ?? []).some((n) => b.includes(n)));

const H6 = 6 * 3600_000, H24 = 24 * 3600_000;
const root = (r: Any) => r.ai_suggestions?.split_from ?? r.id;
/** 6 h for a strike, 24 h for a situation report or claim, which outlets keep repeating. */
function inWindow(a: MatchRow, b: MatchRow, slug: Map<string, string>): boolean {
  const sa = slug.get(a.category_id ?? ""), sb = slug.get(b.category_id ?? "");
  const window = MOMENT.has(sa ?? "") || MOMENT.has(sb ?? "") ? H6 : H24;
  return Math.abs(Date.parse(a.occurred_at) - Date.parse(b.occurred_at)) <= window;
}

/**
 * Could a and b be one incident (worth asking the model)? Close in time, same kind, and the same
 * or a neighbouring country when both are known. Siblings split from one report never are.
 */
export function couldBeSame(a: MatchRow, b: MatchRow, slug: Map<string, string>): boolean {
  if (root(a) === root(b)) return false;
  if (!inWindow(a, b, slug)) return false;
  if (family(slug.get(a.category_id ?? "")) !== family(slug.get(b.category_id ?? ""))) return false;
  const ca = countryKey(a.country), cb = countryKey(b.country);
  return !ca.length || !cb.length || sameOrNext(ca, cb);
}

const WORD = /[\p{L}\p{N}]{3,}/gu;
const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "will", "would", "has", "have", "was", "are", "not", "its", "their", "our",
  "his", "her", "after", "over", "into", "says", "said", "report", "reports", "new",
  "של", "על", "את", "עם", "לא", "כי", "גם", "אל", "אם", "או", "הוא", "היא", "דיווח", "לאחר", "בין", "נגד",
]);
/** Headline words: Hebrew title + English title, ≥3 letters, Hebrew one-letter prefixes loosely stripped. */
export function headlineWords(r: Pick<MatchRow, "title" | "translations">): Set<string> {
  const text = `${r.title ?? ""} ${r.translations?.en?.title ?? ""}`;
  const out = new Set<string>();
  for (const w of text.toLowerCase().normalize("NFKC").replace(/[֑-ׇ]/g, "").match(WORD) ?? []) {
    if (STOP.has(w)) continue;
    out.add(w);
    if (/^[ובלמהשכ]/.test(w) && w.length > 4) out.add(w.slice(1));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

const cache = new WeakMap<object, Set<string>>();
const wordsOf = (r: MatchRow) => {
  let w = cache.get(r);
  if (!w) cache.set(r, (w = headlineWords(r)));
  return w;
};
/** 0–1: how much two headlines (Hebrew + English) share. */
export const headlineSimilarity = (a: MatchRow, b: MatchRow) => jaccard(wordsOf(a), wordsOf(b));

/** Headlines this close may cross kinds and countries (the same report filed twice). */
const SAME_HEADLINE = 0.6;
/** Headlines this close may cross countries within one kind (statements are filed under the
 *  speaker's country or the country they talk about). */
const TWIN_HEADLINE = 0.3;

/**
 * Two events whose headlines say the same thing, within the usual time window, even when the
 * broad rule keeps them apart (another country, statement vs military activity).
 */
export function textTwin(a: MatchRow, b: MatchRow, slug: Map<string, string>): boolean {
  if (root(a) === root(b) || !inWindow(a, b, slug)) return false;
  const s = headlineSimilarity(a, b);
  if (s >= SAME_HEADLINE) return true;
  const sameKind = family(slug.get(a.category_id ?? "")) === family(slug.get(b.category_id ?? ""));
  return sameKind && s >= TWIN_HEADLINE;
}

export interface FocusedPass {
  /** Every event to show, oldest first; line n is rows[n-1]. */
  rows: MatchRow[];
  /** Each NEW event and the ids of its look-alikes, closest first. */
  groups: { fresh: string; candidates: string[] }[];
  /** "NEW [n]: [a] [b] …" — which lines each NEW line should be compared with. */
  compare: string;
}

/**
 * For each NEW event, its perEvent closest look-alikes (headline similarity ≥ minSim) among the
 * events the broad rule or textTwin allows. Two NEW events are compared once. The groups are packed
 * into batches of at most maxRows lines (one model call each), so a busy run never skips a NEW
 * event. Empty when no NEW event has a look-alike (no model call).
 */
export function focusedBatches(
  fresh: Set<string>, rows: MatchRow[], slug: Map<string, string>,
  opts: { perEvent?: number; minSim?: number; maxRows?: number } = {},
): FocusedPass[] {
  const perEvent = opts.perEvent ?? 8, minSim = opts.minSim ?? 0.12, maxRows = Math.max(opts.maxRows ?? 100, perEvent + 1);
  const order = (r: MatchRow) => `${r.created_at}|${r.id}`;
  const groups: { fresh: string; candidates: string[] }[] = [];
  for (const f of rows.filter((r) => fresh.has(r.id)).sort((a, b) => order(a).localeCompare(order(b)))) {
    const cands = rows
      // Older events, or NEW ones created earlier (so two NEW events are compared once).
      .filter((r) => r.id !== f.id && (!fresh.has(r.id) || order(r) < order(f)))
      .map((r) => ({ r, s: headlineSimilarity(f, r) }))
      .filter((x) => x.s >= minSim && (couldBeSame(f, x.r, slug) || textTwin(f, x.r, slug)))
      .sort((a, b) => b.s - a.s)
      .slice(0, perEvent);
    if (cands.length) groups.push({ fresh: f.id, candidates: cands.map((x) => x.r.id) });
  }
  // Pack groups into batches; a group's lines all go in the same batch.
  const packs: { groups: typeof groups; ids: Set<string> }[] = [];
  for (const g of groups) {
    const ids = [g.fresh, ...g.candidates];
    let pack = packs[packs.length - 1];
    if (!pack || new Set([...pack.ids, ...ids]).size > maxRows) packs.push((pack = { groups: [], ids: new Set() }));
    pack.groups.push(g);
    for (const id of ids) pack.ids.add(id);
  }
  return packs.map(({ groups: gs, ids }) => {
    const list = rows.filter((r) => ids.has(r.id)).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id));
    const no = new Map(list.map((r, i) => [r.id, i + 1]));
    const compare = gs.map((g) => `NEW [${no.get(g.fresh)}]: ${g.candidates.map((c) => `[${no.get(c)}]`).join(" ")}`).join("\n");
    return { rows: list, groups: gs, compare };
  });
}

/** The first focused batch (null when there is nothing to ask). */
export function focusedPass(
  fresh: Set<string>, rows: MatchRow[], slug: Map<string, string>,
  opts: { perEvent?: number; minSim?: number; maxRows?: number } = {},
): FocusedPass | null {
  return focusedBatches(fresh, rows, slug, opts)[0] ?? null;
}

/**
 * Which cheap-model proposals go on to the strong model. The strong model is the gate (a merge
 * needs its "high"); the cheap one only proposes, and it rates true re-reports "medium" when the
 * wording differs (a road "built" at 09:35, "widened" in another outlet at 13:45). Low: never.
 */
export const worthConfirming = (confidence: string | undefined) => confidence === "high" || confidence === "medium";

/** Output ceiling for one dedupe answer. */
export const MAX_ANSWER_TOKENS = 8000;
/**
 * An answer cut off at its token cap loses every pair in its tool call: ask again with twice the
 * room (up to MAX_ANSWER_TOKENS). null when the answer is complete or already at the ceiling.
 */
export function roomForRetry(stopReason: string | undefined, maxTokens: number): number | null {
  if (stopReason !== "max_tokens" || maxTokens >= MAX_ANSWER_TOKENS) return null;
  return Math.min(MAX_ANSWER_TOKENS, maxTokens * 2);
}
