// Run: node --experimental-strip-types --test tests/ask/dashExportLayout.test.ts
//
// Statistics dashboard export — the PDF page geometry: the dashboard picture fitted on page 1, the sources
// split into pages, and where each clickable source line sits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A4, PAGE, fitBox, lineRect, paginate } from '../../src/lib/dashExportLayout.ts';

const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

test('fitBox: contain, centred horizontally, top-aligned', () => {
  const a = fitBox(1080, 1200, 523.28, 725.89);
  assert.equal(a.w, 523.28);
  assert.ok(near(a.h, 581.42), String(a.h));
  assert.equal(a.x, 0);
  assert.equal(a.y, 0);
  const b = fitBox(1080, 2000, 523.28, 725.89);
  assert.equal(b.h, 725.89);
  assert.ok(near(b.w, 391.98), String(b.w));
  assert.ok(near(b.x, 65.65), String(b.x));
});

test('paginate', () => {
  assert.deepEqual(paginate([]), []);
  assert.equal(paginate(Array.from({ length: 42 }, (_, i) => i)).length, 1);
  const two = paginate(Array.from({ length: 43 }, (_, i) => i));
  assert.deepEqual(two.map((p) => p.length), [42, 1]);
});

test('lineRect: 16 pt apart, all above the footer', () => {
  assert.ok(lineRect(0).y < lineRect(1).y);
  assert.equal(lineRect(1).y - lineRect(0).y, 16);
  const last = lineRect(41);
  assert.ok(last.y + last.h <= A4.h - PAGE.footer - PAGE.margin);
});
