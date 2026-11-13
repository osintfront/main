// Run: node --experimental-strip-types --test tests/deep/deepTerms.test.ts
//
// Deep analysis in the browser: which words of the event window become term links (whole words,
// Hebrew prefix letters, longest name first, once per term), the "Analyze" selection, and cleaning
// of the RPC answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { linkSegments, mapEntry, sanitizeTerms, selectionTerm, type EventTerm, type Segment } from '../../src/lib/deepTerms.ts';

const T = (key: string, ...surfaces: string[]): EventTerm => ({ key, name: key, kind: 'term', surfaces, entry: null });
const join = (s: Segment[]) => s.map((x) => (typeof x === 'string' ? x : x.text)).join('');
const links = (s: Segment[]) => s.filter((x): x is { text: string; term: EventTerm } => typeof x !== 'string');
const check = (text: string, terms: EventTerm[], used?: Set<string>) => {
  const s = linkSegments(text, terms, used);
  assert.equal(join(s), text, `joined: ${text}`);
  return s;
};

test('english words', () => {
  const h = T('heron', 'Heron');
  assert.deepEqual(check('Heron drone over Tyre', [h]), [{ text: 'Heron', term: h }, ' drone over Tyre']);
  assert.equal(links(check('A heron-type drone', [h]))[0].text, 'heron');
  assert.deepEqual(check('Sheron left', [h]), ['Sheron left']);
  assert.equal(links(check('Herons fly', [h])).length, 0);
});

test('hebrew prefix letters', () => {
  const z = T('hezbollah', 'חיזבאללה');
  const s = check('ירי לחיזבאללה בדרום', [z]);
  assert.deepEqual(s.map((x) => (typeof x === 'string' ? x : `[${x.text}]`)), ['ירי ל', '[חיזבאללה]', ' בדרום']);
  assert.equal(links(check('מחיזבאללהים', [z])).length, 0);
  assert.equal(links(check('שלחיזבאללה', [z])).length, 0);
});

test('longest name wins, no overlap', () => {
  const s = check("Hezbollah's Radwan Force fired", [T('hezbollah', 'Hezbollah'), T('radwan', "Hezbollah's Radwan Force")]);
  const l = links(s);
  assert.equal(l.length, 1);
  assert.equal(l[0].term.key, 'radwan');
});

test('regex characters, first appearance, used keys', () => {
  assert.equal(links(check('C-4 (explosive) found', [T('c4', 'C-4 (explosive)')])).length, 1);
  assert.equal(links(check('Heron and Heron', [T('heron', 'Heron')])).length, 1);
  assert.equal(links(check('Heron', [T('heron', 'Heron')], new Set(['heron']))).length, 0);
  const used = new Set<string>();
  check('xy marks', [T('x', 'xy')], used);
  assert.ok(used.has('x'));
});

test('edges', () => {
  assert.deepEqual(linkSegments('', [T('a', 'abc')]), []);
  assert.deepEqual(linkSegments('abc', []), ['abc']);
  assert.equal(links(check('a b', [T('k', '', 'a')])).length, 0);
});

test('selection', () => {
  assert.equal(selectionTerm('  Ted Cruz '), 'Ted Cruz');
  assert.equal(selectionTerm('a'), null);
  assert.equal(selectionTerm('x'.repeat(81)), null);
  assert.equal(selectionTerm('two\nlines'), null);
});

test('sanitizeTerms', () => {
  for (const v of [null, 'x', [5, {}, { key: 'k', name: 'N', kind: 'animal', surfaces: ['N'] }]]) assert.deepEqual(sanitizeTerms(v), []);
  const good = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, name: 'N', kind: 'term', surfaces: ['N'], entry: null }));
  assert.equal(sanitizeTerms(good).length, 12);
  assert.deepEqual(sanitizeTerms([{ key: 'k', name: 'N', kind: 'term', surfaces: 'N' }]), []);
  assert.equal(sanitizeTerms([{ key: 'k', name: 'N', kind: 'term', surfaces: ['N'], entry: 7 }])[0].entry, null);
});

