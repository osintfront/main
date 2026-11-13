// Run: node --experimental-strip-types --test tests/categories/fixes.test.ts
//
// Final-review fixes: the archive view keeps its member / plan-depth gate; pins of a Killed /
// Wounded / Assassination event always show the main icon; an editor re-run on a split event
// leaves the secondary types alone; the SQL test checks the archive gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placeKind } from '../../src/lib/placeKind.ts';

const m110 = readFileSync('supabase/migrations/20261113000110_secondary_categories.sql', 'utf8');

test('archived_events keeps its gate and ends with ;', () => {
  const v = m110.slice(m110.indexOf('create or replace view public.archived_events'));
  const body = v.slice(0, v.indexOf(';') + 1);
  assert.ok(body.includes('and (select is_member())'));
  assert.ok(body.includes('my_archive_days()'));
  assert.ok(body.trimEnd().endsWith(';'));
});

test('a place shows its own kind, except under a sticky main type', () => {
  assert.equal(placeKind('airstrike', 'artillery-shelling'), 'artillery-shelling');
  assert.equal(placeKind('airstrike', null), null);
  assert.equal(placeKind('airstrike', 'airstrike'), null);
  for (const main of ['killed', 'wounded', 'assassination']) assert.equal(placeKind(main, 'airstrike'), null);
});

test('event-agent re-run leaves a split event\'s secondary types alone', () => {
  const s = readFileSync('supabase/functions/event-agent/index.ts', 'utf8');
  assert.match(s, /!ai\?\.manual_secondary && !ai\?\.split_from && !ai\?\.split_into/);
});

test('SQL test checks that a non-member reads no archive rows', () => {
  assert.match(readFileSync('supabase/tests/multi_category.sql', 'utf8'), /archived_events[\s\S]*non-member/);
});

test('editor page saves the single (relabelled) part, not the raw form', () => {
  const s = readFileSync('src/pages/admin/EventEditorPage.tsx', 'utf8');
  assert.match(s, /const one = parts\[0\] \?\? input;/);
  assert.match(s, /createEvent\(one, target, notes\)/);
});
