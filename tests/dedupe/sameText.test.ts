// Run: node --experimental-strip-types --test tests/dedupe/sameText.test.ts
// 13 Nov: a ~600-word analysis of Israeli drone routes over Lebanon (rodwan313/257905) was merged,
// with no AI call, into "قصف مدفعي استهدف وادي زبقين _ جنوب لبنان" as "same text as an event from
// the last hour": 6 of the short report's 7 words appear somewhere in the long text, and the
// containment rule took that as a copy. Containment now needs copies of about the same length.
// The same day's IntelSky analysis (257904) was dropped as "commentary, not an event".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const src = readFileSync('supabase/functions/whatsapp-ingest/index.ts', 'utf8');
const cut = (from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  assert.ok(a >= 0 && b > a, from);
  return src.slice(a, b);
};
// The pure matching code, lifted out of the edge function (it imports Deno-only modules).
const code = [
  cut('const WORD =', '/** The events most likely'),
  cut('/** Share of words two reports', '/** Does a candidate event concern'),
  'export { obviousDuplicate };',
].join('\n');
const dir = mkdtempSync(join(tmpdir(), 'sametext-'));
const file = join(dir, 'm.ts');
writeFileSync(file, code);
const { obviousDuplicate } = await import(pathToFileURL(file).href);

const at = new Date('2026-11-13T22:09:08Z');
const ev = (id: string, text: string, min = -15) => ({ id, original_report_text: text, occurred_at: new Date(at.getTime() + min * 60000).toISOString() });

const analysis = `التاريخ : ١٣ / ١١ / ٢٠٢٦
تحليل للمسارات التي سلكتها المسيرات الإسرائيلية اليوم
تُظهر الخرائط السبع المرفقة تنفيذ سلاح الجو الإسرائيلي عملية مسح استخباراتي شاملة ومتزامنة تغطي العمق اللبناني من الساحل إلى البقاع عبر محاور اختراق بحرية وبرية محددة.
• الجنوب والزهراني. تغطي المسارات مثلث صور وبنت جبيل ومرجعيون وتمتد شمالاً عبر الساحل نحو النبطية. يركز هذا الانتشار على مراقبة الأودية وطرق الإمداد الرابطة بين جنوب الليطاني وشماله.
• وادي البقاع من زحلة إلى بعلبك. يسلك المسار محوراً طولياً بمحاذاة السفوح الغربية لسلسلة جبال لبنان الشرقية.
• توجيه النيران الميدانية. يتقاطع وجود بؤر الرصد المكثف في بلدات مثل طلوسة وبني حيان مع القصف المدفعي الذي استهدف تلك البلدات اليوم.`;

test('a long analysis is not "the same text" as a short report whose words it happens to contain', () => {
  const shelling = ev('ad068f3a', '🤔قصف مدفعي استهدف وادي زبقين _ جنوب لبنان');
  assert.equal(obviousDuplicate(analysis, at, [shelling]), null);
});

test('a real copy with a channel signature around it is still merged without the AI', () => {
  const orig = ev('e1', 'قصف مدفعي يستهدف اطراف بلدة برعشيت في قضاء بنت جبيل جنوب لبنان');
  const copy = '🔴قصف مدفعي معادي يستهدف اطراف بلدة برعشيت في قضاء بنت جبيل جنوب لبنان T.me/mehwaralmokawma «مـيّـثـمـ»';
  assert.equal(obviousDuplicate(copy, at, [orig])?.id, 'e1');
});

test('the classifier is told that analyses of military activity are events', () => {
  assert.match(src, /is_analysis: \{/);
  assert.match(src, /Analyses and assessments of military activity[^\n]*ARE events/);
  // The skip of not_event comes after the analysis override.
  assert.ok(src.indexOf('const analysis = c.is_analysis === true') < src.indexOf('if (c.decision === "not_event")'));
  // An analysis is its own feed event (like a summary): never merged, no single pin.
  assert.match(src, /const summary = \(c\.is_summary === true \|\| analysis\) && !same;/);
});
