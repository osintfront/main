/**
 * Sharing an event to any app. On phones (and browsers that have it) the system share sheet opens and
 * lists every installed app; elsewhere a small menu offers WhatsApp, Telegram, X, email and copying.
 * text = what the WhatsApp share always sent (headline, summary, link, site line); link = /e/<id>.
 */
export type ShareTarget = 'whatsapp' | 'telegram' | 'x' | 'email';
export const SHARE_TARGETS: ShareTarget[] = ['whatsapp', 'telegram', 'x', 'email'];

const MAX_TEXT = 3500;
/** X counts every link as 23 characters; the post is the headline + the link. */
const X_MAX = 280 - 24;

/** WhatsApp bold (*…*) means nothing to other apps. */
export function plainText(text: string): string {
  return text.replace(/(^|\n)\*([^*\n]+)\*(?=\n|$)/g, '$1$2');
}

export function shareTargetUrl(target: ShareTarget, p: { title: string; text: string; link: string }): string {
  const text = p.text.slice(0, MAX_TEXT);
  const e = encodeURIComponent;
  switch (target) {
    case 'whatsapp':
      return `https://wa.me/?text=${e(text)}`;
    case 'telegram': {
      // Telegram puts the link first and the text under it: the text without the link.
      const body = plainText(text).split('\n\n').filter((s) => s.trim() !== p.link).join('\n\n');
      return `https://t.me/share/url?url=${e(p.link)}&text=${e(body)}`;
    }
    case 'x': {
      const head = p.title.length > X_MAX ? `${p.title.slice(0, X_MAX - 1)}…` : p.title;
      return `https://x.com/intent/post?text=${e(head)}&url=${e(p.link)}`;
    }
    case 'email':
      return `mailto:?subject=${e(p.title)}&body=${e(plainText(text))}`;
  }
}

/** What the share sheet gets: plain text that already ends with the link (so no separate url field). */
export function shareSheetData(p: { title: string; text: string }): { title: string; text: string } {
  return { title: p.title, text: plainText(p.text).slice(0, MAX_TEXT) };
}
