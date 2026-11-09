// English UI must not show Hebrew. Run with Playwright browser_evaluate on "/" and on
// "/cancel-subscription" with the site in English (localStorage ofm.lang = 'en', the default).
// Checks visible text plus title / aria-label / placeholder attributes. The only Hebrew allowed
// is the language switch itself ("עברית"). Expect: { lang: 'en', leaks: [] }.
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
  return { url: location.pathname, lang: document.documentElement.lang, dir: document.documentElement.dir, leaks };
};
