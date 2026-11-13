// "Ask the map" conversation context as it arrives from the browser: cleaned here so the
// rest of the code can trust its shape. Pure (no Deno APIs, no imports) so it is unit-tested
// with node: tests/ask/askInput.test.ts.

export interface AskTurn {
  q: string;
  a: string;
}

/** Earlier turns of the conversation and the events the last answer showed. */
export interface AskCtx {
  history: AskTurn[];
  prevIds: string[];
}

export const NO_CTX: AskCtx = { history: [], prevIds: [] };

const MAX_TURNS = 5;
const MAX_Q = 500;
const MAX_A = 1500;
const MAX_IDS = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The last 5 well-formed {q, a} turns, trimmed and cut; anything else is dropped. */
export function cleanHistory(v: unknown): AskTurn[] {
  if (!Array.isArray(v)) return [];
  const out: AskTurn[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const { q, a } = item as Record<string, unknown>;
    if (typeof q !== "string" || typeof a !== "string") continue;
    const turn = { q: q.trim().slice(0, MAX_Q), a: a.trim().slice(0, MAX_A) };
    if (turn.q && turn.a) out.push(turn);
  }
  return out.slice(-MAX_TURNS);
}

/** UUID strings only, once each, at most 40. */
export function cleanIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string" || !UUID.test(x)) continue;
    const id = x.toLowerCase();
    if (!out.includes(id)) out.push(id);
    if (out.length === MAX_IDS) break;
  }
  return out;
}

/** 32-bit FNV-1a, 8 hex digits. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Cache key of a question. Inside a conversation everything the answer was built from is part of
 *  it — the earlier questions AND answers and the previous events. They all come from the browser,
 *  so a made-up context can only ever get back an answer saved for that same made-up context,
 *  never one that another user's real conversation would be served. */
export function cacheKey(question: string, history: AskTurn[], prevIds: string[] = []): string {
  const key = norm(question);
  if (!history.length && !prevIds.length) return key;
  const context = [...history.map((t) => `${norm(t.q)}\u0001${norm(t.a)}`), prevIds.join(",")].join("\u0002");
  return `${key}|${hash(context)}`;
}

/** The conversation so far as model messages (question → answer, in order). Citation numbers
 *  [n] are taken out of earlier answers: they point into earlier event lists, and one echoed
 *  into the new answer would be linked to the wrong event. */
export function historyMessages(history: AskTurn[]): { role: "user" | "assistant"; content: string }[] {
  return history.flatMap((t) => [
    { role: "user" as const, content: t.q },
    { role: "assistant" as const, content: t.a.replace(/\s*\[\d+\]/g, "").trim() || "-" },
  ]);
}

/** How many events go with the long original report. */
export const LONG_SOURCES = 40;

/**
 * Does the event at index `i` get the long original report? The list starts with `prev` events already
 * shown (a follow-up); they get at most half the long slots, and fresh results get the rest.
 */
export function longSource(i: number, prev: number): boolean {
  const fromPrev = Math.min(prev, LONG_SOURCES / 2);
  if (i < prev) return i < fromPrev;
  return i - prev < LONG_SOURCES - fromPrev;
}
