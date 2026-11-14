// Info tips — browser checks (Playwright) against a local build and a FAKED Supabase.
// No real database: every Supabase request (and the site's own /api/*) is answered here, so it checks
// the (i) beside every map style, Intelligence layer and sub-layer: the text, that the tooltip is fully
// on screen and on top (390 px phone and desktop, Hebrew RTL and English), that a tap on (i) never
// toggles a layer, changes the style, closes the style menu or opens the sign-up / upgrade window,
// that only one tip is open at a time, and that Escape and a tap elsewhere close it. Also: style rows
// stay one line, the (i) is never inside a button / label / link, its tap area is >= 32 px on a phone,
// the tip closes when its (i) scrolls out of view or focus leaves it (Tab), light and dark theme.
//
// Build:  VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=<any JWT with role anon> \
//         VITE_SITE_URL=https://osintfront.com npx vite build --outDir /tmp/tips-qa/dist --emptyOutDir
// Run:    TIPS_QA_DIST=/tmp/tips-qa/dist node tests/e2e/info-tips.mock.cjs <he|en> <desktop|phone> <pro|guest>
//         (PLAYWRIGHT_PATH = the playwright module when it is not installed here; CHROME_PATH = the browser;
//          TIPS_QA_SHOTS = folder for screenshots; TIPS_QA_ONLY=existing checks only the older group tips)
// Passes when it prints "PASS" and exits 0.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const LANG = process.argv[2] || 'he';
const DEVICE = process.argv[3] || 'desktop';
const PLAN = process.argv[4] || 'pro';
const DIST = process.env.TIPS_QA_DIST || '/tmp/tips-qa/dist';
const SHOTS = process.env.TIPS_QA_SHOTS || require('os').tmpdir();
const ONLY = process.env.TIPS_QA_ONLY || '';
const SB = 'https://fake.supabase.co';
const UID = '99999999-9999-4999-8999-999999999999';
const PORT = 4174 + Math.floor(Math.random() * 500);
const ROOT = path.join(__dirname, '..', '..');

