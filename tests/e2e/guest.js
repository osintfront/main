// Stage A / Task 7 — guest checks. Run with Playwright browser_evaluate on "/" while signed out
// (preview: open it through a Vercel share link first). Expect: stays on "/", events in the feed,
// expand → signup gate, satellite dimmed with 🔒 and → signup gate (stays off), ships turn on,
// "Device notifications" → signup gate, /archive → /login.
async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const gate = () => document.querySelector('[data-gate]')?.getAttribute('data-gate') ?? null;
  const closeGate = async () => { document.querySelector('[data-gate]')?.parentElement?.querySelector('button[aria-hidden]')?.click(); await wait(200); };
  await wait(3000);
  const out = { url: location.pathname, feed: document.querySelectorAll('article').length };
  [...document.querySelectorAll('button')].find((b) => /^(Expand|הרחב)/.test(b.textContent.trim()))?.click(); await wait(500);
  out.expand = gate(); await closeGate();
  document.querySelector('[aria-label^="Intelligence layers"], [aria-label^="שכבות מודיעין"]')?.click(); await wait(600);
  const sat = [...document.querySelectorAll('label')].find((l) => /Satellite|לוויין/.test(l.textContent));
  out.satDim = sat?.className.includes('opacity-50'); sat?.querySelector('input')?.click(); await wait(500);
  out.satellite = gate(); out.satOn = sat?.querySelector('input')?.checked; await closeGate();
  const ships = [...document.querySelectorAll('label')].find((l) => /^(Ships|אוניות|ספינות)/.test(l.textContent.trim()));
  ships?.querySelector('input')?.click(); await wait(800); out.shipsOn = ships?.querySelector('input')?.checked;
  [...document.querySelectorAll('button[aria-label]')].find((b) => /sound|צליל/i.test(b.getAttribute('aria-label')))?.click(); await wait(400);
  [...document.querySelectorAll('[role="switch"]')].find((s) => /Device notifications|התראות במכשיר/.test(s.getAttribute('aria-label') || ''))?.click(); await wait(400);
  out.push = gate(); await closeGate();
  [...document.querySelectorAll('a')].find((x) => x.getAttribute('href') === '/archive')?.click(); await wait(1500);
  out.archive = location.pathname;
  return out;
};
