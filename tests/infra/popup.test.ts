// Run: node --experimental-strip-types --test tests/infra/popup.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { airfieldPopup, loadInfra, portPopup, type AirfieldProps } from '../../src/lib/infra.ts';

const civil: AirfieldProps = { k: 'civil', n: 'Beirut Rafic Hariri International Airport', t: 'large_airport', icao: 'OLBA', iata: 'BEY', cc: 'LB', el: 87, rw: [{ l: 10000, s: 'ASP', lit: true }] };

test('runways and elevation in metres and feet', () => {
  const h = airfieldPopup(civil, 'en', null);
  assert.ok(h.includes('3048 m (10000 ft)'), h);
  assert.ok(h.includes('87 ft (27 m)'), h);
  assert.ok(h.includes('OLBA') && h.includes('BEY'));
  assert.ok(h.includes('data-infra-traffic'));
  assert.ok(h.includes('OurAirports'));
});

test('military is always "by name"', () => {
  const p: AirfieldProps = { ...civil, k: 'military', n: 'Al Udeid Air Base' };
  assert.ok(airfieldPopup(p, 'en', null).includes('military (by name)'));
  assert.ok(airfieldPopup(p, 'he', null).includes('צבאי (לפי השם)'));
});

test('missing values show a dash, never undefined or NaN', () => {
  const h = airfieldPopup({ k: 'strip', n: 'Some Strip', t: 'small_airport', cc: 'SY' }, 'en', null);
  assert.ok(h.includes('—'));
  assert.ok(!h.includes('undefined') && !h.includes('NaN'), h);
  const p = portPopup({ n: 'Little Port', cc: 'OM' }, 'en', null);
  assert.ok(p.includes('—'));
  assert.ok(!p.includes('undefined') && !p.includes('NaN'), p);
});

test('names from the data are escaped', () => {
  const h = airfieldPopup({ ...civil, n: 'A<b>&"x"' }, 'en', null);
  assert.ok(h.includes('A&lt;b&gt;&amp;&quot;x&quot;'), h);
  assert.ok(!h.includes('<b>'));
});

test('port size, depth and the nearest town', () => {
  const en = portPopup({ n: 'Beirut', cc: 'LB', sz: 'L', ch: 12.5 }, 'en', 'Beirut');
  assert.ok(en.includes('Large') && en.includes('12.5 m'), en);
  assert.ok(en.includes('near Beirut'));
  assert.ok(en.includes('NGA World Port Index'));
  assert.ok(portPopup({ n: 'Beirut', cc: 'LB' }, 'he', 'ביירות').includes('ליד ביירות'));
});

test('each file is fetched once', async () => {
  let calls = 0;
  const fake = (async () => { calls++; return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 }); }) as typeof fetch;
  await loadInfra('airfields', fake);
  await loadInfra('airfields', fake);
  assert.equal(calls, 1);
});

test('a missing file rejects and the next call tries again', async () => {
  let calls = 0;
  const fake = (async () => { calls++; return new Response('not found', { status: 404 }); }) as typeof fetch;
  await assert.rejects(loadInfra('ports', fake));
  await assert.rejects(loadInfra('ports', fake));
  assert.equal(calls, 2);
});

test('cluster bubbles are styled with the class colour and the count', async () => {
  const { clusterIconHtml } = await import('../../src/lib/infra.ts');
  const h = clusterIconHtml(128, '#0284c7');
  assert.ok(h.includes('128') && h.includes('#0284c7'), h);
  assert.ok(clusterIconHtml(5, '#0f766e').includes('width:28px'));
  assert.ok(clusterIconHtml(1500, '#0f766e').includes('width:40px'));
});
