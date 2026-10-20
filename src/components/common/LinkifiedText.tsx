import { Fragment } from 'react';
import { safeExternalUrl } from '@/utils/url';

const URL_RE = /https?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/g;

function isMapsLink(url: string) {
  try {
    const u = new URL(url);
    return /(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname.startsWith('/maps');
  } catch {
    return false;
  }
}

/**
 * Plain text with web addresses turned into links (new tab, no referrer).
 * Text is never parsed as HTML; only http(s) addresses become links.
 * Google Maps addresses get a short label.
 */
export function LinkifiedText({ text, mapsLabel }: { text: string; mapsLabel: string }) {
  const parts: Array<string | { url: string; label: string }> = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const href = safeExternalUrl(m[0]);
    if (!href) continue;
    if (start > last) parts.push(text.slice(last, start));
    parts.push({ url: href, label: isMapsLink(href) ? mapsLabel : m[0] });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <a
            key={i}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
            className="break-all font-medium text-sky-700 underline decoration-sky-700/30 underline-offset-2 hover:decoration-sky-700 dark:text-sky-400 dark:decoration-sky-400/30"
          >
            {p.label}
          </a>
        ),
      )}
    </>
  );
}