// The registry and the dictionaries, read as text (the same lists the app uses).
const KEYS = [...fs.readFileSync(path.join(ROOT, 'src/lib/infoTips.ts'), 'utf8').matchAll(/^\s*'(info\.[^']+)',$/gm)].map((m) => m[1]);
const dictText = (lang, key) => {
  const src = fs.readFileSync(path.join(ROOT, `src/i18n/${lang}.ts`), 'utf8');
  const m = new RegExp(`^\\s*"${key.replace(/\./g, '\\.')}":\\s*(".*"),\\s*$`, 'm').exec(src);
  return m ? JSON.parse(m[1]) : null;
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', aud: 'authenticated', exp: now + 3600, email: 'qa@example.test' })}.sig`;
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa@example.test', email_confirmed_at: '2026-11-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' };
const session = { access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
const profile = { id: UID, full_name: 'QA', email: 'qa@example.test', role: 'viewer', status: 'active', can_publish: false, created_at: '2026-11-01T00:00:00Z', last_login_at: null, plan: 'pro', plan_source: 'admin', plan_expires_at: null, billing_period: null, must_change_password: false };

const FEATURES = ['live_map', 'feed', 'event_open', 'event_summary', 'source_link', 'media', 'archive_days', 'feed_search', 'copy_text', 'share_daily', 'filter_sets', 'eei_text'];
const LOCKED = ['ships_aircraft', 'satellite', 'weather', 'airfields_ports', 'military_assets'];
const planRows = [
  ...['guest', 'free', 'pro', 'max'].flatMap((p) => FEATURES.map((k) => ({ feature_key: k, plan_id: p, enabled: true, limit_value: null }))),
  ...['guest', 'free', 'pro', 'max'].flatMap((p) => LOCKED.map((k) => ({ feature_key: k, plan_id: p, enabled: p === 'pro' || p === 'max', limit_value: null }))),
  { feature_key: 'feed_delay_min', plan_id: 'guest', enabled: true, limit_value: 0 },
];
const day = (n) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const errors = [];
const fails = [];
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(`${name}${detail ? `: ${detail}` : ''}`);
};

async function routeAll(page) {
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    const u = new URL(url);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' };
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { ...cors, 'content-range': '0-0/*' }, body: JSON.stringify(body) });
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) {
      if (u.pathname === '/api/sat') {
        if (u.searchParams.get('key')) return json({ k: '', sentinel2: false });
        if (u.searchParams.get('dates')) return json({ dates: [{ date: day(2), cloud: 4 }, { date: day(9), cloud: 12 }] });
        return route.fulfill({ status: 404, body: '' });
      }
      if (u.pathname === '/api/aircraft') return json({ planes: [] });
      if (u.pathname.startsWith('/api/')) return json({});
      return route.continue();
    }
    if (!url.startsWith(SB)) return route.abort();
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
    if (u.pathname === '/rest/v1/rpc/use_feature') return json({ ok: true, reason: null, used: 1, limit: null, remaining: null });
    if (u.pathname === '/rest/v1/rpc/my_feature_usage') return json({});
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
    ? { styles: 'סגנון מפה', intel: /שכבות מודיעין/, filters: /^(סינון|מסננים ·)/ }
    : { styles: 'Map style', intel: /Intelligence layers/, filters: /^Filters( ·|$)/ };

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
  await routeAll(page);

  const tap = async (loc) => (phone ? loc.tap() : loc.click());
  const tipBtn = (key) => page.locator(`[data-info-tip="${key}"]`);
  // IconButton labels are role=tooltip too: an InfoTip's tooltip also carries data-info-tooltip.
  const tooltips = () => page.locator('[role="tooltip"][data-info-tooltip]');
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `info-tips-${LANG}-${DEVICE}-${PLAN}-${name}.png`) });
  const checkboxes = () => page.evaluate(() => [...document.querySelectorAll('input[type="checkbox"]')].map((x) => x.checked).join(''));
  const gateOpen = async () => (await page.locator('[data-gate]').count()) > 0;
  // The open tooltip: fully inside the window and the top element at its centre.
  const placed = () => page.evaluate(() => {
    const el = document.querySelector('[role="tooltip"][data-info-tooltip]');
    if (!el) return { ok: false, why: 'no tooltip' };
    const r = el.getBoundingClientRect();
    const inside = r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight && r.width > 0 && r.height > 0;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const onTop = !!hit && (hit === el || el.contains(hit));
    return { ok: inside && onTop, why: `rect ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)} in ${window.innerWidth}x${window.innerHeight}, onTop ${onTop}` };
  });
  /** Tap one (i): exactly one tooltip, the dictionary text (when a key), on screen, nothing toggled. */
  const tryTip = async (loc, key, label) => {
    await loc.scrollIntoViewIfNeeded();
    const before = await checkboxes();
    const style = await page.evaluate(() => localStorage.getItem('ofm.mapStyle'));
    await tap(loc);
    await page.waitForTimeout(150);
    check(`${label} one tooltip`, (await tooltips().count()) === 1, String(await tooltips().count()));
    if (key) {
      const want = dictText(LANG, key);
      const got = await tooltips().first().textContent().catch(() => null);
      check(`${label} text`, got === want, `${got} ≠ ${want}`);
    }
    const p = await placed();
    check(`${label} on screen`, p.ok, p.why);
    check(`${label} no toggle`, (await checkboxes()) === before);
    check(`${label} style kept`, (await page.evaluate(() => localStorage.getItem('ofm.mapStyle'))) === style);
    check(`${label} no gate`, !(await gateOpen()));
  };
  const closeTip = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  };
  /** No (i) inside a button, label or link (it is a button itself: look from its parent up). */
  const notNested = async (where) => {
    const bad = await page.locator('[data-info-tip]').evaluateAll((els) => els
      .filter((e) => e.parentElement && e.parentElement.closest('button,label,a'))
      .map((e) => e.getAttribute('data-info-tip') || '(group)'));
    check(`${where}: no (i) inside a button/label/link`, bad.length === 0, bad.join(','));
  };
  /** Phone: what is under the point 14 px from the icon centre is still this (i) (a >= 32 px tap area).
   *  Below/above, a neighbouring (i) in the next row may cover it (unavoidable when rows are 26 px apart). */
  const hitArea = async (loc, label) => {
    // Middle of its panel: at the panel's bottom edge the OFI button may sit over it.
    await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(100);
    const r = await loc.evaluate((btn) => {
      const b = btn.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const at = (x, y) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'none';
        if (el === btn || btn.contains(el)) return 'self';
        const other = el.closest('[data-info-tip]');
        return other ? 'other-tip' : el.tagName.toLowerCase() + (el.getAttribute('type') ? `[${el.getAttribute('type')}]` : '');
      };
      return { left: at(cx - 14, cy), right: at(cx + 14, cy), up: at(cx, cy - 14), down: at(cx, cy + 14) };
    });
    const ok = r.left === 'self' && r.right === 'self' && ['self', 'other-tip'].includes(r.up) && ['self', 'other-tip'].includes(r.down);
    check(`${label} tap area >= 32 px`, ok, JSON.stringify(r));
  };

  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const consent = page.getByRole('button', { name: /^(Reject non-essential|דחיית עוגיות לא-הכרחיות)$/ });
    if (await consent.count()) await consent.first().click().catch(() => {});
    check('dir', (await page.evaluate(() => document.documentElement.dir)) === (LANG === 'he' ? 'rtl' : 'ltr'));
    const seen = new Set();
    const collect = async () => (await page.locator('[data-info-tip]').evaluateAll((els) => els.map((e) => e.getAttribute('data-info-tip')))).forEach((k) => k && seen.add(k));

    if (ONLY !== 'existing') {
      // 1. Style menu: 8 tips; the satellite one opens on screen, the menu stays, the style does not change.
      const styleBtn = page.getByRole('button', { name: T.styles, exact: true });
      await tap(styleBtn);
      const menu = page.locator('[role="menu"]');
      await menu.waitFor({ timeout: 5000 });
      out.styleTips = await menu.locator('[data-info-tip^="info.style."]').count();
      check('8 style tips', out.styleTips === 8, String(out.styleTips));
      await collect();
      // Every style row one line (<= 40 px) unless it shows the "style failed" note; the menu fits the screen.
      const rows = await menu.locator('[role="menuitemradio"]').evaluateAll((els) => els.map((e) => ({
        h: Math.round(e.getBoundingClientRect().height), note: !!e.querySelector('span.block'), text: e.textContent.trim().slice(0, 30),
      })));
      out.styleRowHeights = rows.map((r) => r.h);
      const tall = rows.filter((r) => !r.note && r.h > 40);
      check('style rows one line', tall.length === 0, JSON.stringify(tall));
      const mbox = await menu.boundingBox();
      check('style menu fits the screen', mbox && mbox.x >= 0 && mbox.x + mbox.width <= (phone ? 390 : 1280), JSON.stringify(mbox));
      await notNested('style menu');
      if (phone) await hitArea(tipBtn('info.style.light'), 'style light');
      const checkedBefore = await menu.locator('[role="menuitemradio"][aria-checked="true"]').count();
      const checkedId = await menu.locator('[role="menuitemradio"][aria-checked="true"]').textContent();
      await tryTip(tipBtn('info.style.satellite'), 'info.style.satellite', 'style satellite');
      check('menu stays open', (await menu.count()) === 1);
      check('style unchanged', (await menu.locator('[role="menuitemradio"][aria-checked="true"]').count()) === checkedBefore
        && (await menu.locator('[role="menuitemradio"][aria-checked="true"]').textContent()) === checkedId);
      if (phone) await shot('style-menu');
      // 2. A second tip closes the first.
      await tryTip(tipBtn('info.style.topo'), 'info.style.topo', 'style topo');
      check('menu stays open (2)', (await menu.count()) === 1);
      // Every style tip on screen (the first and last rows sit near the menu's edges).
      // (An open tooltip may cover the next row's (i): close it first, as a reader would.)
      for (const id of ['standard', 'cyclosm', 'hybrid', 'light', 'dark', 'vector']) {
        await closeTip();
        await tryTip(tipBtn(`info.style.${id}`), `info.style.${id}`, `style ${id}`);
        check(`menu open after ${id}`, (await menu.count()) === 1);
      }
      // 3. Escape closes; a tap on the map closes.
      await closeTip();
      check('escape closes', (await tooltips().count()) === 0);
      await tap(tipBtn('info.style.standard'));
      await page.waitForTimeout(150);
      check('reopens', (await tooltips().count()) === 1);
      const spot = await page.evaluate(() => {
        const m = document.querySelector('.leaflet-container').getBoundingClientRect();
        for (const fy of [0.85, 0.75, 0.65]) for (const fx of [0.5, 0.8, 0.2]) {
          const x = m.left + m.width * fx, y = m.top + m.height * fy;
          const el = document.elementFromPoint(x, y);
          if (el && el.closest('.leaflet-container') && !el.closest('[role="menu"], .leaflet-marker-icon, .leaflet-control, button, a')) return { x, y };
        }
        return null;
      });
      check('map spot found', !!spot);
      if (spot) {
        if (phone) await page.touchscreen.tap(spot.x, spot.y);
        else await page.mouse.click(spot.x, spot.y);
        await page.waitForTimeout(200);
        check('tap on map closes', (await tooltips().count()) === 0);
      }
      if (await menu.count()) await tap(styleBtn);
      await page.waitForTimeout(200);

      // Check 1 again in both themes: the satellite tip opens fully on screen and on top.
      for (let n = 0; n < 2; n++) {
        const theme = (await page.evaluate(() => document.documentElement.classList.contains('dark'))) ? 'dark' : 'light';
        if (!(await menu.count())) await tap(styleBtn);
        await menu.waitFor({ timeout: 5000 });
        await tryTip(tipBtn('info.style.satellite'), 'info.style.satellite', `${theme} theme: style satellite`);
        const bg = await tooltips().first().evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => null);
        check(`${theme} theme: tooltip has a background`, !!bg && bg !== 'rgba(0, 0, 0, 0)', String(bg));
        out[`theme${n}`] = theme;
        await closeTip();
        await tap(styleBtn); // close the menu
        await page.waitForTimeout(150);
        await tap(page.getByRole('button', { name: /^(Switch to (dark|light) mode|מעבר למצב (כהה|בהיר))$/ }).first());
        await page.waitForTimeout(400);
      }
      check('both themes checked', out.theme0 && out.theme1 && out.theme0 !== out.theme1, `${out.theme0}/${out.theme1}`);

      // Desktop keyboard: Enter pins the tip, Tab away closes it.
      if (!phone) {
        await tap(styleBtn);
        await menu.waitFor({ timeout: 5000 });
        await tipBtn('info.style.topo').focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(150);
        check('keyboard: Enter opens', (await tooltips().count()) === 1);
        await page.mouse.move(5, 5); // no hover keeping it open
        await page.keyboard.press('Tab');
        await page.waitForTimeout(150);
        check('keyboard: Tab away closes', (await tooltips().count()) === 0);
        await tap(styleBtn);
        await page.waitForTimeout(150);
      }
    }

    // 4. Intelligence panel: reveal the sub-rows (pro), collect every tip.
    await tap(page.getByRole('button', { name: T.intel }).first());
    await page.waitForTimeout(600);
    const panel = page.locator('div.ofm-scroll').filter({ has: page.locator('h2') }).first();
    await panel.waitFor({ timeout: 5000 });
    const headBox = (key) => tipBtn(key).locator('xpath=ancestor::div[contains(@class,"flex")][1]').locator('input[type="checkbox"]').first();
    const openSection = async (id) => {
      const sec = page.locator(`[data-layer-section="${id}"]`);
      // One retry, counted in the output: a first tap was once lost right after a fresh build (layout still settling).
      for (let n = 0; n < 2 && (await sec.getAttribute('aria-expanded')) === 'false'; n++) {
        if (n) out.sectionRetries = (out.sectionRetries || 0) + 1;
        await sec.scrollIntoViewIfNeeded();
        await tap(sec);
        await page.waitForTimeout(300);
      }
    };

    if (ONLY === 'existing') {
      for (const id of ['weather', 'infra', 'military']) {
        const loc = page.locator(`[data-layer-section="${id}"]`).locator('xpath=..').locator('[data-info-tip=""]');
        await tryTip(loc, `info.${id}`, `group ${id}`);
        await closeTip();
      }
    } else if (PLAN === 'pro') {
      for (const key of ['info.sat', 'info.ships', 'info.planes']) {
        await headBox(key).scrollIntoViewIfNeeded();
        await tap(headBox(key));
        await page.waitForTimeout(900);
        check(`${key} turned on`, await headBox(key).isChecked());
      }
      for (const id of ['weather', 'infra', 'military']) await openSection(id);
      await page.waitForTimeout(500);
      await collect();
      const got = [...seen].sort();
      const want = [...KEYS].sort();
      out.tipKeys = got.length;
      check('all keys on the page', JSON.stringify(got) === JSON.stringify(want),
        `missing ${want.filter((k) => !seen.has(k)).join(',')} extra ${got.filter((k) => !KEYS.includes(k)).join(',')}`);
      await notNested('panel');
      if (phone) {
        for (const key of ['info.shipsSilent', 'info.planesMil', 'info.wx.rain', 'info.mil.naval']) await hitArea(tipBtn(key), key);
        // A row's checkbox still toggles with the larger (i) beside it.
        for (const sel of ['[data-show-silent]', '[data-weather-toggle="rain"]', '[data-mil-toggle="naval"]']) {
          const box = page.locator(sel);
          await box.scrollIntoViewIfNeeded();
          const was = await box.isChecked();
          await box.tap();
          await page.waitForTimeout(300);
          check(`${sel} toggles on tap`, (await box.isChecked()) === !was);
          await box.tap();
          await page.waitForTimeout(300);
          check(`${sel} toggles back`, (await box.isChecked()) === was);
        }
      }
      // The tip closes when its (i) scrolls out of the panel's view.
      await tipBtn('info.sat').scrollIntoViewIfNeeded();
      await tap(tipBtn('info.sat'));
      await page.waitForTimeout(150);
      check('scroll-out: tip open', (await tooltips().count()) === 1);
      if (!phone) await page.mouse.move(5, 5); // so a row scrolled under the mouse does not open its own tip
      await panel.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(300);
      check('scroll-out: tip closed when (i) leaves view', (await tooltips().count()) === 0, String(await tooltips().first().textContent().catch(() => '')));
      await panel.evaluate((el) => { el.scrollTop = 0; });
      await page.waitForTimeout(150);
      // 5. Every tip in the panel (new keys and the three group tips): on screen, nothing toggled.
      const panelKeys = await panel.locator('[data-info-tip]').evaluateAll((els) => els.map((e) => e.getAttribute('data-info-tip')));
      out.panelTips = panelKeys.length;
      let shotDone = false;
      for (let i = 0; i < panelKeys.length; i++) {
        const key = panelKeys[i];
        await tryTip(panel.locator('[data-info-tip]').nth(i), key || null, `panel ${key || `group#${i}`}`);
        if (phone && !shotDone && key === 'info.shipsSilent') {
          await shot('panel');
          shotDone = true;
        }
        await closeTip();
      }
      check('no tooltip left', (await tooltips().count()) === 0);
      check('panel open', (await panel.count()) === 1);
    } else {
      // 6. Guest: (i) beside locked layers shows the text, no sign-up window, the layer stays off.
      await notNested('panel (guest)');
      if (phone) await hitArea(tipBtn('info.ships'), 'guest info.ships');
      for (const key of ['info.sat', 'info.ships', 'info.planes', 'info.control']) {
        await tryTip(tipBtn(key), key, `guest ${key}`);
        check(`guest ${key} off`, !(await headBox(key).isChecked()));
        await closeTip();
      }
      await openSection('military');
      await tryTip(tipBtn('info.mil.base'), 'info.mil.base', 'guest info.mil.base');
      check('guest mil.base off', !(await page.locator('[data-mil-toggle="base"]').isChecked()));
      await closeTip();
      await openSection('weather');
      await tryTip(tipBtn('info.wx.clouds'), 'info.wx.clouds', 'guest info.wx.clouds');
      check('guest clouds off', !(await page.locator('[data-weather-toggle="clouds"]').isChecked()));
      await closeTip();
      check('guest no gate at end', !(await gateOpen()));
    }

    // The two older tips in the filter panel (EEI, severity) still open on screen.
    if (PLAN === 'pro' && (ONLY === 'existing' || !ONLY)) {
      await tap(page.getByRole('button', { name: T.filters }).first());
      const dlg = page.locator('[role="dialog"][aria-labelledby="filters-title"]');
      await dlg.waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);
      const old = dlg.locator('[data-info-tip=""]');
      out.filterTips = await old.count();
      // EEI is switched off in the filter panel for now (SHOW_EEI): severity at least.
      check('filter panel tips', out.filterTips >= 1, String(out.filterTips));
      const texts = [dictText(LANG, 'info.eei'), dictText(LANG, 'info.severity')];
      for (let i = 0; i < out.filterTips; i++) {
        await tryTip(old.nth(i), null, `filters tip ${i}`);
        const got = await tooltips().first().textContent().catch(() => null);
        check(`filters tip ${i} text`, texts.includes(got), String(got));
        await tap(old.nth(i)); // a second tap on the (i) closes it
        await page.waitForTimeout(150);
        check(`filters tip ${i} second tap closes`, (await tooltips().count()) === 0);
      }
      await notNested('filter panel');
    }
  } catch (e) {
    fails.push(`crash: ${String(e).slice(0, 1500)}`);
  }

  out.errors = errors;
  out.fails = fails;
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
  server.close();
  const pass = fails.length === 0 && errors.length === 0;
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})();
