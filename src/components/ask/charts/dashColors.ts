import { createContext, useContext } from 'react';

/** The dashboard palette as concrete colours for SVG attributes (an image export does not resolve
 *  CSS variables inside SVG). Keep in step with the [data-dash-theme] variables in src/index.css. */
export const DASH_COLORS = {
  light: { bg: '#ffffff', panel: '#f8fafc', ink: '#0f172a', muted: '#64748b', line: '#e2e8f0', accent: '#0284c7', compare: '#94a3b8', hot: '#dc2626', land: '#e2e8f0', target: '#bae6fd' },
  dark: { bg: '#0f172a', panel: '#1e293b', ink: '#f1f5f9', muted: '#94a3b8', line: '#334155', accent: '#38bdf8', compare: '#64748b', hot: '#f87171', land: '#1e293b', target: '#075985' },
} as const;
export type DashColors = (typeof DASH_COLORS)['light' | 'dark'];

export const DashColorsContext = createContext<DashColors>(DASH_COLORS.light);
export const useDashColors = () => useContext(DashColorsContext);
