// Run: node --experimental-strip-types --test tests/categories/afterEdit.test.ts
// event-agent edit(): flags a person set while the AI was writing (text / secondary types / pin
// corrected by hand) are read fresh after the call — kept, and obeyed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { afterEdit } from '../../supabase/functions/_shared/afterEdit.ts';

test('a flag set during the call is kept and obeyed', () => {
  const fresh = { ai_suggestions: { source: 'x', sent_to_editor: 't', manual_secondary: true, manual_text: true }, coordinates_manually_corrected: true };
  const r = afterEdit(fresh, { editor_model: 'm', countries: ['Lebanon'] });
  assert.deepEqual(r.ai, { source: 'x', sent_to_editor: 't', manual_secondary: true, manual_text: true, editor_model: 'm', countries: ['Lebanon'] });
  assert.equal(r.writeText, false);
  assert.equal(r.writeSecondary, false);
  assert.equal(r.writePlaces, false);
});

test('no flags: everything is written', () => {
  const r = afterEdit({ ai_suggestions: { source: 'x' }, coordinates_manually_corrected: false }, { editor_model: 'm', countries: [] });
  assert.equal(r.writeText, true);
  assert.equal(r.writeSecondary, true);
  assert.equal(r.writePlaces, true);
});

test('a split event keeps its secondary types', () => {
  assert.equal(afterEdit({ ai_suggestions: { split_from: 'a' } }, { editor_model: 'm', countries: [] }).writeSecondary, false);
  assert.equal(afterEdit({ ai_suggestions: { split_into: ['b'] } }, { editor_model: 'm', countries: [] }).writeSecondary, false);
});

test('a missing row or no ai_suggestions is safe', () => {
  const r = afterEdit(null, { editor_model: 'm', countries: [] });
  assert.deepEqual(r.ai, { editor_model: 'm', countries: [] });
  assert.equal(r.writeText, true);
});

test('event-agent reads the event again after the AI call', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('supabase/functions/event-agent/index.ts', 'utf8');
  const body = src.slice(src.indexOf('const r = await editReport('), src.indexOf('const { error } = await db.from("events").update(update).eq("id", id);'));
  assert.match(body, /afterEdit\(/);
  assert.match(body, /select\("ai_suggestions,coordinates_manually_corrected"\)/);
});
