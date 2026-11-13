// Run: node --experimental-strip-types --test tests/share/eventShare.test.ts
//
// Event share to any app: the system share sheet where it exists, otherwise a menu of WhatsApp,
// Telegram, X and email links. These are the pure link builders behind it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHARE_TARGETS, plainText, shareSheetData, shareTargetUrl } from '../../src/lib/eventShare.ts';

const link = 'https://osintfront.com/e/abc';
const p = { title: 'Strike near Tyre', text: `*Strike near Tyre*\n\nTwo hits on a building.\n\n${link}`, link };

test('plainText drops the WhatsApp bold of the headline only', () => {
  assert.equal(plainText(p.text), `Strike near Tyre\n\nTwo hits on a building.\n\n${link}`);
  assert.equal(plainText('a *word* inside'), 'a *word* inside');
});

test('WhatsApp keeps the text as it always was', () => {
  assert.equal(shareTargetUrl('whatsapp', p), `https://wa.me/?text=${encodeURIComponent(p.text)}`);
});

test('Telegram gets the link once, as the url, and the text without it', () => {
  const u = new URL(shareTargetUrl('telegram', p));
  assert.equal(u.origin + u.pathname, 'https://t.me/share/url');
  assert.equal(u.searchParams.get('url'), link);
  assert.equal(u.searchParams.get('text'), 'Strike near Tyre\n\nTwo hits on a building.');
});

test('X gets the headline and the link, cut to fit', () => {
  const u = new URL(shareTargetUrl('x', p));
  assert.equal(u.searchParams.get('text'), 'Strike near Tyre');
  assert.equal(u.searchParams.get('url'), link);
  const long = new URL(shareTargetUrl('x', { ...p, title: 'x'.repeat(400) }));
  assert.ok(long.searchParams.get('text')!.length <= 256);
  assert.ok(long.searchParams.get('text')!.endsWith('…'));
});

test('email has the headline as subject and plain text as body', () => {
  const u = shareTargetUrl('email', p);
  assert.ok(u.startsWith('mailto:?subject=Strike%20near%20Tyre&body='));
  assert.ok(decodeURIComponent(u.split('body=')[1]).startsWith('Strike near Tyre\n\n'));
});

test('every target builds a link; the share sheet text is plain and capped', () => {
  for (const t of SHARE_TARGETS) assert.ok(shareTargetUrl(t, p).length > 10);
  const big = shareSheetData({ title: 'T', text: 'y'.repeat(5000) });
  assert.equal(big.text.length, 3500);
  assert.equal(shareSheetData(p).text.startsWith('Strike near Tyre'), true);
});
