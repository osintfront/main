// Run: node --experimental-strip-types --test tests/ofi/normalize.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ratioScore, balanceVsBaseline, shareShift, latestReturnZ, zToScore, levelChangeScore,
  marketTo24h, fcdoLevel, stateDeptLevel, clamp01, embassyDepartures,
} from '../../supabase/functions/_shared/ofi/normalize.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('neutral inputs give 0.5', () => {
  near(ratioScore(10, 10), 0.5);
  near(balanceVsBaseline(5, 5, 5, 5), 0.5);
  near(shareShift(2, 10, 0.2), 0.5);
  near(levelChangeScore(3, [3, 3]).score, 0.5);
  near(zToScore(0), 0.5);
});

test('ratioScore rises with activity and is bounded', () => {
  assert.ok(ratioScore(30, 10) > 0.7 && ratioScore(30, 10) < 1);
  assert.ok(ratioScore(0, 10) < 0.1);
  near(ratioScore(0, 0), 0.5); // quiet day vs quiet baseline: no evidence
});

test('balanceVsBaseline: more escalation than usual > 0.5', () => {
  assert.ok(balanceVsBaseline(20, 2, 10, 10) > 0.7);
  assert.ok(balanceVsBaseline(2, 20, 10, 10) < 0.3);
});

test('latestReturnZ: a jump stands out against calm history', () => {
  const calm = Array.from({ length: 40 }, (_, i) => 100 * (1 + 0.001 * Math.sin(i)));
  const z = latestReturnZ([...calm, calm[calm.length - 1] * 1.05])!;
  assert.ok(z > 5, `z=${z}`);
  assert.equal(latestReturnZ([1, 2, 3]), null);
});

test('levelChangeScore counts only changes', () => {
  assert.deepEqual(levelChangeScore(4, [3, 3]), { delta: 1, score: 0.7 });
  const down = levelChangeScore(2, [3]);
  assert.equal(down.delta, -1);
  near(down.score, 0.3);
});

test('marketTo24h: constant hazard over the remaining time', () => {
  near(marketTo24h(0.3, 24)!, 0.3);
  near(marketTo24h(0.3, 12)!, 0.3);
  near(marketTo24h(0.5, 48)!, 1 - Math.sqrt(0.5));
  assert.ok(marketTo24h(0.3, 24 * 30)! < 0.013);
  assert.equal(marketTo24h(0.3, -1), null);
});

test('advisory parsers', () => {
  assert.equal(fcdoLevel(['avoid_all_but_essential_travel_to_parts', 'avoid_all_travel_to_parts']), 3);
  assert.equal(fcdoLevel([]), 1);
  const rss = '<rss><item><title><![CDATA[Israel, the West Bank and Gaza - Level 3: Reconsider Travel]]></title></item><item><title>Iran - Level 4: Do Not Travel</title></item></rss>';
  assert.equal(stateDeptLevel(rss, 'Israel'), 3);
  assert.equal(stateDeptLevel(rss, 'Iran'), 4);
  assert.equal(stateDeptLevel(rss, 'France'), null);
});

test('clamp01 maps NaN to neutral', () => {
  near(clamp01(NaN), 0.5);
  near(clamp01(2), 1);
});

test('embassyDepartures: ordered = 2, authorized = 1, other countries ignored', () => {
  const rss = `<rss><item><title>Iraq - Level 4: Do Not Travel</title><description><![CDATA[On June 11 the Department <b>ordered the departure</b> of non-emergency staff.]]></description></item>
<item><title>Kuwait - Level 3: Reconsider Travel</title><description>The Department authorized departure of family members.</description></item>
<item><title>China - Level 2</title><description>ordered departure</description></item>
<item><title>Qatar - Level 3</title><description>Nothing new.</description></item></rss>`;
  const r = embassyDepartures(rss, ['Iraq', 'Kuwait', 'Qatar']);
  assert.equal(r.total, 3);
  assert.deepEqual(r.hits, [{ country: 'Iraq', kind: 'ordered' }, { country: 'Kuwait', kind: 'authorized' }]);
  assert.equal(embassyDepartures(rss, ['Qatar']).total, 0);
});
