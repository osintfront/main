// Military bases checks. Run with Playwright browser_evaluate (or the built-in browser's JS tool) on "/".
// Signed out: Intelligence layers → Bases → sign-up gate.
// Signed in: Bases on → markers or a status ("Not built yet" before the first data run);
// Bunkers & checkpoints on below zoom 11 → "zoom in to see" and no minor markers.
async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const gate = () => document.querySelector('[data-gate]')?.getAttribute('data-gate') ?? null;
  await wait(3000);
  [...document.querySelectorAll('button')].find((b) => /Intelligence layers|שכבות מודיעין/.test((b.getAttribute('aria-label') || '') + b.textContent + (b.title || '')))?.click();
  await wait(600);
  // The section is a dropdown: open it first.
  const sec = document.querySelector('[data-layer-section="military"]');
  if (sec?.getAttribute('aria-expanded') === 'false') { sec.click(); await wait(200); }
  const out = { toggles: [...document.querySelectorAll('[data-mil-toggle]')].map((x) => x.getAttribute('data-mil-toggle')), foreignFilter: !!document.querySelector('[data-mil-foreign]') };
  document.querySelector('[data-mil-toggle="base"]')?.click();
  await wait(2500);
  out.gate = gate();
  out.checked = document.querySelector('[data-mil-toggle="base"]')?.checked ?? null;
  if (out.gate) return out;
  out.baseMarkers = document.querySelectorAll('.ofm-mil').length;
  out.status = document.querySelector('[data-mil-toggle="base"]')?.closest('label')?.textContent.match(/⚠️ .*/)?.[0] ?? null;
  const before = document.querySelectorAll('.ofm-mil').length;
  document.querySelector('[data-mil-toggle="minor"]')?.click();
  await wait(2500);
  out.zoomHint = !!document.querySelector('[data-mil-zoom-hint]');
  out.minorAddedBelowZoom11 = document.querySelectorAll('.ofm-mil').length - before;
  return out;
};
