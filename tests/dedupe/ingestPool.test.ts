// Run: node --experimental-strip-types --test tests/dedupe/ingestPool.test.ts
// The ingest looks back 8 hours for a report of the same incident, but loaded only the newest
// 100 events — about 2 hours on an average day (~425 events in 8 h, up to ~740).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('supabase/functions/whatsapp-ingest/index.ts', 'utf8');

test('the duplicate pool is big enough for the 8-hour lookback', () => {
  const hours = Number(src.match(/const DUP_LOOKBACK_H = (\d+);/)?.[1]);
  const rows = Number(src.match(/const DUP_POOL_ROWS = (\d+);/)?.[1]);
  assert.equal(hours, 8);
  assert.ok(rows >= 100 * hours, `rows ${rows}`);
  assert.match(src, /\.limit\(DUP_POOL_ROWS\)/);
  assert.doesNotMatch(src, /\.order\("occurred_at", \{ ascending: false \}\)\s*\.limit\(100\);\s*const candidates/);
});
