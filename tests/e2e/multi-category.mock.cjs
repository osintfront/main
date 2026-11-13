// Several event types — browser checks (Playwright) against a local build and a FAKED Supabase.
// Secondary-type badges, the skull pin, the type filter with and without secondary types, counts,
// the legend (main type only), Hebrew / English, desktop / phone, and screenshots for the owner.
//
// Build:  VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=<any JWT with role anon> \
//         VITE_SITE_URL=https://osintfront.com npx vite build --outDir /tmp/sets-qa/dist --emptyOutDir
// Run:    SETS_QA_DIST=/tmp/sets-qa/dist node tests/e2e/multi-category.mock.cjs <he|en> <desktop|phone>
//         (PLAYWRIGHT_PATH = the playwright module when it is not installed here; CHROME_PATH = the browser)
// Passes when it prints "PASS" and exits 0.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const LANG = process.argv[2] || 'he';
const DEVICE = process.argv[3] || 'desktop';
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
const profile = { id: UID, full_name: 'QA', email: 'qa@example.test', role: 'viewer', status: 'active', can_publish: false, created_at: '2026-11-01T00:00:00Z', last_login_at: null, plan: 'pro', plan_source: 'admin', plan_expires_at: null, billing_period: null, must_change_password: false };

const CAT = {
  killed: ['Killed', 'Skull', '#27272a'],
  wounded: ['Wounded', 'MedicalCross', '#701a75'],
  airstrike: ['Airstrike', 'Plane', '#9333ea'],
  'artillery-shelling': ['Artillery shelling', 'Artillery', '#b45309'],
  assassination: ['Assassination', 'Target', '#991b1b'],
};
let seq = 0;
const ev = (key, title, slug, secondary, lat, lng, hoursAgo, locations = []) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`, key, title, description: `${title} desc`, severity: 'high', latitude: lat, longitude: lng,
  location_name: title.split(' in ')[1] || title, location_name_he: null, location_name_en: null, location_precision: 'city', sources: [], locations,
  country: 'Lebanon', region: '', city: '', source_name: 'Telegram', source_url: null, source_type: 'social_media',
  occurred_at: new Date(Date.now() - hoursAgo * H).toISOString(), published_at: new Date().toISOString(), is_breaking: false, is_verified: false,
  translations: {}, category_id: null, category_slug: slug, category_name: CAT[slug][0], category_icon: CAT[slug][1], category_color: CAT[slug][2], category_marker_color: CAT[slug][2],
  media_kinds: [], report_group: null, source_count: 0, updated_at: new Date().toISOString(), secondary_categories: secondary,
});
const LIVE = [
  ev('A', 'Dead in Tyre', 'killed', ['airstrike'], 33.27, 35.2, 1, [
    { name: 'Tyre', name_en: 'Tyre', lat: 33.27, lng: 35.2, category_slug: 'killed' },
    { name: 'Qana', name_en: 'Qana', lat: 33.21, lng: 35.3, category_slug: 'killed' },
  ]),
  ev('B', 'Strike in Nabatieh', 'airstrike', ['wounded'], 33.38, 35.48, 1.5),
  ev('C', 'Strike in Sidon', 'airstrike', [], 33.56, 35.37, 2),
  ev('D', 'Shelling in Khiam', 'artillery-shelling', ['force-sighting'], 33.33, 35.61, 2.5),
  ev('E', 'Commander in Bint Jbeil', 'assassination', ['killed', 'airstrike'], 33.12, 35.43, 3),
];
const WOUNDED = ev('W', 'Hurt in Marjayoun', 'wounded', ['shooting-gunfire'], 33.36, 35.59, 0.5);
let events = LIVE;
const FEATURES = ['live_map', 'feed', 'event_open', 'event_summary', 'source_link', 'media', 'archive_days', 'feed_search', 'copy_text', 'share_daily'];
const planRows = [
  ...['guest', 'free', 'pro', 'max'].flatMap((p) => FEATURES.map((k) => ({ feature_key: k, plan_id: p, enabled: true, limit_value: null }))),
  { feature_key: 'feed_delay_min', plan_id: 'guest', enabled: true, limit_value: 0 },
  { feature_key: 'filter_sets', plan_id: 'pro', enabled: true, limit_value: 6 },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
const errors = [];

async function routeAll(page) {
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
    if (!url.startsWith(SB)) return route.abort();
    const u = new URL(url);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' };
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { ...cors, 'content-range': '0-0/*' }, body: JSON.stringify(body) });
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const none = () => route.fulfill({ status: 406, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' }) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname.startsWith('/auth/v1/user')) return json(user);
    if (u.pathname.startsWith('/auth/v1/token')) return json(session);
    if (u.pathname.startsWith('/auth/v1/')) return json({});
    if (u.pathname === '/rest/v1/app_settings') {
      const wanted = u.searchParams.get('key') || '';
      if (single) return /enforce_plans/.test(wanted) ? json({ value: true }) : none();
      return json(/enforce_plans/.test(wanted) || !wanted ? [{ key: 'enforce_plans', value: true }] : []);
    }
    if (u.pathname === '/rest/v1/plan_features') return json(planRows);
    if (u.pathname === '/rest/v1/profiles') return json(single ? profile : [profile]);
    if (u.pathname === '/rest/v1/published_events') {
      if (!(u.searchParams.get('select') || '').includes('secondary_categories')) errors.push('select without secondary_categories');
      const m = /in\.\(([^)]*)\)/.exec(u.searchParams.get('id') || '');
      const rows = events.map(({ key: _k, ...r }) => r);
      return json(m ? rows.filter((e) => m[1].replace(/"/g, '').split(',').includes(e.id)) : rows);
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
  const out = { lang: LANG, device: DEVICE };
  const T = LANG === 'he'
    ? { filters: /^(סינון|מסננים ·)/, air: /^תקיפה אווירית/, killed: /^הרוגים/, wounded: /^פצועים/, killedText: 'הרוגים', woundedText: 'פצועים', include: 'כולל סוגים משניים', legend: /^מקרא/ }
    : { filters: /^Filters( ·|$)/, air: /^Airstrike/, killed: /^Killed/, wounded: /^Wounded/, killedText: 'Killed', woundedText: 'Wounded', include: 'Include secondary types', legend: /^(Legend|Show legend)/ };

  async function open(theme = 'light') {
    const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone });
    await ctx.addInitScript(([s, lang, theme]) => {
      if (sessionStorage.getItem('qa-seeded')) return;
      sessionStorage.setItem('qa-seeded', '1');
      localStorage.setItem('ofm.auth', JSON.stringify(s));
      localStorage.setItem('ofm.lang', lang);
      localStorage.setItem('ofm.theme', theme);
    }, [session, LANG, theme]);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|net::ERR|ERR_FAILED/.test(m.text())) errors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => { if (!/Unexpected token '<'/.test(String(e))) errors.push(`pageerror: ${String(e).slice(0, 300)}`); });
    await routeAll(page);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const consent = page.getByRole('button', { name: /^(Reject non-essential|דחיית עוגיות לא-הכרחיות)$/ });
    if (await consent.count()) await consent.first().click().catch(() => {});
    return { ctx, page };
  }
  const showFeed = async (page) => {
    if (!phone) return;
    const b = page.getByRole('button', { name: LANG === 'he' ? /^(עדכונים|פיד|רשימה)/ : /^(Feed|List|Updates)/ }).first();
    if (await b.count()) await b.click().catch(() => {});
    await page.waitForTimeout(300);
  };
  const showMap = async (page) => {
    if (!phone) return;
    const m = page.getByRole('button', { name: LANG === 'he' ? /^מפה$/ : /^Map$/ }).first();
    if (await m.count()) await m.click().catch(() => {});
    await page.waitForTimeout(400);
  };
  const card = (page, key) => page.locator(`#event-card-${LIVE.find((e) => e.key === key).id}`);
  const shownKeys = async (page) => {
    const ids = await page.locator('article[id^="event-card-"]').evaluateAll((els) => els.map((e) => e.id.replace('event-card-', '')));
    return LIVE.filter((e) => ids.includes(e.id)).map((e) => e.key).join('');
  };

  try {
    let { ctx, page } = await open();
    await showFeed(page);

    // 1. badges
    out.c1_killedBadge = (await card(page, 'A').innerText()).includes(T.killedText);
    out.c1_oneSecondary = (await card(page, 'A').locator('[data-secondary-type="airstrike"]').count()) === 1;
    out.c1_noneOnC = (await card(page, 'C').locator('[data-secondary-type]').count()) === 0;

    // 6. legend: main types only
    await showMap(page);
    const legendBtn = page.getByRole('button', { name: LANG === 'he' ? /מקרא/ : /legend/i }).first();
    if (await legendBtn.count()) await legendBtn.click().catch(() => {});
    await page.waitForTimeout(400);
    const legend = page.locator('section[aria-labelledby="legend-heading"] ul').first();
    const rows = await legend.locator('li').allInnerTexts();
    out.c6_killedOne = rows.some((r) => r.includes(T.killedText) && /\b1\s*$/.test(r.trim()));
    out.c6_noWounded = !rows.some((r) => r.includes(T.woundedText));
    if (await legendBtn.count()) await legendBtn.click().catch(() => {});

    // 2. both pins of A show the skull, not a plane
    await showFeed(page);
    await card(page, 'A').locator('h3').first().click();
    await page.waitForTimeout(2000);
    await showMap(page);
    out.c2_skullPins = await page.locator('.leaflet-marker-icon svg.lucide-skull').count();
    out.c2_skullNoPlane = (await page.locator('.leaflet-marker-icon:has(svg.lucide-skull) svg.lucide-plane').count()) === 0;
    await page.keyboard.press('Escape');

    // 3. type Airstrike: main or secondary
    const dlg = page.locator('[role="dialog"][aria-labelledby="filters-title"]');
    const openPanel = async () => {
      if (await dlg.count()) return;
      await page.getByRole('button', { name: T.filters }).first().click();
      await dlg.waitFor({ timeout: 5000 });
    };
    const closePanel = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); };
    const chip = (re) => dlg.getByRole('button', { name: re }).first();
    const chipCount = async (re) => Number(((await chip(re).innerText()).match(/(\d+)\s*$/) || [])[1]);
    const keysNow = async () => { await closePanel(); await showFeed(page); const k = await shownKeys(page); await openPanel(); return k; };
    await openPanel();
    out.c7_includeLabel = (await dlg.getByText(T.include, { exact: true }).count()) === 1;
    out.c7_killedChip = (await chip(T.killed).count()) === 1 && (await chip(T.wounded).count()) === 1;
    await chip(T.air).click();
    await page.waitForTimeout(300);
    out.c3_airCount = await chipCount(T.air); // 4
    out.c3_keys = await keysNow(); // ABCE

    // 4. main only
    await dlg.locator('[data-testid="include-secondary"]').uncheck();
    await page.waitForTimeout(300);
    out.c4_airCount = await chipCount(T.air); // 2
    out.c4_keys = await keysNow(); // BC
    await closePanel();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await openPanel();
    out.c4_stillOff = !(await dlg.locator('[data-testid="include-secondary"]').isChecked());

    // 5. on again; only Wounded → B; only Killed → A, E
    await dlg.locator('[data-testid="include-secondary"]').check();
    await chip(T.air).click();
    await chip(T.wounded).click();
    await page.waitForTimeout(300);
    out.c5_wounded = await keysNow(); // B
    await chip(T.wounded).click();
    await chip(T.killed).click();
    await page.waitForTimeout(300);
    out.c5_killed = await keysNow(); // AE
    await chip(T.killed).click();
    await closePanel();
    await ctx.close();

    // 8. screenshots for the owner: the skull pin and a Wounded-main pin, light and dark
    events = [...LIVE, WOUNDED];
    for (const theme of ['light', 'dark']) {
      ({ ctx, page } = await open(theme));
      await showFeed(page);
      await page.locator(`#event-card-${WOUNDED.id} h3`).first().click();
      await page.waitForTimeout(2000);
      await showMap(page);
      out[`c8_crossPin_${theme}`] = (await page.locator('.leaflet-marker-icon svg.lucide-medical-cross').count()) >= 1;
      await page.screenshot({ path: path.join(SHOTS, `multi-category-${LANG}-${theme}${phone ? '-phone' : ''}.png`) });
      await ctx.close();
    }
  } catch (e) {
    out.FAILED = String(e).slice(0, 400);
  }

  out.consoleErrors = errors.slice(0, 5);
  const bad = [];
  for (const [k, v] of Object.entries(out)) if (v === false) bad.push([k, v]);
  const expect = { c3_airCount: 4, c3_keys: 'ABCE', c4_airCount: 2, c4_keys: 'BC', c5_wounded: 'B', c5_killed: 'AE' };
  for (const [k, v] of Object.entries(expect)) if (out[k] !== v) bad.push([k, out[k]]);
  if (!(out.c2_skullPins >= 2)) bad.push(['c2_skullPins', out.c2_skullPins]);
  if (out.consoleErrors.length) bad.push(['consoleErrors', out.consoleErrors]);
  if (out.FAILED) bad.push(['FAILED', out.FAILED]);
  console.log(JSON.stringify(out, null, 1));
  console.log(bad.length ? `FAIL ${JSON.stringify(bad)}` : 'PASS');
  process.exitCode = bad.length ? 1 : 0;
  await browser.close();
  server.close();
})();
