/// <reference types="node" />
// Shared event links: /e/<id> (rewritten to /api/share?id=<id>).
//
// WhatsApp, Telegram, X and Facebook read the Open Graph tags of this page to draw the link
// preview; a person is sent on to the event on the map at once.
//  · Regular share  (/e/<id>):      the event's headline + its first stored photo
//                                   (or the site's default card when it has none).
//  · Guest share    (/e/<id>?g=1):  the headline + a blurred card that asks to sign up.
// Cost: one small lookup per link, cached on Vercel's CDN for an hour; the photo is the one already
// in storage (no image is generated).
const env = (k: string) => (process.env[k] ?? '').trim();
const URL_ = () => env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
const KEY = () => env('SUPABASE_SERVICE_ROLE_KEY');
const SITE = 'https://osintfront.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rest(path: string): Promise<any[]> {
  const key = KEY();
  const res = await fetch(`${URL_()}/rest/v1/${path}`, {
    headers: { apikey: key, ...(key.startsWith('sb_') ? {} : { authorization: `Bearer ${key}` }) },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) return [];
  return (await res.json().catch(() => [])) as any[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function GET(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const id = u.searchParams.get('id') ?? '';
  const guest = u.searchParams.get('g') === '1';
  const target = UUID.test(id) ? `${SITE}/?event=${id}` : SITE;

  let title = 'OSINTFront · מפת אירועים חיה';
  let image = `${SITE}/share/${guest ? 'guest' : 'default'}.jpg`;
  let width = 1200;
  let height = 630;

  if (UUID.test(id) && URL_() && KEY()) {
    const [ev] = await rest(`events?id=eq.${id}&status=in.(published,archived)&deleted_at=is.null&select=title,translations&limit=1`);
    if (ev) {
      title = String(ev.translations?.he?.title || ev.title || title).slice(0, 200);
      if (!guest) {
        const [m] = await rest(
          `event_media?event_id=eq.${id}&ready=eq.true&kind=in.(image,video_thumb)&order=created_at.asc,id.asc&limit=1&select=public_url,width,height`,
        );
        if (m?.public_url) {
          image = m.public_url;
          width = m.width || 0;
          height = m.height || 0;
        }
      }
    }
  }

  const description = guest ? 'הירשמו בחינם ל-OSINTFront לצפייה באירוע ובמפה החיה' : 'OSINTFront · מפת אירועים חיה במזרח התיכון';
  const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="robots" content="noindex">
<meta property="og:type" content="article">
<meta property="og:site_name" content="OSINTFront">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(`${SITE}/e/${id}`)}">
<meta property="og:image" content="${esc(image)}">
${width && height ? `<meta property="og:image:width" content="${width}"><meta property="og:image:height" content="${height}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<link rel="canonical" href="${esc(target)}">
</head><body><script>location.replace(${JSON.stringify(target)})</script>
<a href="${esc(target)}">${esc(title)}</a></body></html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
