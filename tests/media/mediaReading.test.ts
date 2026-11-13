// Run: node --experimental-strip-types --test tests/media/mediaReading.test.ts
//
// Media translation in the browser: the safe mapping of the RPC answer, which translation a reader
// sees, item labels, and the button's state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buttonState, itemLabels, mapTranslation, pairView, pick, type MediaReadingItem, type TextPair } from '../../src/lib/mediaReading.ts';

const pair = (o: Record<string, unknown> = {}) => ({ orig: 'ساخت ایران', lang: 'fa', he: 'תוצרת איראן', en: 'Made in Iran', where_he: 'על הלוח', where_en: 'on the plate', from: 'frame', ...o });
const full = {
  items: [
    { media_id: 'p', kind: 'image', thumb: 'https://x/p.jpg', description_he: 'שבר', description_en: 'A fragment', texts: [pair(), pair({ orig: 'LIVE', lang: 'en' })], speech: null },
    { media_id: 's', kind: 'video', thumb: 'https://x/s.jpg', description_he: 'דובר', description_en: 'A spokesman', texts: [pair({ from: 'video' })],
      speech: { state: 'ok', lang: 'ar', seconds: 60, orig: 'قال', he: 'אמר', en: 'Said', summary_he: 'ת', summary_en: 'S', cut: true } },
  ],
  todo: 1, working: false, failed: false, staff: false, used: 1, limit: 3, budget_left: false,
};

test('mapTranslation: a full answer', () => {
  const m = mapTranslation(full)!;
  assert.equal(m.items.length, 2);
  assert.equal(m.items[0].mediaId, 'p');
  assert.equal(m.items[0].descriptionEn, 'A fragment');
  assert.equal(m.items[0].texts[0].whereHe, 'על הלוח');
  assert.equal(m.items[0].speech, null);
  assert.equal(m.items[1].speech!.summaryEn, 'S');
  assert.equal(m.items[1].speech!.cut, true);
  assert.equal(m.items[1].texts[0].from, 'video');
  assert.equal(m.budgetLeft, false);
  assert.equal(m.todo, 1);
  assert.equal(m.limit, 3);
});

test('mapTranslation: unsafe or bad parts', () => {
  const one = (item: Record<string, unknown>) => mapTranslation({ ...full, items: [{ ...full.items[0], ...item }] })!;
  assert.equal(one({ thumb: 'javascript:alert(1)' }).items[0].thumb, null);
  assert.equal(one({ kind: 'pdf' }).items.length, 0);
  assert.equal(one({ speech: { state: 'ok', orig: 'x' } }).items[0].speech, null, 'no speech on a picture');
  assert.equal(mapTranslation({ ...full, items: [{ ...full.items[1], speech: { state: 'weird' } }] })!.items[0].speech, null);
  assert.equal(one({ texts: [pair({ orig: '' })] }).items[0].texts.length, 0);
  assert.equal(one({ texts: [pair({ from: 'x' })] }).items[0].texts[0].from, 'frame');
  assert.equal(one({ texts: Array.from({ length: 30 }, (_, i) => pair({ orig: `t${i}` })) }).items[0].texts.length, 12);
  assert.equal(mapTranslation({ ...full, todo: -3 })!.todo, 0);
  assert.equal(mapTranslation({ ...full, limit: null })!.limit, null);
  assert.equal(mapTranslation({ items: [] })!.budgetLeft, true);
  assert.equal(mapTranslation(null), null);
  assert.equal(mapTranslation('x'), null);
  assert.equal(mapTranslation({}), null);
});

test('pick and pairView', () => {
  assert.equal(pick('שלום', 'Hello', 'he'), 'שלום');
  assert.equal(pick('', 'Hello', 'he'), 'Hello');
  assert.equal(pick('שלום', '', 'en'), 'שלום');
  const p: TextPair = { orig: 'عاجل', lang: 'ar', he: 'דחוף', en: 'Urgent', whereHe: 'בכותרת', whereEn: 'in the banner', from: 'video' };
  assert.equal(pairView(p, 'he').translation, 'דחוף');
  assert.equal(pairView(p, 'en').translation, 'Urgent');
  assert.equal(pairView(p, 'en').where, 'in the banner');
  assert.equal(pairView({ ...p, lang: 'he' }, 'he').translation, null);
  assert.equal(pairView({ ...p, lang: 'und', orig: 'LIVE', en: 'live' }, 'en').translation, null);
  assert.equal(pairView({ ...p, he: '' }, 'he').translation, 'Urgent');
});

test('itemLabels', () => {
  const it = (kind: 'image' | 'video') => ({ kind }) as MediaReadingItem;
  assert.deepEqual(itemLabels([it('image'), it('video'), it('image')]), [{ key: 'mt.image', n: 1 }, { key: 'mt.video', n: 1 }, { key: 'mt.image', n: 2 }]);
});

test('buttonState', () => {
  const data = mapTranslation(full)!;
  const b = (o: Partial<Parameters<typeof buttonState>[0]>) => buttonState({ hasMedia: true, expandOpen: true, allowed: true, data, ...o });
  assert.equal(b({ hasMedia: false }), 'hidden');
  assert.equal(b({ expandOpen: false }), 'hidden');
  assert.equal(b({ allowed: false }), 'locked');
  assert.equal(b({ data: undefined }), 'loading');
  assert.equal(b({ data: null }), 'locked');
  assert.equal(b({ data: { ...data, items: [] } }), 'translate');
  assert.equal(b({ data: { ...data, todo: 0 } }), 'show');
  assert.equal(b({ data: { ...data, todo: 2 } }), 'show_more');
});
