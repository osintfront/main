// Run: node --experimental-strip-types --test tests/filters/setsMinors.test.ts
// Filter sets: default names never repeat; "Clear all" leaves sets past the plan's limit as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSetName, switchOffSets, newSet, type FilterSet } from '../../src/lib/filterSets.ts';

const make = (n: number) => `Set ${n}`;
const named = (...names: string[]): FilterSet[] => names.reduce<FilterSet[]>((a, n) => [...a, newSet(a, n)], []);

test('the first free number, never a name in use', () => {
  assert.equal(defaultSetName([], make), 'Set 1');
  assert.equal(defaultSetName(named('Set 1', 'Set 2'), make), 'Set 3');
  // "Set 1" was deleted: 2 sets left, but "Set 3" exists — no second "Set 3".
  assert.equal(defaultSetName(named('Set 2', 'Set 3'), make), 'Set 1');
  assert.equal(defaultSetName(named('Set 1', 'Set 3'), make), 'Set 2');
  assert.equal(defaultSetName(named('Jordan', 'Set 2'), make), 'Set 1');
});

test('renaming a set to blank: its own old name does not count', () => {
  const sets = named('Set 1', 'Set 2');
  assert.equal(defaultSetName(sets, make, sets[1].id), 'Set 2');
});

test('"Clear all" switches off only the sets within the plan limit', () => {
  const sets = named('a', 'b', 'c');
  const out = switchOffSets(sets, 2);
  assert.deepEqual(out.map((s) => s.enabled), [false, false, true]);
  assert.equal(switchOffSets(out, 2), out, 'nothing to switch off → same array');
});
