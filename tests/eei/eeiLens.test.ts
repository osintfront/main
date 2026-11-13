// Run: node --experimental-strip-types --test tests/eei/eeiLens.test.ts
//
// Free-text EEI in the browser: which theatre and topics an event shows for. The server's mark wins
// when there is one (even an empty one); until it arrives keyword + category rules stand in.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_VIEW, EXCEPTIONAL_TOPIC, topicFallback, theatreTopics, theatresOn, eeiMatches, waitingCount, theatreColor,
  mergeTags, lastAt, sanitizeEeiList, sanitizeEeiView, type EeiTheatre, type EeiTopic, type EeiTags,
} from '../../src/lib/eeiLens.ts';

const H = 3600_000;
const NOW = Date.UTC(2026, 10, 12, 10, 0, 0);
// deno-lint-ignore no-explicit-any
const ev = (over: Record<string, unknown> = {}): any => ({
  id: 'e1', title: 'T', description: '', severity: 'high', latitude: 33.27, longitude: 35.2, locationName: 'Tyre',
  locationPrecision: 'city', country: 'Lebanon', region: '', city: '', sourceName: null, sourceUrl: null, sourceType: 'other',
  occurredAt: new Date(NOW - H).toISOString(), publishedAt: null, isBreaking: false, isVerified: false,
  category: { id: null, slug: 'airstrike', name: 'Airstrike', icon: '', color: '', markerColor: '' }, translations: {},
  ...over,
});
const topic = (key: string, over: Partial<EeiTopic> = {}): EeiTopic => ({ key, label: key, priority: false, categories: [], query: '', ...over });
const theatre = (id: string, areas: string[], topics: EeiTopic[], kind: 'theatre' | 'exceptional' = 'theatre'): EeiTheatre => ({ id, hash: kind === 'theatre' ? id : null, kind, name: id, areas, topics });
const tags = (rows: [string, string, string[]][]): EeiTags => {
  const m = new Map<string, Map<string, string[]>>();
  for (const [h, e, t] of rows) {
    if (!m.has(h)) m.set(h, new Map());
    m.get(h)!.set(e, t);
  }
  return m;
};
const NONE: EeiTags = new Map();
const keys = (ts: EeiTopic[]) => ts.map((t) => t.key);

const LEB = theatre('h1', ['lebanon'], [topic('aaaaaaaa', { categories: ['statements'] }), topic('bbbbbbbb', { query: 'הורמוז, hormuz', priority: true })]);

test('a mark wins over the keywords', () => {
  assert.deepEqual(keys(theatreTopics(ev(), LEB, tags([['h1', 'e1', ['aaaaaaaa']]]), EMPTY_VIEW, NOW)), ['aaaaaaaa']);
});

test('an empty mark hides the event even when the keywords fit', () => {
  const e = ev({ category: { slug: 'statements' } });
  assert.equal(topicFallback(e, LEB.topics[0]), true);
  assert.deepEqual(theatreTopics(e, LEB, tags([['h1', 'e1', []]]), EMPTY_VIEW, NOW), []);
});

test('without a mark: category and keyword rules', () => {
  assert.equal(topicFallback(ev({ category: { slug: 'statements' } }), topic('x', { categories: ['statements'] })), true);
  assert.equal(topicFallback(ev({ title: 'Ships in Hormuz' }), topic('x', { query: 'הורמוז, hormuz' })), true);
  const both = topic('x', { categories: ['statements'], query: 'איראן, iran' });
  assert.equal(topicFallback(ev({ category: { slug: 'statements' } }), both), false);
  assert.equal(topicFallback(ev({ category: { slug: 'statements' }, title: 'Iran says' }), both), true);
  assert.equal(topicFallback(ev(), topic('x')), false);
});

test('a keyword only in the English translation is found', () => {
  assert.equal(topicFallback(ev({ title: 'שיט', translations: { en: { title: 'Shipping in Hormuz' } } }), topic('x', { query: 'hormuz' })), true);
});

test('area rule', () => {
  const e = ev({ country: 'Syria', latitude: 36.2, longitude: 37.15 });
  assert.deepEqual(theatreTopics(e, LEB, tags([['h1', 'e1', ['aaaaaaaa']]]), EMPTY_VIEW, NOW), []);
  const any = theatre('h2', [], [topic('aaaaaaaa')]);
  assert.deepEqual(keys(theatreTopics(e, any, tags([['h2', 'e1', ['aaaaaaaa']]]), EMPTY_VIEW, NOW)), ['aaaaaaaa']);
});

test('only the last 24 hours', () => {
  assert.deepEqual(theatreTopics(ev({ occurredAt: new Date(NOW - 25 * H).toISOString() }), LEB, tags([['h1', 'e1', ['aaaaaaaa']]]), EMPTY_VIEW, NOW), []);
});

test('topics switched off', () => {
  const t = tags([['h1', 'e1', ['aaaaaaaa', 'bbbbbbbb']]]);
  assert.deepEqual(keys(theatreTopics(ev(), LEB, t, { ...EMPTY_VIEW, topicsOff: ['h1:aaaaaaaa'] }, NOW)), ['bbbbbbbb']);
  assert.deepEqual(theatreTopics(ev(), LEB, tags([['h1', 'e1', ['aaaaaaaa']]]), { ...EMPTY_VIEW, topicsOff: ['h1:aaaaaaaa'] }, NOW), []);
});

