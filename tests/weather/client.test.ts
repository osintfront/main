// Run: node --experimental-strip-types --test tests/weather/client.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFrames, fetchGfsManifest, fetchPoint, owmTileUrl, setWeatherAuth } from '../../src/lib/weather.ts';

test('frames: 6 observed hours, now, then 72 forecast hours', () => {
  const f = buildFrames(new Date('2026-11-06T09:41:00Z'));
  assert.equal(f.length, 79);
  assert.deepEqual(f[0], { time: '2026-11-06T03:00:00.000Z', offsetH: -6, kind: 'observed' });
  assert.equal(f[5].kind, 'observed');
  const now = f.find((x) => x.offsetH === 0)!;
  assert.deepEqual(now, { time: '2026-11-06T09:00:00.000Z', offsetH: 0, kind: 'forecast' });
  assert.equal(f[f.length - 1].offsetH, 72);
});

test('a rotated weekly key is fetched again once and the point is retried', async () => {
  setWeatherAuth(async () => 'session-token');
  let keyCalls = 0;
  let pointCalls = 0;
  const fake = (async (url: string, init?: RequestInit) => {
    if (url.includes('key=1')) {
      keyCalls++;
      assert.equal((init?.headers as Record<string, string>)?.authorization, 'Bearer session-token');
      return new Response(JSON.stringify({ k: keyCalls === 1 ? 'old' : 'new' }), { status: 200 });
    }
    pointCalls++;
    if (url.includes('k=old')) return new Response('{}', { status: 403 });
    assert.ok(url.includes('point=33.25,35.2') && url.includes('tz=Asia%2FBeirut') && url.includes('k=new'), url);
    return new Response(JSON.stringify({ updated: 'x', now: {}, hours: [], days: [] }), { status: 200 });
  }) as typeof fetch;
  const out = await fetchPoint(33.25, 35.2, 'Asia/Beirut', fake);
  assert.equal(out.updated, 'x');
  assert.equal(keyCalls, 2);
  assert.equal(pointCalls, 2);
});

test('OpenWeatherMap tiles go through our route with the key', () => {
  assert.equal(owmTileUrl('wind', 'abc'), '/api/weather?tile=wind/{z}/{x}/{y}&k=abc');
});

test('no manifest yet → null', async () => {
  const fake = (async () => new Response('not found', { status: 404 })) as typeof fetch;
  assert.equal(await fetchGfsManifest('https://s.example/storage/v1/object/public/weather/', fake), null);
});

test('manifest is read from the public bucket', async () => {
  let asked = '';
  const fake = (async (url: string) => {
    asked = url;
    return new Response(JSON.stringify({ run: 'r', bounds: [[10, 25], [45, 65]], frames: [{ time: 't', cloud: 'c', rain: 'r' }] }), { status: 200 });
  }) as typeof fetch;
  const m = await fetchGfsManifest('https://s.example/storage/v1/object/public/weather/', fake);
  assert.equal(asked.split('?')[0], 'https://s.example/storage/v1/object/public/weather/gfs/latest.json');
  assert.equal(m?.frames.length, 1);
});
