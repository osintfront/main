import { createLucideIcon } from 'lucide-react';

/**
 * Event icons Lucide does not have, drawn on the same 24×24 stroke grid so they
 * look and size like the rest (map pins, legend, filters, badges).
 */

/** רחפן — small quadcopter seen from above: body, four arms, four rotors. */
export const Quadcopter = createLucideIcon('Quadcopter', [
  ['rect', { x: '9.5', y: '9.5', width: '5', height: '5', rx: '1', key: 'body' }],
  ['path', { d: 'M9.5 9.5 7 7M14.5 9.5 17 7M9.5 14.5 7 17M14.5 14.5 17 17', key: 'arms' }],
  ['circle', { cx: '5.5', cy: '5.5', r: '3', key: 'r1' }],
  ['circle', { cx: '18.5', cy: '5.5', r: '3', key: 'r2' }],
  ['circle', { cx: '5.5', cy: '18.5', r: '3', key: 'r3' }],
  ['circle', { cx: '18.5', cy: '18.5', r: '3', key: 'r4' }],
]);

/** כטב"מ — fixed-wing UAV from above: long straight wings, slim body, V-tail. */
export const FixedWingUav = createLucideIcon('FixedWingUav', [
  ['path', { d: 'M12 4c.8 0 1.2.8 1.2 2v11h-2.4V6c0-1.2.4-2 1.2-2Z', key: 'body' }],
  ['path', { d: 'M2 10h8.8M13.2 10H22', key: 'wings' }],
  ['path', { d: 'm10.8 17-3 2.5M13.2 17l3 2.5', key: 'tail' }],
]);

/** חדירה — an arrow crossing a barbed-wire border fence. */
export const Infiltration = createLucideIcon('Infiltration', [
  ['path', { d: 'M11 3 9 5.25l2 2.25-2 2.25 2 2.25-2 2.25 2 2.25-2 2.25 2 2.25', key: 'fence' }],
  ['path', { d: 'M2 12h19', key: 'arrow' }],
  ['path', { d: 'm17.5 8.5 3.5 3.5-3.5 3.5', key: 'head' }],
]);

/** הפגזה ארטילרית — a field gun: barrel raised, wheel, trail, and a shell's arc. */
export const Artillery = createLucideIcon('Artillery', [
  ['path', { d: 'M4 15 16 7', key: 'barrel' }],
  ['circle', { cx: '9', cy: '17', r: '3', key: 'wheel' }],
  ['path', { d: 'M11.5 15.5 20 18', key: 'trail' }],
  ['path', { d: 'M17 5c2-1.5 3.5-1.5 5 0', key: 'arc' }],
]);
