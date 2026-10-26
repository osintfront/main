import { isApproximateLocation, type PublicEvent } from '@/types/event';
import { formatDateTime } from '@/utils/time';
import { hostnameOf, safeExternalUrl } from '@/utils/url';
import { previewText } from '@/utils/text';
import { loadEventMedia, toMediaView } from '@/services/eventMediaService';
import { openLightbox } from '@/lib/lightbox';
import { whereLabel } from '@/utils/places';

export interface PopupLabels {
  categoryLabel: string;
  severityLabel: string;
  verified: string;
  breaking: string;
  viewEvent: string;
  openSource: string;
  approximate: string;
  locale: string;
  dir: 'ltr' | 'rtl';
  /** Staff only: "change location" button. */
  moveLocation?: string;
  /** Staff only: "set place by search" button. */
  locatePlace?: string;
  /** Staff only: the categories this icon can be switched to (slug + label); the current one is categorySlug. */
  categories?: { slug: string; label: string }[];
  categorySlug?: string;
  chipColor?: string;
}

export interface PopupStaffActions {
  onMove?: (id: string) => void;
  onLocate?: () => void;
  onCategory?: (slug: string) => void;
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
  /** Staff only: move the pin (opens the re-pin mode on the map), search its place, change its category. */
  staff: PopupStaffActions = {},
): HTMLElement {
  const onMove = staff.onMove;
  const lang = labels.dir === 'rtl' ? 'he' : 'en';
  const tr = event.translations[lang] ?? {};
  const root = el('div', 'ofm-popup');
  root.dir = labels.dir;

  const meta = el('div', 'ofm-popup__meta');
  if (staff.onCategory && labels.categories?.length) {
    // Staff: the chip is a list — pick another kind for this icon.
    const select = el('select', 'ofm-popup__category ofm-popup__category--edit');
    select.style.setProperty('--chip-color', labels.chipColor ?? event.category.color);
    for (const c of labels.categories) {
      const o = el('option', '', c.label);
      o.value = c.slug;
      if (c.slug === labels.categorySlug) o.selected = true;
      select.append(o);
    }
    select.addEventListener('change', () => {
      select.disabled = true;
      staff.onCategory?.(select.value);
    });
    meta.append(select);
  } else {
    const category = el('span', 'ofm-popup__category', labels.categoryLabel);
    category.style.setProperty('--chip-color', labels.chipColor ?? event.category.color);
    meta.append(category);
  }
  const sev = el('span', `ofm-popup__severity ofm-popup__severity--${event.severity}`, labels.severityLabel);
  meta.append(sev);
  if (event.isBreaking) meta.append(el('span', 'ofm-popup__breaking', labels.breaking));
  root.append(meta);

  // dir=auto per text block: an English report inside the Hebrew UI keeps its own direction.
  const title = el('h3', 'ofm-popup__title', tr.title || event.title);
  title.dir = 'auto';
  root.append(title);

  const where = whereLabel(event, lang);
  const time = formatDateTime(event.occurredAt, labels.locale);
  const sub = el('p', 'ofm-popup__sub');
  if (where) {
    const w = el('bdi', '', where);
    w.dir = 'auto';
    sub.append(w);
    if (isApproximateLocation(event.locationPrecision)) {
      sub.append(el('span', 'ofm-popup__approx', `(${labels.approximate})`));
    }
  }
  if (where && time) sub.append(el('span', 'ofm-popup__sep', '·'));
  if (time) {
    const t = el('bdi', 'ofm-popup__time', time);
    sub.append(t);
  }
  root.append(sub);

  const preview = previewText(tr.summary || tr.description || (lang === 'he' ? event.description : '') || event.description || '');
  if (preview) {
    const text = preview.length > 220 ? `${preview.slice(0, 217).trimEnd()}…` : preview;
    const desc = el('p', 'ofm-popup__desc', text);
    desc.dir = 'auto';
    root.append(desc);
  }

  // Photo / video (filled in once loaded; most events have none).
  const media = el('div', 'ofm-popup__media');
  root.append(media);
  void loadEventMedia(event.id).then((items) => {
    if (!items.length) return;
    const view = toMediaView(items);
    const first = view.videos[0];
    if (first) {
      const v = el('video', 'ofm-popup__video');
      v.src = first.video.url;
      if (first.poster) v.poster = first.poster;
      v.controls = true;
      v.preload = 'none';
      v.playsInline = true;
      media.append(v);
      return;
    }
    const img0 = view.images[0];
    const still = img0 ?? view.stills[0];
    if (still) {
      // Image → full-screen viewer. Video still → the event window, where it plays on demand.
      const b = el('button', 'ofm-popup__image-link');
      b.type = 'button';
      const img = el('img', 'ofm-popup__image');
      img.src = still.url;
      img.alt = '';
      img.loading = 'lazy';
      b.append(img);
      if (!img0) b.append(el('span', 'ofm-popup__play', '▶'));
      b.addEventListener('click', () => (img0 ? openLightbox(img0.url) : onView(event.id)));
      media.append(b);
    }
  });

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
  if (staff.onLocate && labels.locatePlace) {
    const locate = el('button', 'ofm-popup__move', labels.locatePlace);
    locate.type = 'button';
    locate.addEventListener('click', () => staff.onLocate?.());
    footer.append(locate);
  }
  if (onMove && labels.moveLocation) {
    const move = el('button', 'ofm-popup__move', labels.moveLocation);
    move.type = 'button';
    move.addEventListener('click', () => onMove(event.id));
    footer.append(move);
  }
  root.append(footer);

  return root;
}
