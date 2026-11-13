// Run: node --experimental-strip-types --test tests/categories/registry.test.ts
//
// The two casualty types (Killed, Wounded) are in every category list. The registry imports React
// icons, so it is read as text here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8');
const reg = read('src/data/categoryRegistry.ts');

test('registry rows sit directly after assassination', () => {
  const lines = reg.split('\n').map((l) => l.trim());
  const i = lines.findIndex((l) => l.startsWith("{ slug: 'assassination'"));
  assert.ok(i >= 0);
  assert.equal(lines[i + 1], "{ slug: 'killed', name: 'Killed', icon: 'Skull', color: '#27272a' },");
  assert.equal(lines[i + 2], "{ slug: 'wounded', name: 'Wounded', icon: 'MedicalCross', color: '#701a75' },");
});

test('names in Hebrew and English', () => {
  const he = read('src/i18n/he.ts');
  const en = read('src/i18n/en.ts');
  assert.ok(he.includes("'category.killed': 'הרוגים'"));
  assert.ok(he.includes("'category.wounded': 'פצועים'"));
  assert.ok(en.includes("'category.killed': 'Killed'"));
  assert.ok(en.includes("'category.wounded': 'Wounded'"));
});

test('every other list knows both', () => {
  for (const f of ['src/types/category.ts', 'api/_lib/pushFormat.ts', 'supabase/functions/_shared/eeiInput.ts',
    'supabase/functions/_shared/splitEvent.ts', 'supabase/functions/_shared/dedupe.ts']) {
    const s = read(f);
    assert.match(s, /\bkilled\b/, f);
    assert.match(s, /\bwounded\b/, f);
  }
});

test('icons: Skull from lucide, own MedicalCross, no lucide Cross', () => {
  const imp = reg.slice(0, reg.indexOf("} from 'lucide-react'"));
  assert.doesNotMatch(imp, /\bCross\b[,\s]/);
  assert.match(imp, /\bSkull\b/);
  assert.match(reg, /\bMedicalCross\b/);
  assert.match(read('src/data/customIcons.ts'), /createLucideIcon\('MedicalCross'/);
  assert.match(reg, /export function categoryRefBySlug\(slug: string\): CategoryRef \| null/);
});
