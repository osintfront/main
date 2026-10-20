import L from 'leaflet';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCategoryIcon, safeColor } from '@/data/categoryRegistry';
import type { Severity } from '@/types/event';

const svgCache = new Map<string, string>();

/** Static SVG markup for a registry icon. Icon names are whitelisted by the registry. */
function iconSvg(iconName: string, size: number): string {
  const key = `${iconName}:${size}`;
  let svg = svgCache.get(key);
  if (!svg) {
    svg = renderToStaticMarkup(
      createElement(getCategoryIcon(iconName), { size, strokeWidth: 2.25, color: '#ffffff', 'aria-hidden': true }),
    );
    svgCache.set(key, svg);
  }
  return svg;
}

interface MarkerIconOptions {
  iconName: string;
  color: string;
  severity: Severity;
  selected: boolean;
  breaking: boolean;
  /** Smaller pin, for many alert places at once. */
  compact?: boolean;
}

const iconCache = new Map<string, L.DivIcon>();

/**
 * Teardrop pin in the category colour with the category icon inside.
 * Only whitelisted icon SVG and a validated hex colour reach the HTML string —
 * no event text is ever interpolated here.
 */
export function createMarkerIcon(opts: MarkerIconOptions): L.DivIcon {
  const color = safeColor(opts.color);
  const key = `${opts.iconName}|${color}|${opts.severity}|${opts.selected ? 1 : 0}|${opts.breaking ? 1 : 0}|${opts.compact ? 1 : 0}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const size = opts.compact ? 26 : opts.selected ? 42 : 34;
  const classes = [
    'ofm-pin',
    `ofm-pin--${opts.severity}`,
    opts.selected ? 'is-selected' : '',
    opts.breaking ? 'is-breaking' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const icon = L.divIcon({
    className: 'ofm-pin-wrap',
    html: `<div class="${classes}" style="--pin-color:${color};--pin-size:${size}px"><span class="ofm-pin__body"><span class="ofm-pin__glyph">${iconSvg(opts.iconName, opts.compact ? 12 : opts.selected ? 18 : 15)}</span></span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size + 2],
  });
  iconCache.set(key, icon);
  return icon;
}
