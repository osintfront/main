// Run: node --experimental-strip-types --test tests/auth/controlRoom.test.ts
//
// Control-room screen: a browser that stays signed in (Max / Intel / staff). These are the rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_ROOM_KEY, controlRoomAllowed, controlRoomOn, sessionAction, setControlRoom } from '../../src/lib/controlRoom.ts';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

test('the choice is kept per browser and can be cleared', () => {
  const s = memory();
  assert.equal(controlRoomOn(s), false);
  setControlRoom(true, s);
  assert.equal(s.m.get(CONTROL_ROOM_KEY), '1');
  assert.equal(controlRoomOn(s), true);
  setControlRoom(false, s);
  assert.equal(controlRoomOn(s), false);
});

test('blocked storage never throws', () => {
  const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
  assert.equal(controlRoomOn(bad), false);
  assert.doesNotThrow(() => setControlRoom(true, bad));
});

test('only plans without idle sign-out (and staff) may use it', () => {
  assert.equal(controlRoomAllowed(true, null), true); // Max, Intel, staff
  assert.equal(controlRoomAllowed(true, 720), false); // Pro
  assert.equal(controlRoomAllowed(true, 30), false); // Free
  assert.equal(controlRoomAllowed(false, null), false); // guest
});

test('the 24-hour clock renews silently in control-room mode', () => {
  const W = 120_000;
  assert.equal(sessionAction(null, W, false), 'none');
  assert.equal(sessionAction(W + 1, W, false), 'none');
  assert.equal(sessionAction(W, W, false), 'warn');
  assert.equal(sessionAction(0, W, false), 'expire');
  assert.equal(sessionAction(W, W, true), 'extend');
  assert.equal(sessionAction(-5, W, true), 'extend');
  assert.equal(sessionAction(W + 1, W, true), 'none');
});
