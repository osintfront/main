// Pin styles — browser check (Playwright) on the built CSS: a critical pin that also fits a filter set
// keeps its red critical halo next to the set's ring (the ring used to replace it).
// Run: SETS_QA_DIST=/tmp/sets-qa/dist node tests/e2e/pin-halo.mock.cjs   (prints PASS and exits 0)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const path = require('path');

const DIST = process.env.SETS_QA_DIST || '/tmp/sets-qa/dist';
const dir = path.join(DIST, 'assets');
const css = fs.readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const pin = (cls, ring) => `<div class="ofm-pin ${cls}" style="--pin-color:#9333ea;--pin-size:34px${ring ? ';--pin-ring:#7c3aed' : ''}"><span class="ofm-pin__body"></span></div>`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(`<style>${css}</style><div id="a">${pin('ofm-pin--critical has-ring', true)}</div><div id="b">${pin('ofm-pin--high has-ring', true)}</div><div id="c">${pin('ofm-pin--critical', false)}</div>`);
  const shadow = (id) => page.evaluate((id) => getComputedStyle(document.querySelector(`#${id} .ofm-pin__body`)).boxShadow, id);
  const [a, b, c] = [await shadow('a'), await shadow('b'), await shadow('c')];
  const red = /rgba\(220, 38, 38/;
  const ring = /rgb\(124, 58, 237\)/;
  const bad = [];
  if (!(red.test(a) && ring.test(a))) bad.push(`critical + set: ${a}`);
  if (!ring.test(b) || red.test(b)) bad.push(`set only: ${b}`);
  if (!red.test(c)) bad.push(`critical only: ${c}`);
  console.log(bad.length ? `FAIL ${JSON.stringify(bad)}` : 'PASS');
  process.exitCode = bad.length ? 1 : 0;
  await browser.close();
})();