test('mapEntry', () => {
  const row = {
    id: 'E', kind: 'weapon', name_he: 'הרון', name_en: 'Heron', name_orig: '', aliases: ['heron'], summary_he: 'ס', summary_en: 'S',
    sections: [{ key: 'use', he: 'a', en: 'b' }, { key: 'gossip', he: 'g', en: 'g' }], sources: [{ title: 'T', url: 'https://a.example', from: 'web' }],
    image: { url: 'https://upload.wikimedia.org/a.jpg', page: 'https://commons.wikimedia.org/wiki/File:A.jpg', credit: 'J', license: 'CC BY 2.0', license_url: null },
    events: ['e1'], version: 2, updated_at: '2026-11-13T00:00:00Z', edited_at: null,
  };
  const e = mapEntry(row)!;
  assert.equal(e.nameEn, 'Heron');
  assert.equal(e.summaryHe, 'ס');
  assert.deepEqual(e.sections.map((s) => s.key), ['use']);
  assert.equal(e.image!.licenseUrl, null);
  assert.equal(e.version, 2);
  assert.equal(mapEntry({ ...row, image: { ...row.image, url: 'https://evil.example/a.jpg' } })!.image, null);
  assert.equal(mapEntry(null), null);
  assert.equal(mapEntry({ ...row, id: undefined }), null);
});

test('mapEntry accepts the new Wikimedia thumbnail host', () => {
  const e = mapEntry({ id: 'E', kind: 'person', image: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a.jpg', page: 'https://commons.wikimedia.org/wiki/File:A.jpg', credit: 'X', license: 'Public domain' } })!;
  assert.ok(e.image);
});

test('mapEntry keeps where a source came from', () => {
  const e = mapEntry({ id: 'E', kind: 'org', sources: [{ title: 'T', url: 'https://t.me/x/1', from: 'event' }, { title: 'W', url: 'https://w.example', from: 'web' }] })!;
  assert.deepEqual(e.sources.map((s) => s.from), ['event', 'web']);
});

test('segmentsInOrder: a term links once across the texts, and running it twice gives the same (no shared state)', async () => {
  const { segmentsInOrder } = await import('../../src/lib/deepTerms.ts');
  const h = T('heron', 'Heron');
  const r = T('radwan', 'Radwan');
  const before = new Set<string>(['radwan']); // linked in the headline already
  const run = () => segmentsInOrder(['Heron over Radwan', 'Heron again'], [h, r], before);
  const a = run();
  const b = run();
  assert.deepEqual(a, b, 'the same answer on a second render');
  assert.equal(links(a[0]).length, 1);
  assert.equal(links(a[0])[0].term.key, 'heron');
  assert.equal(links(a[1]).length, 0, 'heron already linked above');
  assert.deepEqual([...before], ['radwan'], 'the given set is not changed');
});

test('entrySources: our events follow source_link and sources_detail; web sources always link', async () => {
  const { entrySources } = await import('../../src/lib/deepTerms.ts');
  const src = [{ title: 'Ch', url: 'https://t.me/x/1', from: 'event' as const }, { title: 'W', url: 'https://w.example', from: 'web' as const }];
  // Max: links everywhere.
  assert.deepEqual(entrySources(src, { sourceLink: true, detail: 'links' }), [{ title: 'Ch', url: 'https://t.me/x/1' }, { title: 'W', url: 'https://w.example' }]);
  // Pro (sources_detail limit 1): our event's source by name only.
  assert.deepEqual(entrySources(src, { sourceLink: true, detail: 'names' }), [{ title: 'Ch', url: null }, { title: 'W', url: 'https://w.example' }]);
  // No sources_detail, or no source_link: our event's source is not shown.
  assert.deepEqual(entrySources(src, { sourceLink: true, detail: 'none' }), [{ title: 'W', url: 'https://w.example' }]);
  assert.deepEqual(entrySources(src, { sourceLink: false, detail: 'links' }), [{ title: 'W', url: 'https://w.example' }]);
});
