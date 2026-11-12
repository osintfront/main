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

/** Cache key of a question. Inside a conversation the earlier questions are part of it, so a
 *  follow-up never gets the saved answer of the same words asked on their own. */
export function cacheKey(question: string, history: AskTurn[]): string {
  const key = norm(question);
  return history.length ? `${key}|${hash(history.map((t) => norm(t.q)).join("\n"))}` : key;
}

/** The conversation so far as model messages (question → answer, in order). */
export function historyMessages(history: AskTurn[]): { role: "user" | "assistant"; content: string }[] {
  return history.flatMap((t) => [
    { role: "user" as const, content: t.q },
    { role: "assistant" as const, content: t.a },
  ]);
}
