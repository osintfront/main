// Run: node --experimental-strip-types --test tests/categories/secondary.test.ts
//
// Secondary event types, server side: cleaning what the AI sends, and what a split does to them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { afterSplit, cleanSecondary, MAX_SECONDARY, NEVER_SECONDARY, singleKind, STICKY_MAIN } from '../../supabase/functions/_shared/secondaryCats.ts';

const ALL = new Set(['airstrike', 'killed', 'wounded', 'other', 'uav', 'explosion', 'home-front-alerts', 'uncategorized', 'artillery-shelling', 'drone', 'military-activity']);

test('values', () => {
  assert.equal(MAX_SECONDARY, 2);
  assert.deepEqual([...NEVER_SECONDARY].sort(), ['home-front-alerts', 'other', 'uncategorized']);
  assert.deepEqual([...STICKY_MAIN].sort(), ['assassination', 'killed', 'wounded']);
});

test('cleanSecondary: known, distinct, not the main, at most two', () => {
  assert.deepEqual(cleanSecondary(['airstrike', 'airstrike', 'killed', 'nope', 'other', 7, 'uav'], ALL, 'killed'), ['airstrike', 'uav']);
});

test('cleanSecondary: wounded goes after a kinetic type', () => {
  assert.deepEqual(cleanSecondary(['wounded', 'airstrike', 'explosion'], ALL, 'killed'), ['airstrike', 'explosion']);
  assert.deepEqual(cleanSecondary(['wounded', 'airstrike'], ALL, 'killed'), ['airstrike', 'wounded']);
});

test('cleanSecondary: rubbish and never-secondary types', () => {
  assert.deepEqual(cleanSecondary('airstrike', ALL, null), []);
  assert.deepEqual(cleanSecondary(null, ALL, null), []);
  assert.deepEqual(cleanSecondary(['home-front-alerts', 'uncategorized'], ALL, null), []);
});

test('singleKind: the place kind becomes a secondary type when there is room', () => {
  assert.deepEqual(singleKind({ own: 'killed', secondary: [], kind: 'airstrike' }), { secondary: ['airstrike'], relabelPlaces: true });
  assert.deepEqual(singleKind({ own: 'killed', secondary: ['uav', 'wounded'], kind: 'airstrike' }), { secondary: ['uav', 'wounded'], relabelPlaces: true });
  assert.deepEqual(singleKind({ own: 'airstrike', secondary: ['killed'], kind: 'airstrike' }), { secondary: ['killed'], relabelPlaces: false });
});

test('afterSplit: a sticky main survives and takes the kept kind as secondary', () => {
  assert.deepEqual(afterSplit({ own: 'killed', secondary: ['wounded'], groups: ['airstrike', 'artillery-shelling'] }),
    { keepSlug: 'airstrike', main: 'killed', secondary: ['airstrike', 'wounded'], relabelPlaces: true });
});

test('afterSplit: secondary types that became siblings are dropped', () => {
  const r = afterSplit({ own: 'airstrike', secondary: ['artillery-shelling', 'killed'], groups: ['airstrike', 'artillery-shelling'] });
  assert.equal(r.main, 'airstrike');
  assert.deepEqual(r.secondary, ['killed']);
  assert.equal(r.relabelPlaces, false);
});

test('afterSplit: a plain main is replaced as today', () => {
  const r = afterSplit({ own: 'military-activity', secondary: ['uav'], groups: ['uav', 'drone'] });
  assert.equal(r.main, 'uav');
  assert.deepEqual(r.secondary, []);
  assert.equal(afterSplit({ own: null, secondary: [], groups: ['uav', 'drone'] }).main, 'uav');
});
