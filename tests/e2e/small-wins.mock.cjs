// Share to any app, the (i) info tips and the control-room screen — browser checks (Playwright) against a
// local build and a FAKED server (no database). Plan = max or free; device = desktop (no share sheet: the
// menu) or phone (a share sheet is faked).
//
// Build:  VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=<any JWT with role anon> \
//         VITE_SITE_URL=https://osintfront.com npx vite build --outDir /tmp/sw-qa/dist --emptyOutDir
// Run:    SW_QA_DIST=/tmp/sw-qa/dist node tests/e2e/small-wins.mock.cjs <he|en> <desktop|phone> <max|free>
//         (PLAYWRIGHT_PATH = the playwright module when it is not installed here; CHROME_PATH = the browser)
// Passes when it prints "PASS" and exits 0.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const LANG = process.argv[2] || 'he';
const DEVICE = process.argv[3] || 'desktop';
const PLAN = process.argv[4] || 'max';
const DIST = process.env.SW_QA_DIST || '/tmp/sw-qa/dist';
const SHOTS = process.env.SW_QA_SHOTS || require('os').tmpdir();
const SB = 'https://fake.supabase.co';
const UID = '99999999-9999-4999-8999-999999999999';
const EID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', aud: 'authenticated', exp: now + 3600, email: 'qa@example.test', session_id: 's1' })}.sig`;
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa@example.test', email_confirmed_at: '2026-11-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' };
const session = { access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
const profile = { id: UID, full_name: 'QA', email: 'qa@example.test', role: 'viewer', status: 'active', can_publish: false, created_at: '2026-11-01T00:00:00Z', last_login_at: null, plan: PLAN, plan_source: 'admin', plan_expires_at: null, billing_period: null, must_change_password: false };
const FEATURES = [
  ['idle_logout_min', 'free', true, 30], ['idle_logout_min', 'pro', true, 720], ['idle_logout_min', 'max', true, null],
  ['event_summary', 'free', true, null], ['event_summary', 'max', true, null], ['eei_text', 'max', true, null],
  ['weather', 'max', true, null], ['airfields_ports', 'max', true, null], ['military_assets', 'max', true, null],
].map(([feature_key, plan_id, enabled, limit_value]) => ({ feature_key, plan_id, enabled, limit_value }));
const EVENT = {
  id: EID, title: 'Strike in Tyre', description: 'Two hits on a building.', severity: 'high', latitude: 33.27, longitude: 35.2, location_name: 'Tyre', location_name_he: 'צור', location_name_en: 'Tyre',
  location_precision: 'city', sources: [], locations: [], country: 'Lebanon', region: '', city: 'Tyre', source_name: 'Telegram', source_url: null, source_type: 'social_media',
  occurred_at: new Date(Date.now() - 3600e3).toISOString(), published_at: new Date().toISOString(), is_breaking: false, is_verified: false,
  translations: { he: { title: 'תקיפה בצור', summary: 'שתי פגיעות בבניין.' }, en: { title: 'Strike in Tyre', summary: 'Two hits on a building.' } },
  category_id: null, category_slug: 'airstrike', category_name: 'Airstrike', category_icon: 'Plane', category_color: '#dc2626', category_marker_color: '#dc2626',
  media_kinds: [], report_group: null, source_count: 0, updated_at: new Date().toISOString(),
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/_vercel/')) { res.writeHead(404); return res.end(); } // analytics: not part of the build
  let p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { if (process.env.SW_QA_DEBUG && req.url !== '/') console.error('FALLBACK', req.url); p = path.join(DIST, 'index.html'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const fail = [];
const expect = (name, ok, got) => { if (!ok) fail.push(`${name}: ${JSON.stringify(got)}`); };

(async () => {
  await new Promise((r) => server.listen(4174, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const phone = DEVICE === 'phone';
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(([s, lang, phone]) => {
    localStorage.setItem('ofm.auth', JSON.stringify(s));
    localStorage.setItem('ofm.lang', lang);
    localStorage.setItem('ofm.session.registered', 's1');
    window.__opened = [];
    window.open = (u) => (window.__opened.push(String(u)), { opener: window });
    window.__shared = [];
    if (phone) navigator.share = async (d) => void window.__shared.push(d);
    else try { delete Navigator.prototype.share; } catch {}
  }, [session, LANG, phone]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));

  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith('http://127.0.0.1:4174')) return route.continue();
    if (!url.startsWith(SB)) return route.abort();
    const u = new URL(url);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.pathname.startsWith('/auth/v1/user')) return json(user);
    if (u.pathname.startsWith('/auth/v1/token')) return json(session);
    if (u.pathname.startsWith('/auth/v1/')) return json({});
    if (u.pathname === '/rest/v1/profiles') return json(single ? profile : [profile]);
    if (u.pathname === '/rest/v1/app_settings' && /enforce_plans/.test(u.search)) return json(single ? { value: true } : [{ value: true }]);
    if (u.pathname === '/rest/v1/plan_features') return json(FEATURES);
    if (u.pathname === '/rest/v1/published_events') return json([EVENT]);
    if (u.pathname === '/rest/v1/rpc/otp_status') return json({ required: false, verified: true });
    if (u.pathname.startsWith('/rest/v1/rpc/')) return json(null);
    if (u.pathname.startsWith('/rest/v1/')) return single ? route.fulfill({ status: 406, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' }) }) : json([]);
    return json({});
  });

  const out = { lang: LANG, device: DEVICE, plan: PLAN };
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `sw-${LANG}-${DEVICE}-${PLAN}-${name}.png`) });
  const he = LANG === 'he';

  try {
    await page.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const consent = page.getByRole('button', { name: /^(Reject non-essential|דחיית עוגיות לא-הכרחיות)$/ });
    if (await consent.count()) await consent.first().click().catch(() => {});
    if (phone) {
      const b = page.getByRole('button', { name: he ? /^(עדכונים|פיד|רשימה)/ : /^(Feed|List|Updates)/ }).first();
      if (await b.count()) await b.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // 1. Share: menu (desktop) or share sheet (phone).
    const shareBtn = page.locator('article[id^="event-card-"] [data-event-share]').first();
    out.shareButton = await shareBtn.count();
    expect('share button', out.shareButton === 1, out.shareButton);
    await shareBtn.click();
    await page.waitForTimeout(300);
    if (phone) {
      const shared = await page.evaluate(() => window.__shared);
      out.sheet = shared.length;
      expect('share sheet used', shared.length === 1, shared);
      expect('sheet text is plain and has the link', shared[0] && !shared[0].text.includes('*') && shared[0].text.includes(`https://osintfront.com/e/${EID}`), shared[0]);
      expect('no menu after the sheet', (await page.locator('[data-share-menu]').count()) === 0, 'menu');
    } else {
      out.menuItems = await page.locator('[data-share-menu] [data-share-target]').count();
      expect('menu has 5 items', out.menuItems === 5, out.menuItems);
      await shot('share-menu');
      await page.locator('[data-share-target="telegram"]').click();
      const opened = await page.evaluate(() => window.__opened);
      const tg = opened.find((x) => x.startsWith('https://t.me/share/url'));
      expect('telegram link', !!tg && new URL(tg).searchParams.get('url') === `https://osintfront.com/e/${EID}`, opened);
      expect('menu closes after a pick', (await page.locator('[data-share-menu]').count()) === 0, 'menu');
      await shareBtn.click();
      await page.locator('[data-share-target="whatsapp"]').click();
      const wa = (await page.evaluate(() => window.__opened)).find((x) => x.startsWith('https://wa.me/'));
      expect('whatsapp text as before', !!wa && decodeURIComponent(wa).includes('*'), wa);
      await shareBtn.click();
      await page.locator('[data-share-target="copy"]').click();
      await page.waitForTimeout(300);
      const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
      expect('copy link', clip === `https://osintfront.com/e/${EID}`, clip);
      await page.keyboard.press('Escape');
      expect('escape closes menu', (await page.locator('[data-share-menu]').count()) === 0, 'menu');
    }

    // 2. Info tips in the filter panel (EEI + severity).
    await page.getByRole('button', { name: he ? /^(סינון|מסננים)/ : /^Filters/ }).first().click();
    await page.waitForTimeout(500);
    const dlg = page.locator('[role="dialog"][aria-labelledby="filters-title"]');
    out.filterTips = await dlg.locator('[data-info-tip]').count();
    expect('filter info tips', out.filterTips >= 1, out.filterTips);
    await dlg.locator('[data-info-tip]').first().click();
    const tip = dlg.locator('[role="tooltip"]').first();
    out.tipText = (await tip.innerText().catch(() => '')).slice(0, 60);
    expect('tip opens with text', out.tipText.length > 20, out.tipText);
    if (!he) expect('english tip has no hebrew', !/[֐-׿]/.test(out.tipText), out.tipText);
    const box = await tip.boundingBox();
    const vw = phone ? 390 : 1280;
    expect('tip inside the screen', box && box.x >= 0 && box.x + box.width <= vw + 1, box);
    await shot('info-tip');
    await page.mouse.click(5, 5);
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');

    // 2b. Info tips beside the Weather, Airfields & ports and Military bases sections.
    if (!phone) {
      await page.getByRole('button', { name: he ? 'שכבות מודיעין' : 'Intelligence layers' }).first().click();
      await page.waitForTimeout(600);
      out.layerTips = await page.locator('[data-layer-section] + [data-info-tip], [data-layer-section] ~ span [data-info-tip]').count();
      expect('three layer info tips', out.layerTips === 3, out.layerTips);
      await page.locator('[data-layer-section] ~ span [data-info-tip]').nth(2).hover();
      await page.waitForTimeout(200);
      await shot('layers');
    }

    // 3. Control-room screen on the account page.
    await page.goto('http://127.0.0.1:4174/account', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    out.controlRoom = await page.locator('[data-control-room]').count();
    expect('control-room card', out.controlRoom === 1, out.controlRoom);
    if (PLAN === 'max') {
      await page.locator('[data-control-room-toggle]').check();
      out.saved = await page.evaluate(() => localStorage.getItem('ofm.controlRoom'));
      expect('choice saved', out.saved === '1', out.saved);
    } else {
      expect('free: no toggle', (await page.locator('[data-control-room-toggle]').count()) === 0, 'toggle');
      await page.locator('[data-control-room-locked]').click();
      const gate = page.locator('[data-gate="upgrade"]');
      out.gate = (await gate.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120);
      expect('upgrade window names Max', /Max/.test(out.gate), out.gate);
      await page.evaluate(() => localStorage.setItem('ofm.controlRoom', '1')); // forced: must not count on Free
    }
    await shot('account');

    // 4. Session clock 1 minute before its end: Max in control-room mode renews silently; Free is asked.
    await page.evaluate(() => localStorage.setItem('ofm.session.started', String(Date.now() - 24 * 3600e3 + 60e3)));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const asked = await page.locator('#session-title').count();
    const started = Number(await page.evaluate(() => localStorage.getItem('ofm.session.started')));
    out.renewedAgoSec = Math.round((Date.now() - started) / 1000);
    if (PLAN === 'max') {
      expect('no session question', asked === 0, asked);
      expect('clock renewed', out.renewedAgoSec < 30, out.renewedAgoSec);
    } else {
      expect('free is asked', asked === 1, asked);
    }
    await shot('session');
  } catch (e) {
    fail.push(`exception: ${String(e).slice(0, 300)}`);
    await shot('error').catch(() => {});
  }
  if (errors.length) fail.push(...errors);
  console.log(JSON.stringify(out, null, 1));
  console.log(fail.length ? `FAIL\n${fail.join('\n')}` : 'PASS');
  await browser.close();
  server.close();
  process.exit(fail.length ? 1 : 0);
})();
