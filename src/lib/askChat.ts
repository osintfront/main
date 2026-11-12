/**
 * "Ask the map" as a conversation — the pure rules (no React, no network):
 * what earlier turns go to the server with a follow-up question, the plain text that
 * Copy / Share produce, and the question the "Summary" button composes.
 */

/** Questions per conversation; after that the user starts a new chat. */
export const MAX_TURNS = 6;
/** Earlier turns sent to the server as context. */
export const HISTORY_TURNS = 5;
const MAX_QUESTION = 500;
const MAX_HISTORY_ANSWER = 1500;
const MAX_PREV_IDS = 40;
/** WhatsApp links stop working on very long text. */
const MAX_SHARE = 3500;

export interface AskTurnLike {
  question: string;
  answer: string;
  /** Cited event ids: [n] in the answer = ids[n-1]. */
  ids: string[];
  events: { id: string; title: string }[];
}

export interface AskContext {
  history: { q: string; a: string }[];
  prev_ids: string[];
}

/** What a follow-up question carries: the last turns, and the events of the newest turn that has any. */
export function buildContext(turns: AskTurnLike[]): AskContext {
  const history = turns.slice(-HISTORY_TURNS).map((t) => ({ q: t.question.slice(0, MAX_QUESTION), a: t.answer.slice(0, MAX_HISTORY_ANSWER) }));
  const withEvents = [...turns].reverse().find((t) => t.ids.length);
  return { history, prev_ids: withEvents ? withEvents.ids.slice(0, MAX_PREV_IDS) : [] };
}

export interface ShareLabels {
  /** Heading of the source list, e.g. "Sources:". */
  sources: string;
  /** Last line, e.g. "osintfront.com". */
  site: string;
}

/** Cut at the last line break that fits, and mark the cut. */
function cutAtLine(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const at = room.lastIndexOf('\n');
  return `${at > 0 ? room.slice(0, at) : room}\n…`;
}

/**
 * The answer as plain text for the clipboard / a share: the question, the answer (citations kept),
 * one "[n] title — link" line per cited event that is loaded, and the site line.
 * Every source line starts with its number and ends with the link, so it reads right in
 * both right-to-left and left-to-right chats.
 */
export function answerShareText(turn: AskTurnLike, siteUrl: string, labels: ShareLabels, max = MAX_SHARE): string {
  const byId = new Map(turn.events.map((e) => [e.id, e]));
  const cited = [...new Set([...turn.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  const sources: string[] = [];
  for (const n of cited) {
    const ev = byId.get(turn.ids[n - 1] ?? '');
    if (ev) sources.push(`[${n}] ${ev.title.replace(/\s+/g, ' ').trim()} — ${siteUrl}/e/${ev.id}`);
  }
  const parts = [turn.question.trim(), turn.answer.trim()];
  if (sources.length) parts.push(`${labels.sources}\n${sources.join('\n')}`);
  return `${cutAtLine(parts.join('\n\n'), max)}\n\n${labels.site}`;
}

/** The ordinary question the "Summary" button sends (the server recognises it as a summary request). */
export function summaryQuestion(area: string, extra: string, lang: 'he' | 'en'): string {
  const a = area.trim();
  const base =
    lang === 'he'
      ? a
        ? `סכם את האירועים ב${a} ב-24 השעות האחרונות.`
        : 'סכם את האירועים ב-24 השעות האחרונות.'
      : a
        ? `Summarise the events in ${a} in the last 24 hours.`
        : 'Summarise the events of the last 24 hours.';
  const more = extra.replace(/\s+/g, ' ').trim();
  return (more ? `${base} ${more}` : base).slice(0, MAX_QUESTION);
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
