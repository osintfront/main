// Airfields & ports checks. Run with Playwright browser_evaluate (or the built-in browser's JS tool) on "/".
// Signed out: Intelligence layers → Civil → sign-up gate.
// Signed in: Civil on → markers appear; a popup has the live-traffic button; with Aircraft already on it stays on.
async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const gate = () => document.querySelector('[data-gate]')?.getAttribute('data-gate') ?? null;
  await wait(3000);
  [...document.querySelectorAll('button')].find((b) => /Intelligence layers|שכבות מודיעין/.test((b.getAttribute('aria-label') || '') + b.textContent + (b.title || '')))?.click();
  await wait(600);
  // The section is a dropdown: open it first.
  const sec = document.querySelector('[data-layer-section="infra"]');
  if (sec?.getAttribute('aria-expanded') === 'false') { sec.click(); await wait(200); }
  const before = document.querySelectorAll('.leaflet-marker-icon').length;
  document.querySelector('[data-infra-toggle="civil"]')?.click();
  await wait(2500);
  const out = { gate: gate(), checked: document.querySelector('[data-infra-toggle="civil"]')?.checked ?? null };
  if (out.gate) return out;
  out.markersAdded = document.querySelectorAll('.leaflet-marker-icon').length - before;
  const pin = document.querySelector('.ofm-infra');
  pin?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(1500);
  out.trafficButton = !!document.querySelector('[data-infra-traffic]');
  out.nearLine = document.querySelector('.leaflet-popup-content')?.textContent.match(/(near|ליד) \S+/)?.[0] ?? null;
  document.querySelector('[data-infra-traffic]')?.click();
  await wait(800);
  out.aircraftOn = [...document.querySelectorAll('input[type=checkbox]')].some((c) => c.checked && /Aircraft|מטוסים/.test(c.closest('label')?.textContent ?? ''));
  return out;
};
