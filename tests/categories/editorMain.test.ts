// Run: node --experimental-strip-types --test tests/categories/editorMain.test.ts
// whatsapp-ingest: the editor's own Killed / Wounded / Assassination is not lost when triage chose another main type.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withEditorMain } from '../../supabase/functions/_shared/secondaryCats.ts';

const ALLOWED = ['killed', 'wounded', 'assassination', 'airstrike', 'uav', 'statements', 'other', 'home-front-alerts'];

test('triage airstrike, editor killed + airstrike → main killed, secondary airstrike', () => {
  assert.deepEqual(withEditorMain('airstrike', 'killed', ['airstrike'], ALLOWED), { main: 'killed', secondary: ['airstrike'] });
});

test('triage airstrike, editor killed with nothing else → the attack becomes secondary', () => {
  assert.deepEqual(withEditorMain('airstrike', 'killed', [], ALLOWED), { main: 'killed', secondary: ['airstrike'] });
});

test('room for two: the triage type goes first, then the editor’s', () => {
  assert.deepEqual(withEditorMain('uav', 'killed', ['airstrike', 'wounded'], ALLOWED), { main: 'killed', secondary: ['uav', 'airstrike'] });
});

test('triage already sticky (assassination), editor killed → main stays, killed secondary', () => {
  assert.deepEqual(withEditorMain('assassination', 'killed', ['airstrike'], ALLOWED), { main: 'assassination', secondary: ['killed', 'airstrike'] });
});

test('editor main not sticky, or the same as triage → main unchanged, editor secondary as before', () => {
  assert.deepEqual(withEditorMain('airstrike', 'uav', ['statements'], ALLOWED), { main: 'airstrike', secondary: ['statements'] });
  assert.deepEqual(withEditorMain('killed', 'killed', ['airstrike'], ALLOWED), { main: 'killed', secondary: ['airstrike'] });
  assert.deepEqual(withEditorMain('airstrike', null, ['uav'], ALLOWED), { main: 'airstrike', secondary: ['uav'] });
});

test('a never-secondary triage type (alerts / other) is not moved into secondary', () => {
  assert.deepEqual(withEditorMain('other', 'killed', ['airstrike'], ALLOWED), { main: 'killed', secondary: ['airstrike'] });
});

test('an unknown editor main is ignored', () => {
  assert.deepEqual(withEditorMain('airstrike', 'mystery', ['uav'], ALLOWED), { main: 'airstrike', secondary: ['uav'] });
});

test('wounded from the editor does not take the main place from a known attack (rule: wounded only → attack main)', () => {
  assert.deepEqual(withEditorMain('shooting-gunfire', 'wounded', ['statements'], [...ALLOWED, 'shooting-gunfire']), { main: 'shooting-gunfire', secondary: ['statements', 'wounded'] });
  // no kind of attack known (triage gave "other"): wounded may be the main type
  assert.deepEqual(withEditorMain('other', 'wounded', [], ALLOWED), { main: 'wounded', secondary: [] });
});

test('normalizeTypes: the agreed rules that need no AI', async () => {
  const { normalizeTypes } = await import('../../supabase/functions/_shared/secondaryCats.ts');
  const A = [...ALLOWED, 'shooting-gunfire', 'artillery-shelling', 'humanitarian-event'];
  // an assassination always has Killed
  assert.deepEqual(normalizeTypes('assassination', [], A), { main: 'assassination', secondary: ['killed'] });
  assert.deepEqual(normalizeTypes('assassination', ['airstrike', 'uav'], A), { main: 'assassination', secondary: ['killed', 'airstrike'] });
  // a death announced in a statement: Killed main, the statement secondary
  assert.deepEqual(normalizeTypes('statements', ['killed'], A), { main: 'killed', secondary: ['statements'] });
  // wounded main with a known attack and nobody killed: the attack is main
  assert.deepEqual(normalizeTypes('wounded', ['statements', 'shooting-gunfire'], A), { main: 'shooting-gunfire', secondary: ['statements', 'wounded'] });
  // left alone
  assert.deepEqual(normalizeTypes('killed', ['artillery-shelling', 'wounded'], A), { main: 'killed', secondary: ['artillery-shelling', 'wounded'] });
  assert.deepEqual(normalizeTypes('wounded', [], A), { main: 'wounded', secondary: [] });
  assert.deepEqual(normalizeTypes('humanitarian-event', ['killed'], A), { main: 'humanitarian-event', secondary: ['killed'] });
  assert.deepEqual(normalizeTypes(null, [], A), { main: null, secondary: [] });
});

test('whatsapp-ingest applies normalizeTypes after withEditorMain', async () => {
  const { readFileSync } = await import('node:fs');
  const s = readFileSync('supabase/functions/whatsapp-ingest/index.ts', 'utf8');
  assert.match(s, /const picked = withEditorMain\([\s\S]{0,200}const types = normalizeTypes\(picked\.main, picked\.secondary/);
});

test('triage chose a result (Killed / Wounded), the editor chose the attack: the attack is not lost', () => {
  const A = [...ALLOWED, 'shooting-gunfire', 'artillery-shelling'];
  // wounded only, the attack known → the attack is main, Wounded secondary
  assert.deepEqual(withEditorMain('wounded', 'shooting-gunfire', [], A), { main: 'shooting-gunfire', secondary: ['wounded'] });
  assert.deepEqual(withEditorMain('wounded', 'shooting-gunfire', ['statements'], A), { main: 'shooting-gunfire', secondary: ['statements', 'wounded'] });
  // deaths → Killed stays main, the attack becomes secondary (first)
  assert.deepEqual(withEditorMain('killed', 'airstrike', [], A), { main: 'killed', secondary: ['airstrike'] });
  assert.deepEqual(withEditorMain('killed', 'artillery-shelling', ['wounded'], A), { main: 'killed', secondary: ['artillery-shelling', 'wounded'] });
  assert.deepEqual(withEditorMain('assassination', 'airstrike', [], A), { main: 'assassination', secondary: ['airstrike'] });
  // a statement or catch-all from the editor is not "an attack"
  assert.deepEqual(withEditorMain('killed', 'statements', [], A), { main: 'killed', secondary: [] });
});
