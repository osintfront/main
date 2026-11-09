// English UI must not show Hebrew. Run with Playwright browser_evaluate on "/" and on
// "/cancel-subscription" with the site in English (localStorage ofm.lang = 'en', the default).
// Checks visible text plus title / aria-label / placeholder attributes, and the hover tooltip of
// up to 40 map pins (Leaflet builds those only on hover). The only Hebrew allowed is the language
// switch itself ("עברית"). Expect: { lang: 'en', leaks: [] }. A pin whose event has no English
// translation yet still falls back to its original title, so a rare 'pin' leak can be data, not code.
async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(3000);
  const HEBREW = /[֐-׿]/;
  const ALLOWED = new Set(['עברית']);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const where = (el) => {
    const parts = [];
    for (let e = el, i = 0; e && e !== document.body && i < 3; e = e.parentElement, i++) parts.unshift(e.tagName.toLowerCase());
    return parts.join(' > ');
  };
  const leaks = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.trim();
    const el = walker.currentNode.parentElement;
    if (!text || !HEBREW.test(text) || ALLOWED.has(text) || !el || el.closest('script,style') || !visible(el)) continue;
    leaks.push({ kind: 'text', text: text.slice(0, 60), where: where(el) });
  }
  for (const el of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(attr);
      if (v && HEBREW.test(v) && !ALLOWED.has(v)) leaks.push({ kind: attr, text: v.slice(0, 60), where: where(el) });
    }
  }
  const pins = [...document.querySelectorAll('.ofm-pin-wrap, .ofm-cluster-wrap')].filter(visible).slice(0, 40);
  let hovered = 0;
  for (const pin of pins) {
    const r = pin.getBoundingClientRect();
    const at = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    pin.dispatchEvent(new MouseEvent('mouseover', at));
    await wait(100);
    const tip = [...document.querySelectorAll('.leaflet-tooltip')].pop()?.textContent.trim() ?? '';
    if (tip) hovered++;
    if (HEBREW.test(tip)) leaks.push({ kind: 'pin', text: tip.slice(0, 60), where: 'map pin tooltip' });
    pin.dispatchEvent(new MouseEvent('mouseout', at));
  }
  return { url: location.pathname, lang: document.documentElement.lang, dir: document.documentElement.dir, pinsHovered: hovered, leaks };
};
