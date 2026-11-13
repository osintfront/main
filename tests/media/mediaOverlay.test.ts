// Run: node --experimental-strip-types --test tests/media/mediaOverlay.test.ts
//
// The picture overlay and the subtitles in the browser: where a box lands on a drawn picture, the
// font that fits, each text's direction, the subtitle file, and the shared store of saved readings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boxPx, fitFont, imageRect, overlayBoxes, readingFor, textDir, toVtt, vttTime } from '../../src/lib/mediaOverlay.ts';
import { dropReading, getReading, overlayOn, setOverlayOn, setReading, subscribeReadings } from '../../src/lib/readingStore.ts';
import { mapTranslation, type MediaReadingItem, type MediaTranslation } from '../../src/lib/mediaReading.ts';

test('imageRect and boxPx', () => {
  assert.deepEqual(imageRect({ w: 1000, h: 2000 }, { w: 300, h: 240 }, 'cover'), { left: 0, top: -180, width: 300, height: 600 });
  assert.deepEqual(imageRect({ w: 1000, h: 500 }, { w: 400, h: 400 }, 'contain'), { left: 0, top: 100, width: 400, height: 200 });
  assert.deepEqual(imageRect({ w: 0, h: 0 }, { w: 300, h: 240 }, 'cover'), { left: 0, top: 0, width: 300, height: 240 });
  assert.deepEqual(boxPx([100, 200, 300, 600], { left: 0, top: -180, width: 300, height: 600 }), { left: 60, top: -120, width: 120, height: 120 });
});

test('fitFont', () => {
  assert.equal(fitFont(200, 40, 10), 22);
  assert.equal(fitFont(120, 30, 20), 11);
  assert.equal(fitFont(60, 14, 30), null);
  assert.equal(fitFont(0, 0, 5), null);
});

test('textDir', () => {
  assert.equal(textDir('תוצרת איראן'), 'rtl');
  assert.equal(textDir('Made in Iran'), 'ltr');
  assert.equal(textDir('12 عاجل'), 'rtl');
  assert.equal(textDir(''), 'ltr');
});

const raw = {
  items: [
    {
      media_id: 'p', kind: 'image', thumb: null, description_he: '', description_en: '', speech: null,
      texts: [
        { orig: 'ساخت ایران', lang: 'fa', he: 'תוצרת איראן', en: 'Made in Iran', box: [100, 100, 300, 600] },
        { orig: 'بدون', lang: 'fa', he: 'בלי', en: 'Without' },
        { orig: 'LIVE', lang: 'en', he: 'שידור חי', en: 'live', box: [10, 10, 60, 200] },
      ],
    },
    { media_id: 'v', kind: 'video', thumb: null, description_he: '', description_en: '', texts: [], speech: { state: 'ok', segments: [{ start: 0, end: 2, orig: 'x', he: 'ש', en: 'H' }] } },
  ],
};

test('overlayBoxes', () => {
  const m = mapTranslation(raw)!;
  const en = overlayBoxes(m.items[0], 'en');
  assert.equal(en.length, 1);
  assert.equal(en[0].text, 'Made in Iran');
  assert.equal(en[0].dir, 'ltr');
  const he = overlayBoxes(m.items[0], 'he');
  assert.equal(he.length, 2);
  assert.equal(he[0].dir, 'rtl');
  assert.deepEqual(overlayBoxes(m.items[1], 'en'), []);
  assert.deepEqual(overlayBoxes(null, 'en'), []);
});

test('vttTime and toVtt', () => {
  assert.equal(vttTime(61.5), '00:01:01.500');
  assert.equal(vttTime(3725.04), '01:02:05.040');
  const seg = { start: 0, end: 2.5, orig: 'x', he: 'שלום', en: 'Hello' };
  assert.equal(toVtt([seg], 'en'), 'WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello\n\n');
  assert.equal(toVtt([seg], 'he'), 'WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nשלום\n\n');
  assert.equal(toVtt([{ ...seg, en: 'a --> b\n\n<script>&' }], 'en'), 'WEBVTT\n\n00:00:00.000 --> 00:00:02.500\na → b\n&lt;script>&amp;\n\n');
  assert.equal(toVtt([{ ...seg, he: '', en: 'Only' }], 'he'), 'WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nOnly\n\n');
  assert.equal(toVtt([], 'en'), null);
});

test('readingFor', () => {
  const m = mapTranslation({ items: [{ ...raw.items[0], media_id: 'm-still' }] })!;
  assert.equal(readingFor(m, [null, 'm-still', 'm-file'])!.mediaId, 'm-still');
  assert.equal(readingFor(m, ['zzz']), null);
  assert.equal(readingFor(null, ['m-still']), null);
});

test('the shared store', () => {
  let calls = 0;
  const off = subscribeReadings(() => calls++);
  assert.equal(getReading('e'), undefined);
  const m = mapTranslation({ items: [] }) as MediaTranslation;
  setReading('e', m);
  assert.equal(getReading('e'), m);
  assert.equal(calls, 1);
  setOverlayOn('e', true);
  assert.equal(overlayOn('e'), true);
  assert.equal(calls, 2);
  setOverlayOn('e', true);
  assert.equal(calls, 2);
  dropReading('e');
  assert.equal(getReading('e'), undefined);
  off();
  const before = calls;
  setReading('f', null);
  assert.equal(calls, before);
  void ({} as MediaReadingItem);
});