test('priority only', () => {
  const v = { ...EMPTY_VIEW, priorityOnly: true };
  assert.deepEqual(theatreTopics(ev(), LEB, tags([['h1', 'e1', ['aaaaaaaa']]]), v, NOW), []);
  assert.deepEqual(keys(theatreTopics(ev(), LEB, tags([['h1', 'e1', ['aaaaaaaa', 'bbbbbbbb']]]), v, NOW)), ['bbbbbbbb']);
});

test('exceptional events: critical or breaking, any country, not affected by priority only', () => {
  const ex = theatre('exceptional', [], [], 'exceptional');
  const v = { ...EMPTY_VIEW, priorityOnly: true };
  assert.deepEqual(theatreTopics(ev({ severity: 'critical', country: 'Iran' }), ex, NONE, v, NOW), [EXCEPTIONAL_TOPIC]);
  assert.deepEqual(theatreTopics(ev({ isBreaking: true }), ex, NONE, v, NOW), [EXCEPTIONAL_TOPIC]);
  assert.deepEqual(theatreTopics(ev(), ex, NONE, EMPTY_VIEW, NOW), []);
});

test('theatres on', () => {
  assert.deepEqual(theatresOn(null, EMPTY_VIEW), []);
  const list = { theatres: [LEB, theatre('h2', [], [topic('c')])] };
  assert.deepEqual(theatresOn(list, { ...EMPTY_VIEW, off: ['h1'] }).map((t) => t.id), ['h2']);
});

test('an event fitting two theatres is listed for both, in order', () => {
  const other = theatre('h2', [], [topic('aaaaaaaa')]);
  const t = tags([['h1', 'e1', ['aaaaaaaa']], ['h2', 'e1', ['aaaaaaaa']]]);
  assert.deepEqual(eeiMatches(ev(), [LEB, other], t, EMPTY_VIEW, NOW).map((m) => m.theatre.id), ['h1', 'h2']);
});

test('merging marks: idempotent, later wins, input untouched', () => {
  const rows = [{ h: 'h1', e: 'e1', t: ['a'], at: '2026-11-12T08:00:00Z' }];
  const once = mergeTags(NONE, rows);
  assert.deepEqual(mergeTags(once, rows), once);
  const later = mergeTags(once, [{ h: 'h1', e: 'e1', t: [], at: '2026-11-12T09:00:00Z' }]);
  assert.deepEqual(later.get('h1')!.get('e1'), []);
  assert.deepEqual(once.get('h1')!.get('e1'), ['a']);
  assert.equal(NONE.size, 0);
});

test('last mark time', () => {
  assert.equal(lastAt([{ h: 'h', e: 'e', t: [], at: '2026-11-12T08:00:00Z' }, { h: 'h', e: 'f', t: [], at: '2026-11-12T09:00:00Z' }], null), '2026-11-12T09:00:00Z');
  assert.equal(lastAt([], 'p'), 'p');
});

test('events waiting for the AI', () => {
  const evs = [ev({ id: 'a' }), ev({ id: 'b' }), ev({ id: 'c' }), ev({ id: 'd', country: 'Iran', latitude: 35.69, longitude: 51.39 }), ev({ id: 'e', occurredAt: new Date(NOW - 30 * H).toISOString() })];
  const ex = theatre('exceptional', [], [], 'exceptional');
  assert.equal(waitingCount(evs, [LEB, ex], tags([['h1', 'a', []]]), NOW), 2);
});

test('saved list and view are cleaned', () => {
  assert.equal(sanitizeEeiList(null), null);
  assert.equal(sanitizeEeiList('x'), null);
  const l = sanitizeEeiList({ theatres: [
    { id: 'h1', hash: 'h1', kind: 'weird', name: 'Leb', areas: ['lebanon', 5], topics: [{ key: 'k', label: 'L', priority: true, categories: ['x'], query: 'q' }, { label: 'no key' }] },
    { id: 'h2', name: '', topics: [] },
    { name: 'no id' },
  ] })!;
  assert.equal(l.theatres.length, 1);
  assert.equal(l.theatres[0].kind, 'theatre');
  assert.deepEqual(l.theatres[0].areas, ['lebanon']);
  assert.equal(l.theatres[0].topics.length, 1);
  assert.deepEqual(sanitizeEeiView('x'), EMPTY_VIEW);
  assert.deepEqual(sanitizeEeiView({ off: ['a', 5], topicsOff: 'x', priorityOnly: 'yes' }), { off: ['a'], topicsOff: [], priorityOnly: false });
});

test('colours cycle through the set colours', () => {
  assert.equal(theatreColor(0), '#7c3aed');
  assert.equal(theatreColor(6), '#7c3aed');
});

test('keyword fallback sees secondary types', () => {
  const K = ev({ category: { slug: 'killed' }, secondaryCategories: [{ slug: 'airstrike' }] });
  assert.equal(topicFallback(K, { key: 't', label: '', priority: false, categories: ['airstrike'], query: '' }), true);
});
