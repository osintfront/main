// Quick compose from a link: read a public page (news article or public Telegram post) and
// return its text, title, date and pictures. Nothing is stored here; the pictures are saved
// only when the report is saved (event-agent {action:"attach_media"}).
import { fetchChannel } from "../whatsapp-ingest/telegram.ts";

const UA = "Mozilla/5.0 (compatible; OsintfrontBot/1.0; +https://osintfront.com)";

export interface LinkMedia { url: string; kind: "image" | "video_thumb" }
export interface LinkContent {
  url: string;
  kind: "telegram" | "web";
  sourceName: string;
  title: string;
  text: string;
  date: string | null;
  media: LinkMedia[];
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decode = (s: string) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const strip = (h: string) => decode(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
const meta = (html: string, name: string) =>
  decode((html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i")) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, "i")) ?? [])[1] ?? "");

/** The first http(s) link in a text. */
export function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  return m ? m[0].replace(/[.,;:!?]+$/, "") : null;
}

function safePublicUrl(u: string): URL | null {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return null;
    // No local / private addresses.
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/i.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export async function fetchLink(raw: string): Promise<LinkContent | null> {
  const url = safePublicUrl(raw);
  if (!url) return null;

  // Public Telegram post: t.me/<channel>/<n> (or t.me/s/<channel>/<n>).
  const tg = url.hostname.match(/^(?:www\.)?(?:t\.me|telegram\.me)$/i) ? url.pathname.match(/^\/(?:s\/)?([A-Za-z0-9_]{4,64})\/(\d+)\/?$/) : null;
  if (tg) {
    const [, channel, idStr] = tg;
    const id = Number(idStr);
    const { title, posts } = await fetchChannel(channel, id + 1);
    const p = posts.find((x) => x.id === id) ?? posts[posts.length - 1];
    if (!p) return null;
    return {
      url: `https://t.me/${channel}/${id}`,
      kind: "telegram",
      sourceName: `Telegram – ${title}`,
      title: "",
      text: p.text,
      date: p.date,
      media: p.photos.map((u, i) => ({ url: u, kind: p.photoKinds[i] ?? "image" })).slice(0, 4),
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  let html = "";
  try {
    const res = await fetch(url.toString(), { headers: { "User-Agent": UA, "Accept-Language": "he,en;q=0.8,ar;q=0.6" }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return null;
    if (!/text\/html|application\/xhtml/i.test(res.headers.get("content-type") ?? "text/html")) return null;
    html = (await res.text()).slice(0, 1_500_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  const title = meta(html, "og:title") || decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? "").trim();
  const desc = meta(html, "og:description") || meta(html, "description");
  const article = (html.match(/<article\b[\s\S]*?<\/article>/i) ?? [html])[0];
  const paras = [...article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1])).filter((p) => p.length > 40);
  const date = meta(html, "article:published_time") || (html.match(/<time[^>]+datetime=["']([^"']+)["']/i) ?? [])[1] || "";
  const imgs = new Set<string>();
  for (const k of ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]) {
    const v = meta(html, k);
    if (v) imgs.add(new URL(v, url).toString());
  }
  for (const m of article.matchAll(/<img\b[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    if (imgs.size >= 4) break;
    if (/sprite|logo|icon|avatar|pixel|\.svg/i.test(m[1])) continue;
    try { imgs.add(new URL(m[1], url).toString()); } catch { /* skip */ }
  }
  const poster = (html.match(/<video[^>]+poster=["']([^"']+)["']/i) ?? [])[1];
  const media: LinkMedia[] = [...imgs].filter((u) => /^https:\/\//.test(u)).slice(0, 4).map((u) => ({ url: u, kind: "image" as const }));
  if (poster) { try { media.push({ url: new URL(poster, url).toString(), kind: "video_thumb" }); } catch { /* skip */ } }
  return {
    url: url.toString(),
    kind: "web",
    sourceName: meta(html, "og:site_name") || url.hostname.replace(/^www\./, ""),
    title,
    text: [title, desc, paras.join("\n\n")].filter(Boolean).join("\n\n").slice(0, 8000),
    date: date && !isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
    media: media.slice(0, 4),
  };
}
