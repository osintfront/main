/**
 * Every (i) beside a map style, an Intelligence layer or a sub-layer: the dictionary key of its text
 * (src/i18n/en.ts and he.ts). tests/i18n/infoTips.test.ts checks each key exists in both languages
 * and stays short; tests/e2e/info-tips.mock.cjs checks each one is on the page.
 */
export const INFO_TIP_KEYS = [
  'info.style.standard',
  'info.style.topo',
  'info.style.cyclosm',
  'info.style.satellite',
  'info.style.hybrid',
  'info.style.light',
  'info.style.dark',
  'info.style.vector',
  'info.sat',
  'info.satSource',
  'info.satCompare',
  'info.fires',
  'info.ships',
  'info.shipsSilent',
  'info.shipKinds',
  'info.planes',
  'info.planesMil',
  'info.planesMilWorld',
  'info.planesEmergency',
  'info.control',
  'info.sects',
  'info.wadis',
  'info.wx.clouds',
  'info.wx.rain',
  'info.wx.temp',
  'info.wx.wind',
  'info.infra.civil',
  'info.infra.military',
  'info.infra.strip',
  'info.infra.closed',
  'info.infra.ports',
  'info.mil.base',
  'info.mil.naval',
  'info.mil.range',
  'info.mil.minor',
  'info.mil.foreignOnly',
] as const;

export type InfoTipKey = (typeof INFO_TIP_KEYS)[number];
