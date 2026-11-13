// Run: node --experimental-strip-types --test tests/i18n/no-hebrew-literals.test.ts
//
// User-facing components must take their text from the i18n dictionaries
// (src/i18n/en.ts and he.ts) so English users never see Hebrew. A Hebrew
// string literal in one of these files is shown to everyone, whatever the
// selected language. Comments may stay Hebrew; code may not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = [
  'src/components/install/InstallAppButton.tsx',
  'src/components/auth/AccountGates.tsx',
  'src/components/account/PlanCard.tsx',
  'src/components/map/mapRotate.ts',
  'src/pages/public/LegalPlaceholder.tsx',
  'src/components/map/AskMap.tsx',
  'src/components/filters/FilterSetsBar.tsx',
  'src/components/filters/FilterSetHeader.tsx',
  'src/components/filters/EeiPanel.tsx',
  'src/components/admin/SecondaryTypesField.tsx',
  'src/components/feed/TermText.tsx',
  'src/components/feed/DeepEntryDialog.tsx',
  'src/components/feed/MediaTranslate.tsx',
  'src/components/feed/EventMedia.tsx',
  'src/lib/mediaOverlayDom.ts',
  'src/lib/lightbox.ts',
  'src/lib/mediaOverlay.ts',
  'src/components/common/InfoTip.tsx',
  'src/pages/admin/AccountPage.tsx',
];

const HEBREW = /[֐-׿]/;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

for (const file of FILES) {
  test(`${file} has no Hebrew string literals`, () => {
    const offending = readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ n: i + 1, line }))
      .filter(({ line }) => HEBREW.test(line) && !COMMENT_LINE.test(line))
      .map(({ n, line }) => `${n}: ${line.trim().slice(0, 80)}`);
    assert.deepEqual(offending, [], `Hebrew in code:\n${offending.join('\n')}`);
  });
}
