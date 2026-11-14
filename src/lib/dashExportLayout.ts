// Statistics dashboard export — PDF page geometry (pure, no imports; tests/ask/dashExportLayout.test.ts).

export const A4 = { w: 595.28, h: 841.89 } as const; // points, portrait
/** px = page canvas width in pixels; margin, footer and lineH in points; perPage = source lines per page. */
export const PAGE = { px: 2160, margin: 36, footer: 44, lineH: 16, perPage: 42 } as const;
export const EXPORT_WIDTH = 1080; // CSS px of the off-screen export copy (rendered at 2×)
const HEADING = 40; // points above the first source line

/** Contain w × h inside boxW × boxH: centred horizontally, top-aligned. */
export function fitBox(w: number, h: number, boxW: number, boxH: number): { w: number; h: number; x: number; y: number } {
  const s = Math.min(boxW / w, boxH / h);
  const fw = w * s, fh = h * s;
  return { w: fw, h: fh, x: (boxW - fw) / 2, y: 0 };
}

export function paginate<T>(lines: T[], perPage: number = PAGE.perPage): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lines.length; i += perPage) out.push(lines.slice(i, i + perPage));
  return out;
}

/** The i-th source line of a sources page, in points. */
export function lineRect(i: number): { x: number; y: number; w: number; h: number } {
  return { x: PAGE.margin, y: PAGE.margin + HEADING + i * PAGE.lineH, w: A4.w - 2 * PAGE.margin, h: PAGE.lineH };
}
