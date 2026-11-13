// Run: node --experimental-strip-types --test tests/deep/eventTerms.test.ts
//
// The editor's term marks are stored per event: the AI rows are replaced, staff rows stay, and a
// database error never stops the ingest pipeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveEventTerms } from '../../supabase/functions/_shared/eventTerms.ts';

function fakeDb(failUpsert = false) {
  const calls: { op: string; filters: [string, unknown][]; rows?: unknown[]; opts?: unknown }[] = [];
  const db = {
    from(table: string) {
      assert.equal(table, 'event_terms');
      return {
        delete() {
          const c = { op: 'remove', filters: [] as [string, unknown][] };
          calls.push(c);
          const q = { eq(k: string, v: unknown) { c.filters.push([k, v]); return q; }, then(r: (v: unknown) => void) { r({ error: null }); } };
          return q;
        },
        upsert(rows: unknown[], opts: unknown) {
          calls.push({ op: 'upsert', filters: [], rows, opts });
          return failUpsert ? Promise.reject(new Error('boom')) : Promise.resolve({ error: null });
        },
      };
    },
  };
  return { db, calls };
}

const mark = (key: string) => ({ key, keys: [key, `${key} x`], kind: 'person' as const, he: '', en: key, name: key });

test('two marks: AI rows replaced, then upserted', async () => {
  const { db, calls } = fakeDb();
  await saveEventTerms(db, 'E1', [mark('a'), mark('b')]);
  assert.deepEqual(calls.map((c) => c.op), ['remove', 'upsert']);
  assert.deepEqual(calls[0].filters, [['event_id', 'E1'], ['source', 'ai']]);
  const rows = calls[1].rows as Record<string, unknown>[];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].keys, ['a', 'a x']);
  assert.equal(rows[0].source, 'ai');
  assert.equal(rows[0].event_id, 'E1');
});

test('no marks: removal only', async () => {
  const { db, calls } = fakeDb();
  await saveEventTerms(db, 'E1', []);
  assert.deepEqual(calls.map((c) => c.op), ['remove']);
});

test('a failing database never throws', async () => {
  const { db } = fakeDb(true);
  await saveEventTerms(db, 'E1', [mark('a')]);
});
