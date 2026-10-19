import type { PublicEvent } from '@/types/event';
import { formatDateTime } from '@/utils/time';
import { hostnameOf, safeExternalUrl } from '@/utils/url';

export interface PopupLabels {
  categoryLabel: string;
  severityLabel: string;
  verified: string;
  breaking: string;
  viewEvent: string;
  openSource: string;
  locale: string;
  dir: 'ltr' | 'rtl';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Popup DOM built with textContent only. Event titles, descriptions and
 * source names are user-supplied, so they are never parsed as HTML.
 */
export function buildPopupContent(
  event: PublicEvent,
  labels: PopupLabels,
  onView: (id: string) => void,
): HTMLElement {
  const root = el('div', 'ofm-popup');
  root.dir = labels.dir;

  const meta = el('div', 'ofm-popup__meta');
  const category = el('span', 'ofm-popup__category', labels.categoryLabel);
  category.style.setProperty('--chip-color', event.category.color);
  meta.append(category);
  const sev = el('span', `ofm-popup__severity ofm-popup__severity--${event.severity}`, labels.severityLabel);
  meta.append(sev);
  if (event.isBreaking) meta.append(el('span', 'ofm-popup__breaking', labels.breaking));
  root.append(meta);

  // dir=auto per text block: an English report inside the Hebrew UI keeps its own direction.
  const title = el('h3', 'ofm-popup__title', event.title);
  title.dir = 'auto';
  root.append(title);

  const where = [event.locationName, event.country].filter(Boolean).join(', ');
  const time = formatDateTime(event.occurredAt, labels.locale);
  const sub = el('p', 'ofm-popup__sub');
  if (where) {
    const w = el('bdi', '', where);
    w.dir = 'auto';
    sub.append(w);
  }
  if (where && time) sub.append(el('span', 'ofm-popup__sep', '·'));
  if (time) {
    const t = el('bdi', 'ofm-popup__time', time);
    sub.append(t);
  }
  root.append(sub);

  if (event.description) {
    const text = event.description.length > 220 ? `${event.description.slice(0, 217).trimEnd()}…` : event.description;
    const desc = el('p', 'ofm-popup__desc', text);
    desc.dir = 'auto';
    root.append(desc);
  }

  const footer = el('div', 'ofm-popup__footer');
  if (event.isVerified) footer.append(el('span', 'ofm-popup__verified', `✓ ${labels.verified}`));

  const url = safeExternalUrl(event.sourceUrl);
  if (url) {
    const a = el('a', 'ofm-popup__source', event.sourceName || hostnameOf(url) || labels.openSource);
    a.dir = 'auto';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer nofollow';
    a.title = labels.openSource;
    footer.append(a);
  } else if (event.sourceName) {
    const name = el('bdi', 'ofm-popup__source-name', event.sourceName);
    name.dir = 'auto';
    footer.append(name);
  }

  const button = el('button', 'ofm-popup__view', labels.viewEvent);
  button.type = 'button';
  button.addEventListener('click', () => onView(event.id));
  footer.append(button);
  root.append(footer);

  return root;
}
