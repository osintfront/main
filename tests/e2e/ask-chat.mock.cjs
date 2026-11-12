// "Ask the map" conversation — browser checks (Playwright) against a local build and a FAKED server.
// No real database and no AI calls: every Supabase request is answered by this script, so it checks
// the panel itself — thread, follow-up context, summary form, copy / share text, the 6-question
// limit, errors, Hebrew / English, desktop / phone. The real answers of event-agent are checked
// separately (they need the deployed function).
//
// Build:  VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=<any JWT with role anon> \
//         VITE_SITE_URL=https://osintfront.com npx vite build --outDir /tmp/ask-qa/dist --emptyOutDir
// Run:    ASK_QA_DIST=/tmp/ask-qa/dist node tests/e2e/ask-chat.mock.cjs <he|en> <desktop|phone>
//         (PLAYWRIGHT_PATH = the playwright module when it is not installed here; CHROME_PATH = the browser)
// Passes when it prints "PASS" and exits 0. Run all four combinations.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const LANG = process.argv[2] || 'he';
const DEVICE = process.argv[3] || 'desktop';
const DIST = process.env.ASK_QA_DIST || '/tmp/ask-qa/dist';
const SHOTS = process.env.ASK_QA_SHOTS || require('os').tmpdir();
const SB = 'https://fake.supabase.co';
const UID = '99999999-9999-4999-8999-999999999999';
const E = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'];
const HE = /[֐-׿]/;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', aud: 'authenticated', exp: now + 3600, email: 'qa@example.test' })}.sig`;
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa@example.test', email_confirmed_at: '2026-11-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' };
const session = { access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
const profile = { id: UID, full_name: 'QA Pro', email: 'qa@example.test', role: 'viewer', status: 'active', can_publish: false, created_at: '2026-11-01T00:00:00Z', last_login_at: null, plan: 'pro', plan_source: 'admin', plan_expires_at: null, billing_period: null, must_change_password: false };
const ev = (i, title, lat, lng) => ({
  id: E[i], title, description: `${title} desc`, severity: 'high', latitude: lat, longitude: lng, location_name: 'Tyre', location_name_he: 'צור', location_name_en: 'Tyre',
  location_precision: 'city', sources: [], locations: [], country: 'Lebanon', region: '', city: 'Tyre', source_name: 'Telegram', source_url: null, source_type: 'social_media',
  occurred_at: new Date(Date.now() - (i + 1) * 3600e3).toISOString(), published_at: new Date().toISOString(), is_breaking: false, is_verified: false, translations: {},
  category_id: null, category_slug: 'airstrike', category_name: 'Airstrike', category_icon: 'Plane', category_color: '#dc2626', category_marker_color: '#dc2626',
  media_kinds: [], report_group: null, source_count: 0, updated_at: new Date().toISOString(),
});
const EVENTS = [ev(0, 'Strike in Tyre', 33.27, 35.2), ev(1, 'Strike in Nabatieh', 33.38, 35.48), ev(2, 'Shelling in Khiam', 33.33, 35.61)];

const asks = [];
function answerFor(q) {
  const en = LANG === 'en';
  if (/nothing|כלום/.test(q)) return { ok: true, mode: 'answer', answer: en ? 'No matching events were found.' : 'לא נמצאו אירועים.', ids: [] };
  if (/^(סכם|Summarise)/.test(q)) return { ok: true, mode: 'summary', answer: en ? 'Three events in Lebanon in the last 24 hours.\nMain developments\n• Strike in Tyre [1]\n• Strike in Nabatieh [2]\nGround activity\n• Shelling in Khiam [3]' : 'שלושה אירועים בלבנון ב-24 השעות האחרונות.\nהתפתחויות עיקריות\n• תקיפה בצור [1]\n• תקיפה בנבטיה [2]\nפעילות קרקעית\n• הפגזה בח\'יאם [3]', ids: E };
  return { ok: true, mode: 'answer', answer: en ? 'Two strikes were reported.\n• Strike in Tyre [1]\n• Strike in Nabatieh [2]' : 'דווח על שתי תקיפות.\n• תקיפה בצור [1]\n• תקיפה בנבטיה [2]', ids: [E[0], E[1]] };
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { if (req.url !== '/') console.error('FALLBACK', req.url); p = path.join(DIST, 'index.html'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(4173, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const phone = DEVICE === 'phone';
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(([s, lang, phone]) => {
    localStorage.setItem('ofm.auth', JSON.stringify(s));
    localStorage.setItem('ofm.lang', lang);
    window.__opened = [];
    window.open = (u) => (window.__opened.push(String(u)), null);
    window.__shared = [];
    if (phone) navigator.share = async (d) => void window.__shared.push(d.text);
    else try { delete Navigator.prototype.share; } catch {}
  }, [session, LANG, phone]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|net::ERR|ERR_FAILED/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));

  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith('http://127.0.0.1:4173')) return route.continue();
    if (!url.startsWith(SB)) return route.abort();
    const u = new URL(url);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.pathname === '/functions/v1/event-agent') {
      const body = JSON.parse(req.postData() || '{}');
      if (body.action !== 'ask') return json({ ok: false, error: 'not mocked' }, 400);
      asks.push(body);
      await new Promise((r) => setTimeout(r, 500));
      if (/fail429/.test(body.question)) return json({ error: 'quota' }, 429);
      return json(answerFor(body.question));
    }
    if (u.pathname.startsWith('/auth/v1/user')) return json(user);
    if (u.pathname.startsWith('/auth/v1/token')) return json(session);
    if (u.pathname.startsWith('/auth/v1/')) return json({});
    if (u.pathname === '/rest/v1/profiles') return json(single ? profile : [profile]);
    if (u.pathname === '/rest/v1/published_events') {
      const m = /in\.\(([^)]*)\)/.exec(u.searchParams.get('id') || '');
      const rows = m ? EVENTS.filter((e) => m[1].replace(/"/g, '').split(',').includes(e.id)) : EVENTS;
      return json(rows);
    }
    if (u.pathname.startsWith('/rest/v1/rpc/')) return json(null);
    if (u.pathname.startsWith('/rest/v1/')) return single ? route.fulfill({ status: 406, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' }) }) : json([]);
    return json({});
  });

  const out = { lang: LANG, device: DEVICE };
  const T = LANG === 'he' ? { open: 'שאלו את המפה', q1: 'מה קרה בלבנון היום?', q2: 'ומי נהרג שם?', extra: 'בלי הצהרות', sumQ: 'סכם את האירועים בלבנון ב-24 השעות האחרונות. בלי הצהרות', none: 'כלום כלום', sources: 'מקורות:' }
    : { open: 'Ask the map', q1: 'What happened in Lebanon today?', q2: 'And who was killed there?', extra: 'without statements', sumQ: 'Summarise the events in Lebanon in the last 24 hours. without statements', none: 'nothing nothing', sources: 'Sources:' };
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `ask-${LANG}-${DEVICE}-${name}.png`) });
  const turns = () => page.locator('[data-ask-turn]').count();
  const input = page.locator('[data-ask-panel] form:not([data-ask-summary]) input');
  const sendBtn = page.locator('[data-ask-action="send"]');
  const ask = async (q, n) => { await input.fill(q); await sendBtn.click(); await page.waitForFunction((n) => document.querySelectorAll('[data-ask-turn]').length === n, n, { timeout: 8000 }); };

  try {
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    if (phone) { // the map pane holds the ask button on phones
      const mapTab = page.getByRole('button', { name: LANG === 'he' ? /^מפה$/ : /^Map$/ }).first();
      if (await mapTab.count()) await mapTab.click().catch(() => {});
      await page.waitForTimeout(400);
    }
    const openBtn = page.getByRole('button', { name: T.open });
    out.askButton = await openBtn.count();
    if (!out.askButton) { await shot('no-button'); throw new Error('ask button not found'); }
    await openBtn.first().click();

    // 1 + 4: first question, double submit → one request.
    await input.fill(T.q1);
    await sendBtn.dblclick();
    await page.waitForFunction(() => document.querySelectorAll('[data-ask-turn]').length === 1, null, { timeout: 8000 });
    await page.waitForTimeout(700);
    out.t1_requests = asks.length; // expect 1
    out.t1_noHistory = !('history' in asks[0]); // expect true
    out.t1_citeButtons = await page.locator('[data-ask-turn="0"] p button').count(); // expect 2
    out.t1_inputCleared = (await input.inputValue()) === '';
    out.feedCards1 = await page.locator('article').count();

    // 2: follow-up carries context.
    await ask(T.q2, 2);
    const b2 = asks[asks.length - 1];
    out.t2_history = b2.history?.length; // 1
    out.t2_historyQ = b2.history?.[0]?.q === T.q1;
    out.t2_prevIds = b2.prev_ids?.length; // 2
    out.t2_selected = await page.locator('[data-ask-turn="1"][data-selected]').count(); // 1
    out.counter = (await page.locator('[data-ask-count]').innerText()).trim(); // 2/6

    // 3: older turn re-selects.
    await page.locator('[data-ask-turn="0"] > p').first().click();
    out.t3_selected0 = await page.locator('[data-ask-turn="0"][data-selected]').count(); // 1

    // 5: summary by button.
    await page.locator('[data-ask-action="summary"]').click();
    out.sum_formAreas = await page.locator('[data-ask-area]').count(); // 18
    out.sum_sendDisabledEmpty = await page.locator('[data-ask-action="summary-send"]').isDisabled(); // true
    await page.locator('[data-ask-area="lebanon"]').click();
    await page.locator('[data-ask-summary] input').fill(T.extra);
    await shot('summary-form');
    await page.locator('[data-ask-action="summary-send"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-ask-turn]').length === 3, null, { timeout: 8000 });
    out.sum_question = asks[asks.length - 1].question === T.sumQ;
    out.sum_questionSent = asks[asks.length - 1].question;
    out.sum_mode = await page.locator('[data-ask-turn="2"]').getAttribute('data-ask-mode'); // summary
    out.sum_history = asks[asks.length - 1].history.length; // 2
    out.sum_formClosed = (await page.locator('[data-ask-summary]').count()) === 0;
    out.feedCards3 = await page.locator('article').count();
    await page.waitForTimeout(900);
    out.newestAtTop = await page.evaluate(() => { const t = document.querySelector('[data-ask-turn="2"]'); const l = t.parentElement; const d = t.getBoundingClientRect().top - l.getBoundingClientRect().top; const atEnd = l.scrollTop + l.clientHeight >= l.scrollHeight - 2; const b = t.getBoundingClientRect().bottom <= l.getBoundingClientRect().bottom + 1; return { d: Math.round(d), atEnd, wholeVisible: d >= 0 && b, ok: d >= 0 && (d < 40 || atEnd) }; });
    await shot('thread');

    // 7: copy.
    await page.locator('[data-ask-turn="2"] [data-ask-action="copy"]').click();
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    out.copy_firstLine = clip.split('\n')[0] === T.sumQ;
    out.copy_hasSources = clip.includes(`\n\n${T.sources}\n[1] Strike in Tyre — https://osintfront.com/e/${E[0]}\n[2] Strike in Nabatieh — https://osintfront.com/e/${E[1]}\n[3] Shelling in Khiam — https://osintfront.com/e/${E[2]}`);
    out.copy_lastLine = clip.endsWith('\n\nosintfront.com');
    out.copy_label = (await page.locator('[data-ask-turn="2"] [data-ask-action="copy"]').innerText()).trim();

    // 8: share.
    await page.locator('[data-ask-turn="2"] [data-ask-action="share"]').click();
    await page.waitForTimeout(300);
    if (phone) { const s = await page.evaluate(() => window.__shared); out.share_native = s.length === 1 && s[0] === clip; }
    else { const o = await page.evaluate(() => window.__opened); out.share_whatsapp = o.length === 1 && o[0] === `https://wa.me/?text=${encodeURIComponent(clip)}`; }

    // error keeps the conversation and the typed question.
    await input.fill('fail429 test');
    await sendBtn.click();
    await page.waitForSelector('[data-ask-error]', { timeout: 8000 });
    out.err_text = (await page.locator('[data-ask-error]').innerText()).slice(0, 60);
    out.err_turnsKept = (await turns()) === 3;
    out.err_inputKept = (await input.inputValue()) === 'fail429 test';

    // no-events answer is a turn; its copy has no sources block; the next question still gets earlier events.
    await ask(T.none, 4);
    await page.locator('[data-ask-turn="3"] [data-ask-action="copy"]').click();
    await page.waitForTimeout(300);
    const clip2 = await page.evaluate(() => navigator.clipboard.readText());
    out.none_noSources = !clip2.includes(T.sources) && clip2.endsWith('\n\nosintfront.com');
    out.none_errorCleared = (await page.locator('[data-ask-error]').count()) === 0;
    await ask(T.q2, 5);
    out.afterNone_prevIds = asks[asks.length - 1].prev_ids.length; // 3 (from the summary turn)
    out.t5_history = asks[asks.length - 1].history.length; // 4

    // 9: limit.
    await ask(T.q1, 6);
    out.t6_history = asks[asks.length - 1].history.length; // 5
    out.limit_shown = await page.locator('[data-ask-limit]').count(); // 1
    out.limit_noInput = (await sendBtn.count()) === 0;
    out.counter6 = (await page.locator('[data-ask-count]').innerText()).trim();
    await shot('limit');
    const box = await page.locator('[data-ask-panel]').boundingBox();
    out.panelFits = box.x >= 0 && box.x + box.width <= (phone ? 390 : 1280) + 0.5;
    out.noHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    if (LANG === 'en') {
      const txt = await page.locator('[data-ask-panel]').innerText();
      out.en_noHebrewInPanel = !HE.test(txt);
    }
    out.dir = await page.evaluate(() => document.documentElement.dir);

    // new chat empties; 10: close.
    await page.locator('[data-ask-action="new"]').click();
    out.new_turns = await turns(); // 0
    out.new_inputBack = await sendBtn.count(); // 1
    await ask(T.q1, 1);
    out.newChat_noHistory = !('history' in asks[asks.length - 1]);
    await page.locator('[data-ask-panel] button[aria-label]').last().click(); // X in the header
    await page.waitForTimeout(300);
    out.closed_panel = await page.locator('[data-ask-panel]').count(); // 0
    out.closed_button = await page.getByRole('button', { name: T.open }).count(); // 1
    out.totalRequests = asks.length;
  } catch (e) {
    out.FAILED = String(e).slice(0, 400);
    await shot('failure').catch(() => {});
  }
  // /_vercel/insights/script.js does not exist on the local server (it is served by Vercel).
  out.consoleErrors = errors.filter((e) => !/Unexpected token '<'/.test(e)).slice(0, 5);
  const ZERO_OK = new Set(['new_turns', 'closed_panel']);
  const bad = Object.entries(out).filter(([k, v]) => (v === false || (v === 0 && !ZERO_OK.has(k)) || (k === 'newestAtTop' && !v.ok)));
  if (out.t1_requests !== 1) bad.push(['t1_requests', out.t1_requests]);
  if (out.t2_prevIds !== 2 || out.afterNone_prevIds !== 3 || out.t6_history !== 5) bad.push(['context', [out.t2_prevIds, out.afterNone_prevIds, out.t6_history]]);
  if (out.counter !== '2/6' || out.counter6 !== '6/6' || out.sum_mode !== 'summary' || out.sum_formAreas !== 18) bad.push(['values', [out.counter, out.counter6, out.sum_mode, out.sum_formAreas]]);
  if (out.consoleErrors.length) bad.push(['consoleErrors', out.consoleErrors]);
  if (out.FAILED) bad.push(['FAILED', out.FAILED]);
  console.log(JSON.stringify(out, null, 1));
  console.log(bad.length ? `FAIL ${JSON.stringify(bad)}` : 'PASS');
  process.exitCode = bad.length ? 1 : 0;
  await browser.close();
  server.close();
})();
