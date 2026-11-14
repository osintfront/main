// Statistics dashboard — PDF and JPEG made in the browser from an off-screen light copy of the dashboard.
// Every library is loaded on the first press (await import), nothing heavy at module level. The PDF's
// pages are pictures drawn by the browser (so Hebrew and mixed-direction text are always shaped right)
// with real link areas over the source lines. Never window.print.
import { A4, PAGE, fitBox, lineRect, paginate } from './dashExportLayout';

export interface PdfMeta {
  sources: { n: number; title: string; url: string }[];
  dir: 'ltr' | 'rtl';
  labels: { sources: string; preparedFor: string | null; generated: string; site: string };
  logoUrl: string;
}

const FONT_FILES: [string, number, () => Promise<{ default: string }>][] = [
  ['Heebo', 400, () => import('@fontsource/heebo/files/heebo-hebrew-400-normal.woff2?url')],
  ['Heebo', 600, () => import('@fontsource/heebo/files/heebo-hebrew-600-normal.woff2?url')],
  ['Heebo', 700, () => import('@fontsource/heebo/files/heebo-hebrew-700-normal.woff2?url')],
  ['Heebo', 400, () => import('@fontsource/heebo/files/heebo-latin-400-normal.woff2?url')],
  ['Heebo', 600, () => import('@fontsource/heebo/files/heebo-latin-600-normal.woff2?url')],
  ['Heebo', 700, () => import('@fontsource/heebo/files/heebo-latin-700-normal.woff2?url')],
  ['Inter', 400, () => import('@fontsource/inter/files/inter-latin-400-normal.woff2?url')],
  ['Inter', 600, () => import('@fontsource/inter/files/inter-latin-600-normal.woff2?url')],
  ['Inter', 700, () => import('@fontsource/inter/files/inter-latin-700-normal.woff2?url')],
];

let fontCss: Promise<string> | null = null;
const toDataUrl = (blob: Blob) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = bad; r.readAsDataURL(blob); });
/** @font-face rules with the bundled site fonts as data URLs (once); the same faces are added to document.fonts. */
function fontEmbedCss(): Promise<string> {
  fontCss ??= Promise.all(FONT_FILES.map(async ([family, weight, load]) => {
    const url = (await load()).default;
    const data = await toDataUrl(await (await fetch(url)).blob());
    try { document.fonts.add(new FontFace(family, `url(${data})`, { weight: String(weight) })); } catch { /* old browser */ }
    return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(${data}) format('woff2');}`;
  })).then((rules) => rules.join('\n')).catch((e) => { fontCss = null; throw e; });
  return fontCss;
}

const isWebKit = () => /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);

/** The dashboard copy as a canvas, 2× (2,160 px for the 1,080 px copy), white background, site fonts inside. */
async function sheetCanvas(node: HTMLElement): Promise<HTMLCanvasElement> {
  const [{ toCanvas }, css] = await Promise.all([import('html-to-image'), fontEmbedCss()]);
  await document.fonts.ready;
  // The copy sits off-screen (left: -20000px): the clone must be drawn at the origin, or the picture is blank.
  const opts = { pixelRatio: PAGE.px / node.offsetWidth, backgroundColor: '#ffffff', fontEmbedCSS: css, cacheBust: true,
    width: node.offsetWidth, height: node.offsetHeight, style: { position: 'static', left: '0', top: '0', transform: 'none' } };
  // WebKit's first pass can miss fonts and images: render once, discard, render again.
  if (isWebKit()) await toCanvas(node, opts);
  return toCanvas(node, opts);
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('toBlob failed'))), type, q));

export async function renderJpeg(node: HTMLElement): Promise<Blob> {
  return toBlob(await sheetCanvas(node), 'image/jpeg', 0.92);
}

const loadImage = (src: string) => new Promise<HTMLImageElement | null>((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });

/** One white page canvas (2,160 px across A4) with the footer drawn; s = pixels per point. */
function pageCanvas(meta: PdfMeta, logo: HTMLImageElement | null): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D; s: number } {
  const s = PAGE.px / A4.w;
  const c = document.createElement('canvas');
  c.width = PAGE.px;
  c.height = Math.round(A4.h * s);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  const y = (A4.h - PAGE.footer / 2 - 4) * s;
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = s * 0.6;
  ctx.beginPath();
  ctx.moveTo(PAGE.margin * s, (A4.h - PAGE.footer) * s);
  ctx.lineTo((A4.w - PAGE.margin) * s, (A4.h - PAGE.footer) * s);
  ctx.stroke();
  ctx.font = `600 ${9 * s}px Heebo, Inter, sans-serif`;
  ctx.fillStyle = '#64748b';
  ctx.textBaseline = 'middle';
  ctx.direction = meta.dir;
  let x = PAGE.margin * s;
  if (logo) { ctx.drawImage(logo, x, y - 7 * s, 14 * s, 14 * s); x += 20 * s; }
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  ctx.fillText(meta.labels.site, x, y);
  ctx.direction = meta.dir;
  ctx.textAlign = 'right';
  ctx.fillText([meta.labels.preparedFor, meta.labels.generated].filter(Boolean).join(' · '), (A4.w - PAGE.margin) * s, y);
  return { c, ctx, s };
}

/** Text cut with "…" to fit maxW pixels. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

export async function renderPdf(node: HTMLElement, meta: PdfMeta): Promise<Blob> {
  const [{ jsPDF }, sheet, logo] = await Promise.all([import('jspdf'), sheetCanvas(node), loadImage(meta.logoUrl)]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  // Page 1: the dashboard picture inside the margins, above the footer.
  {
    const { c, ctx, s } = pageCanvas(meta, logo);
    const box = fitBox(sheet.width, sheet.height, A4.w - 2 * PAGE.margin, A4.h - PAGE.footer - 2 * PAGE.margin);
    ctx.drawImage(sheet, (PAGE.margin + box.x) * s, (PAGE.margin + box.y) * s, box.w * s, box.h * s);
    doc.addImage(await toDataUrl(await toBlob(c, 'image/jpeg', 0.92)), 'JPEG', 0, 0, A4.w, A4.h);
  }
  // Sources pages: one line per incident, each a link to its first event.
  for (const lines of paginate(meta.sources)) {
    doc.addPage('a4', 'portrait');
    const { c, ctx, s } = pageCanvas(meta, logo);
    ctx.direction = meta.dir;
    ctx.textAlign = meta.dir === 'rtl' ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    const edge = (meta.dir === 'rtl' ? A4.w - PAGE.margin : PAGE.margin) * s;
    ctx.fillStyle = '#0f172a';
    ctx.font = `700 ${14 * s}px Heebo, Inter, sans-serif`;
    ctx.fillText(meta.labels.sources, edge, (PAGE.margin + 16) * s);
    ctx.font = `400 ${9 * s}px Heebo, Inter, sans-serif`;
    lines.forEach((l, i) => {
      const r = lineRect(i);
      const link = l.url.replace(/^https?:\/\//, '');
      ctx.fillStyle = '#0f172a';
      ctx.fillText(fit(ctx, `[${l.n}] ${l.title} — ${link}`, r.w * s), edge, (r.y + r.h / 2) * s);
      doc.link(r.x, r.y, r.w, r.h, { url: l.url });
    });
    doc.addImage(await toDataUrl(await toBlob(c, 'image/jpeg', 0.9)), 'JPEG', 0, 0, A4.w, A4.h);
  }
  return doc.output('blob');
}

export function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
