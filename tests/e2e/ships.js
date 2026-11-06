// Ships upgrade checks (guests too). Run with Playwright browser_evaluate (or the built-in browser's JS tool) on "/".
// Intelligence layers → Ships on → six chokepoint cards, each with a status chip; "Show silent ships" toggle exists.
async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(3000);
  [...document.querySelectorAll('button')].find((b) => /Intelligence layers|שכבות מודיעין/.test((b.getAttribute('aria-label') || '') + b.textContent + (b.title || '')))?.click();
  await wait(600);
  const shipsBox = [...document.querySelectorAll('label')].find((l) => /Ships \(AIS\)|אוניות \(AIS\)/.test(l.textContent))?.querySelector('input');
  if (shipsBox && !shipsBox.checked) shipsBox.click();
  await wait(4000);
  const cards = [...document.querySelectorAll('[data-chokepoint]')];
  return {
    cards: cards.map((c) => c.getAttribute('data-chokepoint')),
    statuses: cards.map((c) => c.querySelector('[data-status]')?.getAttribute('data-status') ?? null),
    silentToggle: !!document.querySelector('[data-show-silent]'),
  };
};
