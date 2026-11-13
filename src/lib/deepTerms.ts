// Deep analysis in the browser: which words of the event details window become links to a term's
// entry, the "Analyze" selection rule, and cleaning of the RPC answers (event_terms_for, deep_entry).
// Pure — no imports — so the unit tests load it.

export type TermKind = 'person' | 'weapon' | 'org' | 'place' | 'term';
const KINDS: readonly string[] = ['person', 'weapon', 'org', 'place', 'term'];
export const SECTION_KEYS: readonly string[] = ['background', 'capabilities', 'operators', 'use', 'significance'];

export interface EventTerm { key: string; name: string; kind: TermKind; surfaces: string[]; entry: string | null }
export type Segment = string | { text: string; term: EventTerm };

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

/** The RPC answer → a safe list of at most 12 terms. */
export function sanitizeTerms(raw: unknown): EventTerm[] {
  if (!Array.isArray(raw)) return [];
  const out: EventTerm[] = [];
  for (const r of raw) {
    if (out.length >= 12) break;
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.key !== 'string' || !o.key || !KINDS.includes(o.kind as string) || !Array.isArray(o.surfaces)) continue;
    const surfaces = o.surfaces.filter((s): s is string => typeof s === 'string').map((s) => s.slice(0, 80));
    out.push({ key: o.key.slice(0, 80), name: str(o.name, 80), kind: o.kind as TermKind, surfaces, entry: typeof o.entry === 'string' ? o.entry : null });
  }
  return out;
}

const WORD = /[\p{L}\p{N}]/u;
const PREFIX = 'והבלכמש';
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function okBefore(text: string, i: number): boolean {
  if (i === 0 || !WORD.test(text[i - 1])) return true;
  // one Hebrew prefix letter (ו ה ב ל כ מ ש) that itself starts a word
  return PREFIX.includes(text[i - 1]) && (i - 1 === 0 || !WORD.test(text[i - 2]));
}
const okAfter = (text: string, end: number) => end >= text.length || !WORD.test(text[end]);

/**
 * `text` split into plain pieces and term links: whole words only (a Hebrew prefix letter is
 * allowed), case-insensitive, the longest name first, no overlaps, the first appearance of each
 * term only, and none for a key in `used` (keys linked here are added to it).
 */
export function linkSegments(text: string, terms: EventTerm[], used: Set<string> = new Set()): Segment[] {
  if (!text) return [];
  const cands = terms
    .filter((t) => !used.has(t.key))
    .flatMap((t) => t.surfaces.filter((s) => s.length >= 2).map((s) => ({ s, t })))
    .sort((a, b) => b.s.length - a.s.length);
  const hits: { start: number; end: number; term: EventTerm }[] = [];
  const linked = new Set<string>();
  for (const { s, t } of cands) {
    if (linked.has(t.key)) continue;
    const re = new RegExp(escapeRe(s), 'giu');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (okBefore(text, start) && okAfter(text, end) && !hits.some((h) => start < h.end && end > h.start)) {
        hits.push({ start, end, term: t });
        linked.add(t.key);
        break;
      }
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start > at) out.push(text.slice(at, h.start));
    out.push({ text: text.slice(h.start, h.end), term: h.term });
    at = h.end;
  }
  if (at < text.length) out.push(text.slice(at));
  for (const k of linked) used.add(k);
  return out;
}

/** The selected text for "Analyze": trimmed, 2–80 characters, one line; else null. */
export function selectionTerm(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (s.length < 2 || s.length > 80 || /[\r\n]/.test(s)) return null;
  return s;
}

export interface DeepImage { url: string; page: string; credit: string; license: string; licenseUrl: string | null }
export interface DeepEntry {
  id: string; kind: TermKind; nameHe: string; nameEn: string; nameOrig: string; aliases: string[];
  summaryHe: string; summaryEn: string; sections: { key: string; he: string; en: string }[]; sources: { title: string; url: string; from: 'web' | 'event' }[];
  image: DeepImage | null; events: string[]; version: number; updatedAt: string; editedAt: string | null;
}

function mapImage(v: unknown): DeepImage | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.url !== 'string' || !/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(o.url)) return null;
  const page = typeof o.page === 'string' && o.page.startsWith('https://') ? o.page : '';
  const lu = typeof o.license_url === 'string' && o.license_url.startsWith('https://') ? o.license_url : null;
  return { url: o.url, page, credit: str(o.credit, 120), license: str(o.license, 60), licenseUrl: lu };
}

export function mapEntry(row: unknown): DeepEntry | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || !KINDS.includes(r.kind as string)) return null;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    id: r.id,
    kind: r.kind as TermKind,
    nameHe: str(r.name_he, 80),
    nameEn: str(r.name_en, 80),
    nameOrig: str(r.name_orig, 80),
    aliases: arr(r.aliases).filter((a): a is string => typeof a === 'string'),
    summaryHe: str(r.summary_he, 500),
    summaryEn: str(r.summary_en, 500),
    sections: arr(r.sections)
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && SECTION_KEYS.includes((s as { key?: string }).key ?? ''))
      .map((s) => ({ key: s.key as string, he: str(s.he, 1200), en: str(s.en, 1200) })),
    sources: arr(r.sources)
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && typeof (s as { url?: unknown }).url === 'string')
      .map((s) => ({ title: str(s.title, 160), url: s.url as string, from: s.from === 'event' ? ('event' as const) : ('web' as const) })),
    image: mapImage(r.image),
    events: arr(r.events).filter((e): e is string => typeof e === 'string'),
    version: Number(r.version) || 1,
    updatedAt: str(r.updated_at, 40),
    editedAt: typeof r.edited_at === 'string' ? r.edited_at : null,
  };
}

/**
 * The link segments of several texts in reading order: a term links once across all of them, and not
 * at all when it is in `already`. Works on its own copy, so it gives the same answer on every render
 * (React may render twice) and never changes `already`.
 */
export function segmentsInOrder(texts: string[], terms: EventTerm[], already?: Iterable<string>): Segment[][] {
  const used = new Set(already ?? []);
  return texts.map((t) => linkSegments(t, terms, used));
}

/**
 * The entry's sources as a reader may see them. Our events' own sources follow the event window's rules:
 * hidden without `source_link` or `sources_detail`; names only when `sources_detail` is limited (Pro);
 * names and links otherwise. Web sources always link.
 */
export function entrySources(
  sources: { title: string; url: string; from?: 'event' | 'web' }[],
  o: { sourceLink: boolean; detail: 'none' | 'names' | 'links' },
): { title: string; url: string | null }[] {
  return sources
    .filter((s) => s.from !== 'event' || (o.sourceLink && o.detail !== 'none'))
    .map((s) => ({ title: s.title, url: s.from === 'event' && o.detail === 'names' ? null : s.url }));
}
