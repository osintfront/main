// Run: node --experimental-strip-types --test tests/translate/chain.test.ts
//
// The translation chain's checks: what is sent (no hashtags / links), which language a text is in,
// and which answers count as a real translation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { badOutput, detectLang, stripTags } from '../../api/_lib/translateChain.ts';

test('hashtags, @handles and links are not sent for translation', () => {
  assert.equal(stripTags('الكرملين: يجب أن نعرف نوايا الأوروبيين #العربي'), 'الكرملين: يجب أن نعرف نوايا الأوروبيين');
  assert.equal(stripTags('خبر عاجل @alarabytv https://t.me/x/1\nسطر ثان'), 'خبر عاجل\nسطر ثان');
  assert.equal(stripTags('#عاجل'), '');
  assert.equal(stripTags('Price #1 item'), 'Price item');
});

test('Persian is told apart from Arabic by its common letters', () => {
  assert.equal(detectLang('خانواده علیرضا سپاهی مراسم چهلم برگزار کرد'), 'fa');
  assert.equal(detectLang('قصف مدفعي إسرائيلي استهدف أطراف بلدة الخيام جنوب لبنان'), 'ar');
  assert.equal(detectLang('نماینده ولی فقیه در تهران'), 'fa'); // ی + ه only: no پ چ ژ گ
  assert.equal(detectLang('הקרמלין: עלינו לדעת'), 'he');
  assert.equal(detectLang('The Kremlin says'), 'en');
});

test('a clean translation passes', () => {
  assert.equal(badOutput('הקרמלין: עלינו לדעת את כוונות האירופים', 'he'), null);
});

test('a hashtag or a quoted original word may keep its letters', () => {
  assert.equal(badOutput('הקרמלין: עלינו לדעת את כוונות האירופים לפני שישתפו אותם במשא ומתן #العربي', 'he'), null);
  assert.equal(badOutput('אמר כי "جاویدنامان" (הנצחים) ייזכרו לעד בכל רחבי המדינה ובכל בית', 'he'), null);
});

test('an answer still in Arabic script is refused', () => {
  assert.match(String(badOutput('الكرملين: يجب أن نعرف نوايا الأوروبيين قبل إشراكهم', 'he')), /Arabic/);
  assert.match(String(badOutput('הקרמלין אמר יجب أن نعرف نوايا الأوروبيين قبل إشراكهم', 'he')), /Arabic/);
});

test('an answer in the wrong script is refused', () => {
  assert.match(String(badOutput('Sure! Here is the translation of the text you sent', 'he')), /not in Hebrew/);
  assert.match(String(badOutput('הנה התרגום של הטקסט ששלחת אליי', 'en')), /not in English/);
});
