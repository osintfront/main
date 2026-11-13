// Run: node --experimental-strip-types --test tests/infra/affectedFunctions.test.ts
//
// The deploy workflow redeploys only the Edge Functions a push touches, including through _shared.
import test from 'node:test';
import assert from 'node:assert/strict';
import { affectedFunctions } from '../../tools/functions/affected.mjs';

test('a shared file deploys every function that imports it, directly or not', () => {
  const a = affectedFunctions('.', ['supabase/functions/_shared/terms.ts']);
  for (const n of ['event-agent', 'whatsapp-ingest', 'intel-crawler']) assert.ok(a.includes(n), n);
  assert.ok(!a.includes('admin-otp'));
});

test("a function's own file deploys only that function", () => {
  assert.deepEqual(affectedFunctions('.', ['supabase/functions/admin-otp/index.ts']), ['admin-otp']);
});

test('files outside the functions deploy nothing', () => {
  assert.deepEqual(affectedFunctions('.', ['src/lib/deepTerms.ts', 'README.md']), []);
  assert.deepEqual(affectedFunctions('.', []), []);
});
