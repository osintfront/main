import type { PublicEvent } from '@/types/event';

/**
 * צי"ח (EEI — essential elements of information): saved keyword queries that
 * narrow the map and feed to the events they ask about.
 *
 * Query syntax (Hebrew, English or Arabic):
 *   words separated by spaces  → all of them must appear       כטב"מ צור
 *   alternatives separated by , → any one of them              רחפן, כטב"מ, UAV
 *   -word                      → must not appear               חיזבאללה -הצהרה
 *   "two words"                → exact phrase                  "בנת ג'בייל"
 * Matching is by substring, so "צור" also finds "בצור" / "לצור".
 */

export interface Eei {
  id: string;
  name: string;
  query: string;
}

/** Same spelling for the different quote marks (צה"ל / צה״ל, ג'בייל / ג׳בייל) and no niqqud. */
export function normalizeText(s: string): string {
  return s
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[֑-ׇً-ٰٟ]/g, '') // Hebrew niqqud/cantillation, Arabic harakat
    .replace(/[״“”„]/g, '"')
    .replace(/[׳‘’`´]/g, "'")
    .replace(/\s+/g, ' ');
}

interface Clause {
  must: string[];
  not: string[];
}

function tokens(part: string): string[] {
  const out: string[] = [];
  const re = /(-?)"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(part))) out.push(m[2] !== undefined ? `${m[1]}${m[2]}` : m[3]);
  return out;
}

/** Parse a query into OR-clauses of AND-terms. Empty query → null (matches nothing). */
export function compileEei(query: string): Clause[] | null {
  // Split on commas / new lines that are not inside quotes.
  const parts: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of normalizeText(query.replace(/\n/g, ','))) {
    if (ch === '"') {
      // A quote right after a Hebrew letter is gershayim (כטב"מ), not a phrase quote.
      const prev = cur.slice(-1);
      if (!quoted && /[א-ת]/.test(prev)) {
        cur += ch;
        continue;
      }
      quoted = !quoted;
    }
    if (ch === ',' && !quoted) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const clauses = parts
    .map((p) => {
      const c: Clause = { must: [], not: [] };
      for (const raw of tokens(p.trim())) {
        const tok = raw.replace(/^"|"$/g, '');
        if (tok.startsWith('-') && tok.length > 1) c.not.push(tok.slice(1));
        else if (tok && tok !== '-') c.must.push(tok);
      }
      return c;
    })
    .filter((c) => c.must.length || c.not.length);
  return clauses.length ? clauses : null;
}

const textCache = new WeakMap<PublicEvent, string>();

/** Everything searchable about an event, normalised once. */
export function eventText(e: PublicEvent): string {
  let t = textCache.get(e);
  if (t === undefined) {
    t = normalizeText(
      [
        e.title,
        e.description,
        e.locationName,
        e.city,
        e.region,
        e.country,
        e.sourceName ?? '',
        e.category.name,
        ...(e.places ?? []).flatMap((p) => [p.name, p.nameEn]),
      ].join(' \n '),
    );
    textCache.set(e, t);
  }
  return t;
}

export function matchesEei(e: PublicEvent, clauses: Clause[] | null): boolean {
  if (!clauses) return false;
  const text = eventText(e);
  return clauses.some((c) => c.must.every((w) => text.includes(w)) && !c.not.some((w) => text.includes(w)));
}

export type EeiMatcher = Clause[] | null;
