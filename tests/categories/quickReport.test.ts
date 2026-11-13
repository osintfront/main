// Run: node --experimental-strip-types --test tests/categories/quickReport.test.ts
//
// The report form's split (browser side) follows the same secondary-type rules as the server split.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyEventInput, splitByCategory } from '../../src/lib/quickReport.ts';

// deno-lint-ignore no-explicit-any
const cat = (slug: string): any => ({ id: `id-${slug}`, slug, name: slug, description: '', icon: '', color: '', markerColor: '', isActive: true });
const CATS = ['killed', 'airstrike', 'artillery-shelling'].map(cat);
const place = (name: string, slug: string) => ({ name, name_en: name, lat: 33, lng: 35, category_slug: slug });
const run = (main: string, slugs: string[]) =>
  splitByCategory({ ...emptyEventInput(), categoryId: `id-${main}`, locations: slugs.map((s, i) => place(`P${i}`, s)) }, CATS, (c) => c.slug, (n) => `+${n}`);

test('one kind under a Killed report: one event, the kind is secondary, pins show Killed', () => {
  const parts = run('killed', ['airstrike', 'airstrike']);
  assert.equal(parts.length, 1);
  assert.deepEqual(parts[0].secondarySlugs, ['airstrike']);
  assert.deepEqual(parts[0].locations!.map((p) => p.category_slug), ['killed', 'killed']);
});

test('two kinds under a Killed report: the first part stays Killed', () => {
  const parts = run('killed', ['airstrike', 'artillery-shelling']);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].categoryId, 'id-killed');
  assert.deepEqual(parts[0].secondarySlugs, ['airstrike']);
  assert.deepEqual(parts[0].locations!.map((p) => p.category_slug), ['killed']);
  assert.equal(parts[1].categoryId, 'id-artillery-shelling');
  assert.deepEqual(parts[1].secondarySlugs, []);
});

test('two kinds under an Airstrike report: as today', () => {
  const parts = run('airstrike', ['airstrike', 'artillery-shelling']);
  assert.deepEqual(parts.map((p) => p.categoryId), ['id-airstrike', 'id-artillery-shelling']);
  assert.deepEqual(parts.map((p) => p.secondarySlugs), [[], []]);
});
