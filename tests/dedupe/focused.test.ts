// Run: node --experimental-strip-types --test tests/dedupe/focused.test.ts
//
// The dedupe agent asked the cheap model to find twins in ~120 loosely related lines (every
// statement of the last hours qualifies), and it missed ~30 a day: the same statement re-posted
// in another language 10–150 minutes later. The focused pass shows each NEW event only next to
// the few older events whose headlines (Hebrew + English) look most like it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { couldBeSame, focusedPass, headlineSimilarity, textTwin, worthConfirming } from '../../supabase/functions/_shared/dedupeMatch.ts';

const slug = new Map([
  ['c-st', 'statements'], ['c-mil', 'military-activity'], ['c-art', 'artillery-shelling'], ['c-air', 'airstrike'],
]);
let n = 0;
const ev = (o: { title: string; en?: string; cat?: string; country?: string | null; at: string; created?: string; split_from?: string }) => ({
  id: `e${++n}`,
  title: o.title,
  translations: o.en ? { en: { title: o.en } } : {},
  category_id: o.cat ?? 'c-st',
  country: o.country === undefined ? 'Iran' : o.country,
  occurred_at: o.at,
  created_at: o.created ?? o.at,
  ai_suggestions: o.split_from ? { split_from: o.split_from } : {},
});

// Real pairs from 11–12 Nov 2026 that the agent left unmerged.
const rezaeiA = () => ev({ title: 'מוחסן רצאאי: לפי חישובי "השניים", מלחמה חדשה באיראן לא תימשך יותר מ-3 עד 5 ימים', en: 'Mohsen Rezaei: By Their Calculations, a New War on Iran Would Last No More Than 3 to 5 Days', at: '2026-11-11T14:13:11Z' });
const rezaeiB = () => ev({ title: 'האלוף מוחסן רזאיי: אם תתבצע תקיפה חדשה נגד איראן, המלחמה לא תימשך יותר מ-3 עד 5 ימים', en: 'Maj. Gen. Mohsen Rezaei: If new attack on Iran occurs, war will not last beyond 3 to 5 days', at: '2026-11-11T16:29:47Z' });
const qalibafA = () => ev({ title: "קאליבאף לאל-ג'זירה: מוכנים לסייע לסעודיה ולחות'ים ליישב את המחלוקות ביניהם", en: 'Ghalibaf to Al Jazeera: We are ready to help Saudi Arabia and the Houthis resolve their differences', at: '2026-11-11T16:38:52Z' });
const qalibafB = () => ev({ title: "קאליבאף לאל-ג'זירה: אם ארצות הברית או ישראל יתחילו במלחמה, נתמודד מולן יחד", en: 'Qalibaf to Al Jazeera: If US or Israel starts a war, we will confront them together', at: '2026-11-11T16:31:28Z' });

test('the same statement in other words scores far above a different statement', () => {
  const a = rezaeiA(), b = rezaeiB(), other = qalibafB();
  assert.ok(headlineSimilarity(a, b) > 0.3, `twin ${headlineSimilarity(a, b)}`);
  assert.ok(headlineSimilarity(a, other) < 0.1, `other ${headlineSimilarity(a, other)}`);
});

test('Hebrew prefixes and English case do not hide shared words', () => {
  const a = ev({ title: 'שר הביטחון כ"ץ: ישראל תפעל נגד איראן', at: '2026-11-12T09:00:00Z' });
  const b = ev({ title: 'שר הביטחון כץ אמר כי ישראל תפעל נגד איראן', at: '2026-11-12T09:30:00Z' });
  assert.ok(headlineSimilarity(a, b) >= 0.5, String(headlineSimilarity(a, b)));
});

test('a statement filed under another country is still a candidate when the headlines match', () => {
  // Barnea at the Israel Hayom conference: one copy under Israel, one under Iran.
  const a = ev({ title: 'ראש המוסד לשעבר ברנע: הסכם עם איראן ייחשב לפרס, האפשרויות הן מלחמה או סנקציות וסגר מוחלט', en: 'Former Mossad chief Barnea: Deal with Iran would be a prize; options are war or sanctions and total blockade', country: 'Israel', at: '2026-11-11T16:37:11Z' });
  const b = ev({ title: 'ראש המוסד לשעבר ברנע קורא לסגר מלא על מצר הורמוז ולהמשך הסנקציות במקום מלחמה באיראן', en: 'Former Mossad chief Barnea urges full blockade of Strait of Hormuz and sanctions instead of war with Iran', country: 'Iran', at: '2026-11-11T16:53:31Z' });
  assert.equal(couldBeSame(a, b, slug), false, 'the old rule keeps them apart');
  assert.equal(textTwin(a, b, slug), true);
});

