// Stage A / Task 8 — run with Playwright browser_evaluate on /login?mode=signup (signed out).
// Expect: 2 tabs, Google button, name field; a new address → "check your email" screen and a
// viewer/free/pending profile in the database.
async ({ email, password }) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(1500);
  const out = { google: !!document.querySelector('[data-auth="google"]'), name: !!document.querySelector('input[autocomplete="name"]'), tabs: document.querySelectorAll('[role="tab"]').length };
  const set = (sel, v) => { const el = document.querySelector(sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('input[autocomplete="name"]', 'E2E Signup'); set('input[autocomplete="email"]', email); set('input[autocomplete="new-password"]', password);
  document.querySelector('form button[type="submit"]').click(); await wait(4000);
  out.checkEmail = !!document.querySelector('[data-auth="check-email"]');
  return out;
};
