// Public Telegram channels, read from their web preview (https://t.me/s/<name>).
// No login, no bot: only channels that are public can be read this way.

export interface TgPost {
  id: number; // message number in the channel
  post: string; // "<channel>/<id>"
  url: string; // https://t.me/<channel>/<id>
  date: string | null; // ISO
  text: string;
  photos: string[]; // image URLs (telesco.pe CDN)
  forwardedFrom: string | null;
}

const UA = "Mozilla/5.0 (compatible; OsintfrontBot/1.0; +https://main-drab-chi.vercel.app)";

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

/** Message HTML → plain text: <br> = new line, links keep their address. */
function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
        const label = inner.replace(/<[^>]+>/g, "");
        const url = decode(href);
        // Show the address when the visible text is not already that address.
        return /^https?:\/\//.test(url) && !label.includes(url.replace(/^https?:\/\//, "").slice(0, 20)) && !url.startsWith("https://t.me/")
          ? `${label} (${url})`
          : label;
      })
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function channelName(input: string): string | null {
  const m = String(input).trim().match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]{4,64})\/?$/i) ??
    String(input).trim().match(/^@?([A-Za-z0-9_]{4,64})$/);
  return m ? m[1] : null;
}

export async function fetchChannel(name: string, before?: number): Promise<{ title: string; posts: TgPost[] }> {
  const url = `https://t.me/s/${encodeURIComponent(name)}${before ? `?before=${before}` : ""}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  let html: string;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "he,en;q=0.8" }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(t);
  }
  const title = decode((html.match(/<meta property="og:title" content="([^"]*)"/) ?? [])[1] ?? name);
  if (!/tgme_channel_info|tgme_widget_message/.test(html)) throw new Error("not a public channel (no web preview)");

  const posts: TgPost[] = [];
  // Each message starts at its data-post attribute; cut the page at those points.
  const starts = [...html.matchAll(/data-post="([A-Za-z0-9_]+)\/(\d+)"/g)];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const chunk = html.slice(s.index!, i + 1 < starts.length ? starts[i + 1].index! : html.length);
    const id = Number(s[2]);
    const textHtml = (chunk.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/) ?? [])[1] ?? "";
    const date = (chunk.match(/<time[^>]*datetime="([^"]+)"/) ?? [])[1] ?? null;
    const photos = [...chunk.matchAll(/tgme_widget_message_(?:photo_wrap|video_thumb)[^"]*"[^>]*background-image:url\('([^']+)'\)/g)]
      .map((m) => m[1])
      .filter((u) => /^https:\/\//.test(u))
      .slice(0, 4);
    const fwd = (chunk.match(/tgme_widget_message_forwarded_from_name[^>]*>(?:<span[^>]*>)?([^<]+)/) ?? [])[1];
    posts.push({
      id,
      post: `${s[1]}/${id}`,
      url: `https://t.me/${s[1]}/${id}`,
      date: date && !isNaN(new Date(date).getTime()) ? new Date(date).toISOString() : null,
      text: htmlToText(textHtml),
      photos,
      forwardedFrom: fwd ? decode(fwd).trim() : null,
    });
  }
  posts.sort((a, b) => a.id - b.id);
  return { title, posts };
}

/** Download an image and return it base64-encoded (for storeMedia). */
export async function imageAsBase64(url: string): Promise<{ data: string; mime: string } | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0];
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length || buf.length > 2_000_000) return null;
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { data: btoa(bin), mime };
  } catch {
    return null;
  }
}