test('a near-identical headline crosses statement / military-activity', () => {
  const a = ev({ title: 'דיווח בכאן: סנטקום הנחה את ישראל ומדינות המפרץ להיערך לחידוש אפשרי של המלחמה באיראן', en: 'Kan: CENTCOM tells Israel and Gulf states to prepare for possible resumption of war with Iran', cat: 'c-mil', at: '2026-11-12T18:24:53Z' });
  const b = ev({ title: 'דיווח: סנטקום הנחה את ישראל ומדינות המפרץ להיערך לחידוש אפשרי של המלחמה באיראן', en: 'Report: CENTCOM tells Israel and Gulf states to prepare for possible resumption of war with Iran', at: '2026-11-12T20:48:41Z' });
  assert.equal(couldBeSame(a, b, slug), false);
  assert.equal(textTwin(a, b, slug), true);
});

test('textTwin keeps the time window: the same shelling headline 7 hours later is not a twin', () => {
  const a = ev({ title: 'הפגזה ארטילרית לעבר ואדי אל-חוג\'יר בדרום לבנון', cat: 'c-art', country: 'Lebanon', at: '2026-11-12T08:00:00Z' });
  const b = ev({ title: 'הפגזה ארטילרית לעבר ואדי אל-חוג\'יר בדרום לבנון', cat: 'c-art', country: 'Lebanon', at: '2026-11-12T15:00:00Z' });
  assert.equal(textTwin(a, b, slug), false);
});

test('a loose headline match does not cross kinds or countries', () => {
  const a = ev({ title: 'תקיפה אווירית בחאן יונס', cat: 'c-air', country: 'Palestine', at: '2026-11-12T08:00:00Z' });
  const b = ev({ title: 'דובר צה"ל על התקיפה בחאן יונס', country: 'Israel', at: '2026-11-12T08:10:00Z' });
  assert.equal(textTwin(a, b, slug), false);
});

test('siblings split from one report are never twins', () => {
  const a = ev({ title: 'הפגזה ארטילרית על בני חיאן', cat: 'c-art', country: 'Lebanon', at: '2026-11-13T07:25:00Z', split_from: 'root1' });
  const b = ev({ title: 'הפגזה ארטילרית על בני חיאן', cat: 'c-art', country: 'Lebanon', at: '2026-11-13T07:27:00Z', split_from: 'root1' });
  assert.equal(textTwin(a, b, slug), false);
});

test('focused pass: each NEW event is listed with its closest older events, the twin first', () => {
  const old = rezaeiA(), otherOld = qalibafB();
  const filler = Array.from({ length: 30 }, (_, i) => ev({ title: `הצהרה מספר ${i} של דובר כלשהו בנושא אחר לגמרי ${i * 7}`, at: `2026-11-11T1${i % 6}:0${i % 9}:00Z` }));
  const fresh = rezaeiB();
  const rows = [old, otherOld, ...filler, fresh];
  const out = focusedPass(new Set([fresh.id]), rows, slug, { perEvent: 5 });
  assert.ok(out, 'something to ask');
  const group = out!.groups.find((g) => g.fresh === fresh.id)!;
  assert.equal(group.candidates[0], old.id);
  assert.ok(group.candidates.length <= 5);
  assert.ok(out!.rows.length <= 1 + 5);
  // The lines name both events and the compare section points NEW at its candidates.
  const freshNo = out!.rows.findIndex((r) => r.id === fresh.id) + 1;
  const oldNo = out!.rows.findIndex((r) => r.id === old.id) + 1;
  assert.match(out!.compare, new RegExp(`NEW \\[${freshNo}\\]: .*\\[${oldNo}\\]`));
});

test('focused pass: nothing to ask when no NEW event has a look-alike', () => {
  const fresh = qalibafA();
  const rows = [rezaeiA(), fresh];
  assert.equal(focusedPass(new Set([fresh.id]), rows, slug, { perEvent: 5 }), null);
});

test('focused pass: two NEW twins in one run are compared once', () => {
  const a = rezaeiA(), b = rezaeiB();
  const out = focusedPass(new Set([a.id, b.id]), [a, b], slug, { perEvent: 5 });
  assert.ok(out);
  assert.equal(out!.groups.length, 1);
  assert.equal(out!.rows.length, 2);
});

// 13 Nov: the cheap model found "Israeli forces widening the road from the Sayhan post" (09:35)
// and its re-report four hours later, but at medium confidence, and only high went on to the
// strong model. The strong model is the gate (it must say high); the cheap one only proposes.
test('medium proposals from the cheap model go on to be confirmed; low ones do not', () => {
  assert.equal(worthConfirming('high'), true);
  assert.equal(worthConfirming('medium'), true);
  assert.equal(worthConfirming('low'), false);
  assert.equal(worthConfirming(undefined), false);
});
