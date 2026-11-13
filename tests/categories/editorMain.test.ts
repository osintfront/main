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
