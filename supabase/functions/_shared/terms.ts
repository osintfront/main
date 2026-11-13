// Deep analysis: the terms the editor marks in every event (people, weapons, organisations,
// notable places, military terms). Pure rules, no imports, so the unit tests load this file.
// Everything the AI returns is cleaned here before it is stored.

export const TERM_KINDS = ["person", "weapon", "org", "place", "term"] as const;
export type TermKind = (typeof TERM_KINDS)[number];
export const TERM_LIMITS = { perEvent: 6, minLen: 2, maxLen: 60, name: 80 } as const;

export interface TermMark { key: string; keys: string[]; kind: TermKind; he: string; en: string; name: string }

/** One spelling for comparing names: Unicode-normal, lower case, no vowel marks, one kind of quote and dash. */
export function normTerm(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[׳’‘´`]/g, "'")
    .replace(/[״“”]/g, '"')
    .replace(/[־‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^["'().,:;!?\- ]+|["'().,:;!?\- ]+$/g, "")
    .slice(0, TERM_LIMITS.name);
}

export const TERM_RULES = `
Terms (the "terms" field): mark the names a reader may want explained — people with a public role (leaders, officials, commanders, spokesmen), named weapons / systems / platforms, organisations / units / militias, places of standing significance (a strait, a base, a facility — not the town where the incident happened) and military terms a reader may not know.
You must never mark: the dead, wounded, detained, witnesses or any private person; countries; generic words ("army", "a drone"); the outlet that reported.
"he" / "en": the name exactly as written in the Hebrew / English headline or summary. "name": the usual full English name. kind: person, weapon, org, place or term. Usually none to three.`;

export const TERMS_PROP = {
  type: "array",
  maxItems: TERM_LIMITS.perEvent,
  items: {
    type: "object",
    properties: {
      he: { type: "string", description: "The name exactly as written in the Hebrew headline or summary" },
      en: { type: "string", description: "The name exactly as written in the English headline or summary" },
      name: { type: "string", description: "The usual full English name" },
      kind: { type: "string", enum: [...TERM_KINDS] },
    },
    required: ["name", "kind"],
  },
  description: "Names a reader may want explained (see the term rules). Usually none to three.",
};

/** The part of `text` that matches `want` (case-insensitive), in the text's own casing; '' if absent or bad length. */
function inText(want: unknown, text: string, caseless: boolean): string {
  if (typeof want !== "string") return "";
  const w = want.trim();
  if (w.length < TERM_LIMITS.minLen || w.length > TERM_LIMITS.maxLen) return "";
  if (!caseless) return text.includes(w) ? w : "";
  const i = text.toLowerCase().indexOf(w.toLowerCase());
  return i < 0 ? "" : text.slice(i, i + w.length);
}

export function cleanTerms(raw: unknown, texts: { he: string; en: string }): TermMark[] {
  if (!Array.isArray(raw)) return [];
  const out: TermMark[] = [];
  for (const it of raw) {
    if (out.length >= TERM_LIMITS.perEvent) break;
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    if (!(TERM_KINDS as readonly string[]).includes(r.kind as string)) continue;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, TERM_LIMITS.name) : "";
    const key = normTerm(name);
    if (key.length < TERM_LIMITS.minLen) continue;
    const he = inText(r.he, texts.he ?? "", false);
    const en = inText(r.en, texts.en ?? "", true);
    if (!he && !en) continue;
    if (out.some((m) => m.key === key)) continue;
    const keys = [...new Set([key, normTerm(he), normTerm(en)].filter(Boolean))];
    out.push({ key, keys, kind: r.kind as TermKind, he, en, name });
  }
  return out;
}
