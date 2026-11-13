// Deep analysis — browser checks (Playwright) against a local build and a FAKED Supabase.
// Term links in the event details window, the entry window (picture credit, sections, sources,
// our events, plain text only), writing a new entry (poll, one paid call, failures that do not
// loop), plan gates for Free / guest, and staff tools (Analyze, edit, refresh, remove).
//
// Build:  VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=<any JWT with role anon> \
//         VITE_SITE_URL=https://osintfront.com npx vite build --outDir /tmp/sets-qa/dist --emptyOutDir
// Run:    SETS_QA_DIST=/tmp/sets-qa/dist node tests/e2e/deep-analysis.mock.cjs <he|en> <desktop|phone> <pro|free|guest|staff>
//         (PLAYWRIGHT_PATH = the playwright module when it is not installed here; CHROME_PATH = the browser)
// Passes when it prints "PASS" and exits 0.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const LANG = process.argv[2] || 'he';
const DEVICE = process.argv[3] || 'desktop';
const PLAN = process.argv[4] || 'pro';
const DIST = process.env.SETS_QA_DIST || '/tmp/sets-qa/dist';
const SHOTS = process.env.SETS_QA_SHOTS || '/tmp';
const SB = 'https://fake.supabase.co';
const UID = '99999999-9999-4999-8999-999999999999';
const H = 3600e3;
const PORT = 4174 + Math.floor(Math.random() * 500);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', aud: 'authenticated', exp: now + 3600, email: 'qa@example.test' })}.sig`;
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa@example.test', email_confirmed_at: '2026-11-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' };
const session = { access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
const profile = { id: UID, full_name: 'QA', email: 'qa@example.test', role: PLAN === 'staff' ? 'analyst' : 'viewer', status: 'active', can_publish: false, created_at: '2026-11-01T00:00:00Z', last_login_at: null, plan: PLAN === 'free' ? 'free' : 'pro', plan_source: 'admin', plan_expires_at: null, billing_period: null, must_change_password: false };

let seq = 0;
const ev = (title, description, hoursAgo) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`, title, description, severity: 'high', latitude: 33.27 + seq / 100, longitude: 35.2, location_name: 'Tyre',
  location_name_he: null, location_name_en: null, location_precision: 'city', sources: [], locations: [], country: 'Lebanon', region: '', city: '',
  source_name: 'Telegram', source_url: null, source_type: 'social_media', occurred_at: new Date(Date.now() - hoursAgo * H).toISOString(), published_at: new Date().toISOString(),
  is_breaking: false, is_verified: false, translations: { en: { title, summary: description } }, category_id: null, category_slug: 'uav', category_name: 'UAV', category_icon: 'FixedWingUav',
  category_color: '#6d28d9', category_marker_color: '#6d28d9', media_kinds: [], report_group: null, source_count: 0, updated_at: new Date().toISOString(), secondary_categories: [],
});
const A = ev('Ted Cruz: the president will end the war', 'Heron drone over Tyre. Radwan forces moved south.', 1);
const R1 = ev('Cruz speaks in Texas', 'Statement', 5);
const R2 = ev('Cruz meets envoys', 'Meeting', 8);
const LIVE = [A, R1, R2];
const ENTRY = (id, name) => ({
  id, kind: id === 'E1' ? 'person' : 'weapon', name_he: name, name_en: name, name_orig: '', aliases: [name.toLowerCase()],
  summary_he: 'סיכום <script>window.__x=1</script>', summary_en: 'Summary <script>window.__x=1</script>',
  sections: [{ key: 'background', he: 'רקע', en: 'Background text' }, { key: 'operators', he: 'מפעילים', en: 'Operators text' }, { key: 'use', he: 'שימוש', en: 'Use text' }],
  sources: [{ title: 'Source A', url: 'https://a.example/x', from: 'web' }, { title: 'Source B', url: 'https://b.example/y', from: 'web' }],
  image: { url: 'https://upload.wikimedia.org/a.jpg', page: 'https://commons.wikimedia.org/wiki/File:A.jpg', credit: 'Jane Doe', license: 'CC BY-SA 4.0', license_url: null },
  events: [R1.id, R2.id], version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), edited_at: null,
});
let heronEntry = null;
const terms = () => [
  { key: 'ted cruz', name: 'Ted Cruz', kind: 'person', surfaces: ['Ted Cruz'], entry: 'E1' },
  { key: 'heron', name: 'IAI Heron', kind: 'weapon', surfaces: ['Heron'], entry: heronEntry },
];
const FEATURES = ['live_map', 'feed', 'event_open', 'event_summary', 'source_link', 'media', 'archive_days', 'feed_search', 'copy_text', 'share_daily'];
const planRows = [
  ...['guest', 'free', 'pro', 'max'].flatMap((p) => FEATURES.map((k) => ({ feature_key: k, plan_id: p, enabled: true, limit_value: null }))),
  { feature_key: 'feed_delay_min', plan_id: 'guest', enabled: true, limit_value: 0 },
  { feature_key: 'deep_analysis', plan_id: 'guest', enabled: false, limit_value: 0 },
  { feature_key: 'deep_analysis', plan_id: 'free', enabled: false, limit_value: 0 },
  { feature_key: 'deep_analysis', plan_id: 'pro', enabled: true, limit_value: 3 },
  { feature_key: 'deep_analysis', plan_id: 'max', enabled: true, limit_value: 10 },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
const errors = [];
let mode = 'ok'; // ok | quota | budget | fail
const calls = { writeStart: 0, writePoll: 0, deepEntry: 0, update: [], refresh: 0, remove: 0, analyze: [] };

async function routeAll(page) {
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
    if (url.startsWith('https://upload.wikimedia.org/')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
    if (!url.startsWith(SB)) return route.abort();
    const u = new URL(url);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' };
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { ...cors, 'content-range': '0-0/*' }, body: JSON.stringify(body) });
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const none = () => route.fulfill({ status: 406, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' }) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname.startsWith('/auth/v1/user')) return PLAN === 'guest' ? json({}, 401) : json(user);
    if (u.pathname.startsWith('/auth/v1/token')) return json(session);
    if (u.pathname.startsWith('/auth/v1/')) return json({});
    if (u.pathname === '/rest/v1/app_settings') {
      const wanted = u.searchParams.get('key') || '';
      if (single) return /enforce_plans/.test(wanted) ? json({ value: true }) : none();
      return json(/enforce_plans/.test(wanted) || !wanted ? [{ key: 'enforce_plans', value: true }] : []);
    }
    if (u.pathname === '/rest/v1/plan_features') return json(planRows);
    if (u.pathname === '/rest/v1/profiles') return PLAN === 'guest' ? (single ? none() : json([])) : json(single ? profile : [profile]);
    if (u.pathname === '/rest/v1/published_events') {
      const m = /in\.\(([^)]*)\)/.exec(u.searchParams.get('id') || '');
      return json(m ? LIVE.filter((e) => m[1].replace(/"/g, '').split(',').includes(e.id)) : LIVE);
    }
    if (u.pathname === '/rest/v1/rpc/event_terms_for') return json(terms()); // the RPC answers anyone who may read the summary (guest included: links with a lock)
    if (u.pathname === '/rest/v1/rpc/deep_entry') {
      calls.deepEntry++;
      const id = JSON.parse(req.postData() || '{}').p_id;
      return json(id === 'E1' ? ENTRY('E1', 'Ted Cruz') : ENTRY(id, 'IAI Heron'));
    }
    if (u.pathname === '/rest/v1/rpc/deep_my_quota') return json({ enabled: true, staff: PLAN === 'staff', used: 0, limit: PLAN === 'staff' ? null : 3, budget_left: true });
    if (u.pathname === '/functions/v1/event-agent') {
      const b = JSON.parse(req.postData() || '{}');
      if (b.action === 'deep_write') {
        if (b.text) calls.analyze.push(b.text);
        if (b.poll) calls.writePoll++;
        else calls.writeStart++;
        if (mode === 'quota') return json({ error: 'quota_exceeded', used: 3, limit: 3 }, 429);
        if (mode === 'budget') return json({ error: 'budget' }, 429);
        if (mode === 'fail') return b.poll ? json({ error: 'failed' }, 409) : json({ pending: true, started: true }, 202);
        if (!b.poll) return json({ pending: true, started: true }, 202);
        heronEntry = 'E2';
        return json({ ok: true, entry_id: 'E2' });
      }
      if (b.action === 'deep_update') { calls.update.push(b.patch); return json({ ok: true, version: 2 }); }
      if (b.action === 'deep_refresh') { calls.refresh++; return json({ ok: true, version: 2 }); }
      if (b.action === 'deep_remove') { calls.remove++; return json({ ok: true }); }
      return json({ ok: true });
    }
    if (u.pathname === '/rest/v1/active_hfc_alerts') return json([]);
    if (u.pathname.startsWith('/rest/v1/rpc/')) return json(null);
    if (u.pathname.startsWith('/rest/v1/')) return single ? none() : json([]);
    return json({});
  });
}

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const phone = DEVICE === 'phone';
  const out = { lang: LANG, device: DEVICE, plan: PLAN };
  const T = LANG === 'he'
    ? { details: /^פרטי האירוע$/, noEntry: 'אין עדיין ערך', write: 'כתוב עכשיו', left: 'נותרו 3 מתוך 3 היום', quota: 'ניצלת היום', budget: 'התקציב היומי', failed: 'לא ניתן היה לכתוב', background: 'רקע', analyze: 'נתח „Radwan”' }
    : { details: /^Event details$/, noEntry: 'No entry yet', write: 'Write it now', left: '3 of 3 left today', quota: "You have used today's", budget: "Today's budget", failed: 'could not be written', background: 'Background', analyze: 'Analyze “Radwan”' };

  async function open() {
    const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone });
    await ctx.addInitScript(([s, lang, signedIn]) => {
      if (sessionStorage.getItem('qa-seeded')) return;
      sessionStorage.setItem('qa-seeded', '1');
      if (signedIn) localStorage.setItem('ofm.auth', JSON.stringify(s));
      localStorage.setItem('ofm.lang', lang);
    }, [session, LANG, PLAN !== 'guest']);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|net::ERR|ERR_FAILED/.test(m.text())) errors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => { if (!/Unexpected token '<'/.test(String(e))) errors.push(`pageerror: ${String(e).slice(0, 300)}`); });
    page.on('dialog', (d) => { out.confirms = (out.confirms || 0) + 1; void d.accept(); });
    await routeAll(page);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const consent = page.getByRole('button', { name: /^(Reject non-essential|דחיית עוגיות לא-הכרחיות)$/ });
    if (await consent.count()) await consent.first().click().catch(() => {});
    if (phone) {
      const b = page.getByRole('button', { name: LANG === 'he' ? /^(עדכונים|פיד|רשימה)/ : /^(Feed|List|Updates)/ }).first();
      if (await b.count()) await b.click().catch(() => {});
    }
    return { ctx, page };
  }
  const openDetails = async (page) => {
    await page.locator(`#event-card-${A.id}`).getByRole('button', { name: T.details }).click();
    await page.locator('[aria-labelledby="event-details-title"]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
  };
  const dlg = (page) => page.locator('[data-deep-dialog]');

  try {
    const { ctx, page } = await open();
    out.c1_cardNoTerms = (await page.locator(`#event-card-${A.id} [data-term]`).count()) === 0;
    await openDetails(page);
    const details = page.locator('[aria-labelledby="event-details-title"]');
    out.c1_cruzSolid = (await details.locator('[data-term="ted cruz"][data-ready="1"]').count()) === 1;
    out.c1_heronDotted = (await details.locator('[data-term="heron"][data-ready="0"]').count()) === 1;

    if (PLAN === 'free' || PLAN === 'guest') {
      await details.locator('[data-term="ted cruz"]').click();
      await page.waitForTimeout(500);
      out.c5_gate = (await page.locator(`[data-gate="${PLAN === 'guest' ? 'signup' : 'upgrade'}"]`).count()) === 1;
      out.c5_noCalls = calls.deepEntry === 0 && calls.writeStart === 0;
    } else {
      // 2. an existing entry
      await details.locator('[data-term="ted cruz"]').click();
      await dlg(page).locator('[data-deep-state="entry"]').waitFor({ timeout: 5000 });
      await page.waitForTimeout(600);
      const d = dlg(page);
      out.c2_name = (await d.locator('#deep-title').innerText()).includes('Ted Cruz');
      const credit = await d.locator('[data-deep-credit]').innerText();
      out.c2_credit = credit.includes('Jane Doe') && credit.includes('CC BY-SA 4.0');
      out.c2_sections = (await d.locator('[data-deep-section]').count()) === 3;
      out.c2_sectionHeading = (await d.locator('[data-deep-section="background"] h3').innerText()).toLowerCase().includes(T.background.toLowerCase());
      const rels = await d.locator('ol a').evaluateAll((as) => as.map((a) => a.getAttribute('rel') || ''));
      out.c2_sources = rels.length === 2 && rels.every((r) => r.includes('noopener'));
      out.c2_related = (await d.locator('[data-deep-event]').count()) === 2;
      out.c2_scriptText = (await d.innerText()).includes('<script>');
      out.c2_noScriptRun = await page.evaluate(() => window.__x === undefined);
      if (phone) {
        const box = await d.locator('[role="dialog"]').boundingBox();
        out.c7_fits = box.width <= 390 + 1;
        const img = await d.locator('figure').boundingBox();
        const txt = await d.locator('[data-deep-section]').first().boundingBox();
        out.c7_pictureAbove = img.y < txt.y;
      }
      if (LANG === 'he') out.c7_rtl = (await page.evaluate(() => document.documentElement.dir)) === 'rtl';
      await page.screenshot({ path: path.join(SHOTS, `deep-${LANG}-${DEVICE}-${PLAN}-entry.png`) });

      if (PLAN === 'staff') {
        // 6. edit, refresh, remove
        await d.locator('[data-deep-action="edit"]').click();
        await d.locator('[data-deep-field="summary_en"]').fill('Edited summary');
        await d.locator('[data-deep-action="save"]').click();
        await page.waitForTimeout(800);
        out.c6_update = calls.update.length === 1 && calls.update[0].summary_en === 'Edited summary';
        const before = out.confirms || 0;
        await dlg(page).locator('[data-deep-action="refresh"]').click();
        await page.waitForTimeout(800);
        out.c6_refreshConfirm = (out.confirms || 0) === before + 1 && calls.refresh >= 1;
        await dlg(page).locator('[data-deep-action="remove"]').click();
        await page.waitForTimeout(800);
        out.c6_removeConfirm = (out.confirms || 0) === before + 2 && calls.remove === 1 && (await dlg(page).count()) === 0;
        // Analyze a word selected in the headline
        await page.evaluate(() => {
          const h = document.querySelector('#event-details-title');
          const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode()) && !node.textContent.includes('president'));
          const i = node.textContent.indexOf('president');
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + 9);
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
        });
        await details.locator('#event-details-title').click({ button: 'right', position: { x: 200, y: 8 } }).catch(() => {});
        await page.waitForTimeout(400);
        out.c6_headlineMenu = (await page.locator('[data-analyze-menu] [role="menuitem"]').count()) === 1;
        await details.locator('header').click({ position: { x: 10, y: 10 } }).catch(() => {});
        await page.waitForTimeout(300);
        // Analyze a selection in the summary
        await page.evaluate(() => {
          const p = [...document.querySelectorAll('[aria-labelledby="event-details-title"] p')].find((x) => x.textContent.includes('Radwan'));
          const node = [...p.childNodes].find((n) => n.nodeType === 3 && n.textContent.includes('Radwan'));
          const i = node.textContent.indexOf('Radwan');
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + 6);
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
        });
        const p = details.locator('p', { hasText: 'Radwan' }).first();
        await p.click({ button: 'right', position: { x: 5, y: 5 } }).catch(() => {});
        await page.waitForTimeout(400);
        const item = page.locator('[data-analyze-menu] [role="menuitem"]');
        out.c6_menu = (await item.count()) === 1 && (await item.innerText()).includes(T.analyze);
        if (out.c6_menu) await item.click();
        await page.waitForTimeout(6500);
        out.c6_analyze = calls.analyze.length >= 1 && calls.analyze[0] === 'Radwan';
      } else {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        out.c2_closedOnly = (await dlg(page).count()) === 0 && (await details.count()) === 1;
        // 3. write a new entry
        await details.locator('[data-term="heron"]').click();
        await dlg(page).locator('[data-deep-state="unwritten"]').waitFor({ timeout: 5000 });
        out.c3_noEntry = (await dlg(page).innerText()).includes(T.noEntry);
        out.c3_left = (await dlg(page).innerText()).includes(T.left);
        await page.screenshot({ path: path.join(SHOTS, `deep-${LANG}-${DEVICE}-${PLAN}-unwritten.png`) });
        await dlg(page).locator('[data-deep-action="write"]').click();
        out.c3_writing = (await dlg(page).locator('[data-deep-state="writing"]').count()) === 1;
        await dlg(page).locator('[data-deep-state="entry"]').waitFor({ timeout: 15000 });
        out.c3_oneCall = calls.writeStart === 1;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        // 4. refusals
        for (const [m, text] of [['quota', T.quota], ['budget', T.budget], ['fail', T.failed]]) {
          mode = m;
          heronEntry = null;
          const startBefore = calls.writeStart;
          await page.reload({ waitUntil: 'domcontentloaded' }); // fresh term cache: Heron unwritten again
          await page.waitForTimeout(3000);
          if (phone) {
            const fb = page.getByRole('button', { name: /^(Feed|List|Updates)/ }).first();
            if (await fb.count()) await fb.click().catch(() => {});
          }
          await openDetails(page);
          await page.locator('[aria-labelledby="event-details-title"] [data-term="heron"]').click();
          await dlg(page).locator('[data-deep-action="write"]').click();
          await dlg(page).locator('[data-deep-state="message"]').waitFor({ timeout: 15000 });
          out[`c4_${m}`] = (await dlg(page).innerText()).includes(text);
          await page.waitForTimeout(6000);
          out[`c4_${m}_oneCall`] = calls.writeStart === startBefore + 1;
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        }
      }
    }
    await ctx.close();
  } catch (e) {
    out.FAILED = String(e).slice(0, 400);
  }

  out.calls = { writeStart: calls.writeStart, writePoll: calls.writePoll, deepEntry: calls.deepEntry };
  out.consoleErrors = errors.slice(0, 5);
  const bad = [];
  for (const [k, v] of Object.entries(out)) if (v === false) bad.push([k, v]);
  if (out.consoleErrors.length) bad.push(['consoleErrors', out.consoleErrors]);
  if (out.FAILED) bad.push(['FAILED', out.FAILED]);
  console.log(JSON.stringify(out, null, 1));
  console.log(bad.length ? `FAIL ${JSON.stringify(bad)}` : 'PASS');
  process.exitCode = bad.length ? 1 : 0;
  await browser.close();
  server.close();
})();
