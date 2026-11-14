/**
 * Media translation ("Translate image/video" after Expand) in the browser: the safe mapping of the
 * media_translation RPC answer, which translation a reader sees, item labels, and the button's state.
 * No imports, so the node unit tests load it as is.
 */
export type SpeechState = 'ok' | 'none' | 'unreadable' | 'too_big' | 'too_long' | 'unavailable' | 'off' | 'limit';
const SPEECH_STATES: readonly string[] = ['ok', 'none', 'unreadable', 'too_big', 'too_long', 'unavailable', 'off', 'limit'];

export type Box = [number, number, number, number]; // ymin, xmin, ymax, xmax — 0..1000
export interface TextPair { orig: string; lang: string; he: string; en: string; whereHe: string; whereEn: string; from: 'frame' | 'video'; box: Box | null }
export interface Segment { start: number; end: number; orig: string; he: string; en: string }
export interface MediaSpeech {
  state: SpeechState; lang: string; seconds: number | null; orig: string; he: string; en: string; summaryHe: string; summaryEn: string; cut: boolean;
  segments: Segment[];
}
export interface MediaReadingItem {
  mediaId: string; kind: 'image' | 'video'; thumb: string | null; descriptionHe: string; descriptionEn: string; texts: TextPair[]; speech: MediaSpeech | null;
}
export interface MediaTranslation {
  items: MediaReadingItem[]; todo: number; working: boolean; failed: boolean; staff: boolean; used: number; limit: number | null; budgetLeft: boolean;
  /** Staff only: why the last run's video speech was not read. */
  speechNote: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown) => (typeof v === 'string' ? v : '');
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

function mapPair(p: unknown): TextPair | null {
  if (!isObj(p) || !s(p.orig).trim()) return null;
  return {
    orig: s(p.orig), lang: s(p.lang) || 'und', he: s(p.he), en: s(p.en), whereHe: s(p.where_he), whereEn: s(p.where_en),
    from: p.from === 'video' ? 'video' : 'frame', box: mapBox(p.box),
  };
}

function mapBox(v: unknown): Box | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000)) return null;
  const [y0, x0, y1, x1] = v as number[];
  return y0 < y1 && x0 < x1 ? [y0, x0, y1, x1] : null;
}

function mapSegments(v: unknown): Segment[] {
  const out: Segment[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    if (!isObj(x) || typeof x.start !== 'number' || typeof x.end !== 'number' || !Number.isFinite(x.start) || !Number.isFinite(x.end)) continue;
    if (x.start < 0 || x.end <= x.start) continue;
    out.push({ start: x.start, end: x.end, orig: s(x.orig), he: s(x.he), en: s(x.en) });
    if (out.length >= 120) break;
  }
  return out;
}

function mapSpeech(v: unknown): MediaSpeech | null {
  if (!isObj(v) || typeof v.state !== 'string' || !SPEECH_STATES.includes(v.state)) return null;
  return {
    state: v.state as SpeechState, lang: s(v.lang) || 'und', seconds: typeof v.seconds === 'number' && Number.isFinite(v.seconds) ? v.seconds : null,
    orig: s(v.orig), he: s(v.he), en: s(v.en), summaryHe: s(v.summary_he), summaryEn: s(v.summary_en), cut: v.cut === true,
    segments: mapSegments(v.segments),
  };
}

/** The RPC answer, cleaned; null when it is not one. */
export function mapTranslation(raw: unknown): MediaTranslation | null {
  if (!isObj(raw) || !Array.isArray(raw.items)) return null;
  const items: MediaReadingItem[] = [];
  for (const it of raw.items) {
    if (!isObj(it) || typeof it.media_id !== 'string' || (it.kind !== 'image' && it.kind !== 'video')) continue;
    const thumb = typeof it.thumb === 'string' && it.thumb.startsWith('https://') ? it.thumb : null;
    items.push({
      mediaId: it.media_id, kind: it.kind, thumb, descriptionHe: s(it.description_he), descriptionEn: s(it.description_en),
      texts: (Array.isArray(it.texts) ? it.texts : []).map(mapPair).filter((p): p is TextPair => !!p).slice(0, 12),
      speech: it.kind === 'video' ? mapSpeech(it.speech) : null,
    });
    if (items.length >= 40) break;
  }
  return {
    items, todo: count(raw.todo), working: raw.working === true, failed: raw.failed === true, staff: raw.staff === true,
    used: count(raw.used), limit: typeof raw.limit === 'number' && Number.isFinite(raw.limit) ? raw.limit : null,
    budgetLeft: 'budget_left' in raw ? raw.budget_left === true : true,
    speechNote: typeof raw.speech_note === 'string' && raw.speech_note.trim() ? raw.speech_note.trim().slice(0, 300) : null,
  };
}

/** The text in the reader's language, else the other one. */
export function pick(he: string, en: string, lang: string): string {
  return lang === 'he' ? he || en : en || he;
}

/** A text pair as shown: no translation when the text is already in the reader's language or the same. */
export function pairView(p: TextPair, lang: string): { orig: string; translation: string | null; where: string } {
  const tr = pick(p.he, p.en, lang);
  const same = !tr.trim() || tr.trim().toLowerCase() === p.orig.trim().toLowerCase();
  return { orig: p.orig, translation: p.lang === lang || same ? null : tr, where: pick(p.whereHe, p.whereEn, lang) };
}

/** "Picture 1", "Video 1", "Picture 2" … */
export function itemLabels(items: MediaReadingItem[]): { key: 'mt.image' | 'mt.video'; n: number }[] {
  let pics = 0;
  let vids = 0;
  return items.map((i) => (i.kind === 'image' ? { key: 'mt.image', n: ++pics } : { key: 'mt.video', n: ++vids }));
}

export type ButtonState = 'hidden' | 'locked' | 'loading' | 'translate' | 'show' | 'show_more';

export function buttonState(o: { hasMedia: boolean; expandOpen: boolean; allowed: boolean; data: MediaTranslation | null | undefined }): ButtonState {
  if (!o.hasMedia || !o.expandOpen) return 'hidden';
  if (!o.allowed) return 'locked';
  if (o.data === undefined) return 'loading';
  if (o.data === null) return 'locked';
  if (!o.data.items.length) return 'translate';
  return o.data.todo > 0 ? 'show_more' : 'show';
}
