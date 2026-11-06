// Weather layer + card checks. Run with Playwright browser_evaluate (or the built-in browser's JS tool) on "/".
// Signed out: right-click → "Weather" item → sign-up gate; weather toggles → sign-up gate.
// Signed in (Free or above): the card opens with four tabs and a °C value; Clouds on + ▶️ moves the timeline label.
async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const gate = () => document.querySelector('[data-gate]')?.getAttribute('data-gate') ?? null;
  const closeGate = async () => { document.querySelector('[data-gate]')?.parentElement?.querySelector('button[aria-hidden]')?.click(); await wait(200); };
  await wait(3000);
  const map = document.querySelector('.leaflet-container');
  const r = map.getBoundingClientRect();
  map.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 2 }));
  await wait(400);
  document.querySelector('[data-weather-item]')?.click();
  await wait(2500);
  const out = { cardGate: gate(), card: !!document.querySelector('[data-weather-card]') };
  if (out.cardGate) await closeGate();
  if (out.card) {
    out.tabs = document.querySelectorAll('[data-weather-tab]').length;
    out.temp = document.querySelector('[data-weather-temp]')?.textContent ?? null;
    document.querySelector('[data-weather-tab="sky"]')?.click(); await wait(200);
    out.skyText = document.querySelector('[data-weather-card]')?.textContent.includes('%') ?? false;
    document.querySelector('[data-weather-card] button[aria-label]')?.click(); await wait(200);
  }
  [...document.querySelectorAll('button')].find((b) => /Intelligence layers|שכבות מודיעין/.test((b.getAttribute('aria-label') || '') + b.textContent + (b.title || '')))?.click();
  await wait(600);
  document.querySelector('[data-weather-toggle="clouds"]')?.click();
  await wait(1500);
  out.toggleGate = gate();
  if (out.toggleGate) { await closeGate(); return out; }
  const label = () => document.querySelector('[data-weather-label]')?.textContent ?? null;
  out.labelBefore = label();
  document.querySelector('[data-weather-play]')?.click();
  await wait(1500);
  out.labelAfter = label();
  document.querySelector('[data-weather-play]')?.click();
  // Dragging on the timeline must not pan the map.
  const pane = () => document.querySelector('.leaflet-map-pane')?.style.transform ?? '';
  const bar = document.querySelector('[data-weather-timeline] input[type=range]');
  if (bar) {
    const before = pane(); const b = bar.getBoundingClientRect();
    bar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: b.left + 10, clientY: b.top + 5 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: b.left + 120, clientY: b.top + 5 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: b.left + 120, clientY: b.top + 5 }));
    await wait(300);
    out.mapPannedBySlider = pane() !== before;
  }
  out.frameLayers = document.querySelectorAll('.leaflet-pane[class*="ofmWx"] .leaflet-layer, .leaflet-pane[class*="ofmWx"] img.leaflet-image-layer').length;
  return out;
};
