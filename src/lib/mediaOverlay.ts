/**
 * Translation on the picture and subtitles on the video — the pure rules: which boxes a picture
 * gets, where a 0–1000 box lands on a picture drawn with object-fit, the font that fits a box, each
 * text's own direction, and the WebVTT file built from saved lines. `import type` only, so the node
 * unit tests load it as is.
 */
import type { Box, MediaReadingItem, MediaTranslation, Segment } from './mediaReading.ts';
import { pairView, pick } from './mediaReading.ts';

export interface OverlayBox { box: Box; text: string; orig: string; dir: 'rtl' | 'ltr' }
export interface Rect { left: number; top: number; width: number; height: number }

const RTL = /[֐-ࣿיִ-ﻼ]/;

/** 'rtl' when the first letter is Hebrew / Arabic script, else 'ltr'. */
export function textDir(s: string): 'rtl' | 'ltr' {
  const m = /\p{L}/u.exec(s);
  return m && RTL.test(m[0]) ? 'rtl' : 'ltr';
}

/** The boxes to draw on one picture, in the reader's language (texts already in it are not drawn). */
export function overlayBoxes(item: MediaReadingItem | null, lang: string): OverlayBox[] {
  if (!item || item.kind !== 'image') return [];
  const out: OverlayBox[] = [];
  for (const p of item.texts) {
    if (!p.box) continue;
    const v = pairView(p, lang);
    if (v.translation == null) continue;
    out.push({ box: p.box, text: v.translation, orig: p.orig, dir: textDir(v.translation) });
  }
  return out;
}

/** The drawn picture inside an element (centred, as object-fit cover / contain with the default position). */
export function imageRect(nat: { w: number; h: number }, el: { w: number; h: number }, fit: 'cover' | 'contain'): Rect {
  if (nat.w <= 0 || nat.h <= 0 || el.w <= 0 || el.h <= 0) return { left: 0, top: 0, width: el.w, height: el.h };
  const scale = fit === 'cover' ? Math.max(el.w / nat.w, el.h / nat.h) : Math.min(el.w / nat.w, el.h / nat.h);
  const width = nat.w * scale;
  const height = nat.h * scale;
  return { left: (el.w - width) / 2, top: (el.h - height) / 2, width, height };
}

/** A 0–1000 box in pixels of the drawn picture. */
export function boxPx(box: Box, r: Rect): Rect {
  const [y0, x0, y1, x1] = box;
  return { left: r.left + (x0 / 1000) * r.width, top: r.top + (y0 / 1000) * r.height, width: ((x1 - x0) / 1000) * r.width, height: ((y1 - y0) / 1000) * r.height };
}

/** The largest font from 22 px down to 9 px at which `chars` characters fit the box; null = none. */
export function fitFont(w: number, h: number, chars: number): number | null {
  for (let fs = 22; fs >= 9; fs--) {
    const lines = Math.floor((h - 2) / (fs * 1.2));
    if (lines >= 1 && lines * Math.floor((w - 4) / (fs * 0.55)) >= chars) return fs;
  }
  return null;
}

const pad = (n: number, d = 2) => String(n).padStart(d, '0');

/** Seconds as WebVTT time HH:MM:SS.mmm. */
export function vttTime(sec: number): string {
  const ms = Math.round(Math.max(0, sec) * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

/** The subtitle file in the reader's language (the other one when a line lacks it); null = nothing to show. */
export function toVtt(segments: Segment[], lang: string): string | null {
  let out = 'WEBVTT\n\n';
  let any = false;
  for (const s of segments) {
    const text = pick(s.he, s.en, lang).trim();
    if (!text) continue;
    const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/-->/g, '→').replace(/\n{2,}/g, '\n');
    out += `${vttTime(s.start)} --> ${vttTime(s.end)}\n${safe}\n\n`;
    any = true;
  }
  return any ? out : null;
}

/** The saved item for a picture / video: the first id of the list that has one. */
export function readingFor(reading: MediaTranslation | null, ids: (string | null | undefined)[]): MediaReadingItem | null {
  if (!reading) return null;
  for (const id of ids) {
    if (!id) continue;
    const it = reading.items.find((i) => i.mediaId === id);
    if (it) return it;
  }
  return null;
}
