// Run: node --experimental-strip-types --test tests/eei/visiblePoll.test.ts
// Polling only while the tab is shown; coming back to the tab reads at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pollWhileVisible } from '../../src/lib/visiblePoll.ts';

function fakes() {
  let tick: (() => void) | null = null;
  let onVis: (() => void) | null = null;
  const doc = {
    hidden: false,
    addEventListener: (_: string, f: () => void) => { onVis = f; },
    removeEventListener: () => { onVis = null; },
  };
  const win = {
    setInterval: (f: () => void) => { tick = f; return 1; },
    clearInterval: () => { tick = null; },
  };
  return { doc, win, tick: () => tick?.(), vis: () => onVis?.(), alive: () => !!tick || !!onVis };
}

test('ticks while shown, skips while hidden, reads on return', () => {
  const f = fakes();
  let n = 0;
  const stop = pollWhileVisible(() => n++, 60_000, f.doc, f.win);
  f.tick();
  assert.equal(n, 1);
  f.doc.hidden = true;
  f.tick(); f.tick();
  assert.equal(n, 1);
  f.vis();
  assert.equal(n, 1, 'hiding does not read');
  f.doc.hidden = false;
  f.vis();
  assert.equal(n, 2, 'coming back reads');
  stop();
  assert.equal(f.alive(), false);
});
