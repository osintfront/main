import type { HfcAlert } from '@/types/hfcAlert';
import { formatDateTime } from '@/utils/time';

export interface HfcPopupLabels {
  category: string;
  threat: string;
  color: string;
  areas: string[];
  zones: string[];
  started: string;
  lastAlert: string;
  clearsAt: string;
  alertsCount: string;
  more: (n: number) => string;
  locale: string;
  dir: 'ltr' | 'rtl';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const MAX_AREAS = 14;

/** Popup for an alert polygon. textContent only — area names come from an external feed. */
export function buildHfcPopup(alert: HfcAlert, labels: HfcPopupLabels): HTMLElement {
  const root = el('div', 'ofm-popup ofm-popup--hfc');
  root.dir = labels.dir;

  const meta = el('div', 'ofm-popup__meta');
  const category = el('span', 'ofm-popup__category', labels.category);
  category.style.setProperty('--chip-color', labels.color);
  meta.append(category);
  const live = el('span', 'ofm-popup__breaking', labels.threat);
  live.style.background = labels.color;
  meta.append(live);
  root.append(meta);

  const single = labels.areas.length === 1;
  const title = el('h3', 'ofm-popup__title', single ? labels.areas[0] : labels.zones.join(', ') || labels.areas.slice(0, 3).join(', '));
  title.dir = 'auto';
  root.append(title);

  const sub = el('p', 'ofm-popup__sub');
  sub.append(el('bdi', 'ofm-popup__time', `${labels.started} ${formatDateTime(alert.startedAt, labels.locale)}`));
  sub.append(el('span', 'ofm-popup__sep', '·'));
  sub.append(el('bdi', 'ofm-popup__time', `${labels.lastAlert} ${formatDateTime(alert.lastAlertAt, labels.locale)}`));
  root.append(sub);

  const shown = labels.areas.slice(0, MAX_AREAS).join(', ');
  const rest = labels.areas.length - MAX_AREAS;
  const desc = el('p', 'ofm-popup__desc', single ? labels.zones.join(', ') : rest > 0 ? `${shown} ${labels.more(rest)}` : shown);
  desc.dir = 'auto';
  root.append(desc);

  const footer = el('div', 'ofm-popup__footer');
  footer.append(el('span', 'ofm-popup__source-name', labels.alertsCount));
  footer.append(el('span', 'ofm-popup__hfc-clear', labels.clearsAt));
  root.append(footer);
  return root;
}
