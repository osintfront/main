// Filter sets — browser checks (Playwright) against a local build and a FAKED Supabase.
// No real database: every Supabase request is answered here (plans enforced, plan rows, events,
// archive), so it checks the map page itself — sets in force, colours, tags, archive range,
// switching off, plan limits, Hebrew / English, desktop / phone.
//
// Build:  VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=<any JWT with role anon> \
//         VITE_SITE_URL=https://osintfront.com npx vite build --outDir /tmp/sets-qa/dist --emptyOutDir
// Run:    SETS_QA_DIST=/tmp/sets-qa/dist node tests/e2e/filter-sets.mock.cjs <he|en> <desktop|phone> <pro|free|guest>
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
const SHOTS = process.env.SETS_QA_SHOTS || require('os').tmpdir();
const SB = 'https://fake.supabase.co';
const UID = '99999999-9999-4999-8999-999999999999';
const KEY = 'ofm.filterSets.v1';
const H = 3600e3;
const PORT = 4174 + Math.floor(Math.random() * 500);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', aud: 'authenticated', exp: now + 3600, email: 'qa@example.test' })}.sig`;
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa@example.test', email_confirmed_at: '2026-11-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' };
const session = { access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
const profile = { id: UID, full_name: 'QA', email: 'qa@example.test', role: 'viewer', status: 'active', can_publish: false, created_at: '2026-11-01T00:00:00Z', last_login_at: null, plan: PLAN === 'free' ? 'free' : 'pro', plan_source: 'admin', plan_expires_at: null, billing_period: null, must_change_password: false };

let seq = 0;
const ev = (title, country, slug, lat, lng, hoursAgo) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`, title, description: `${title} desc`, severity: 'high', latitude: lat, longitude: lng,
  location_name: title.split(' in ')[1] || title, location_name_he: null, location_name_en: null, location_precision: 'city', sources: [], locations: [],
  country, region: '', city: '', source_name: 'Telegram', source_url: null, source_type: 'social_media',
  occurred_at: new Date(Date.now() - hoursAgo * H).toISOString(), published_at: new Date().toISOString(), is_breaking: false, is_verified: false,
  translations: {}, category_id: null, category_slug: slug, category_name: slug, category_icon: 'Plane', category_color: '#dc2626', category_marker_color: '#dc2626',
  media_kinds: [], report_group: null, source_count: 0, updated_at: new Date().toISOString(),
});
const LIVE = [
  ev('Strike in Tyre', 'Lebanon', 'airstrike', 33.27, 35.2, 1),
  ev('Strike in Nabatieh', 'Lebanon', 'airstrike', 33.38, 35.48, 2),
  ev('Shelling in Khiam', 'Lebanon', 'artillery-shelling', 33.33, 35.61, 3),
  ev('Missiles in Tehran', 'Iran', 'missile-rocket-attack', 35.69, 51.39, 4),
  ev('Statement in Tehran', 'Iran', 'statements', 35.7, 51.4, 5),
  ev('Forces in Daraa', 'Syria', 'force-sighting', 32.62, 36.1, 6),
  ev('Strike in Aleppo', 'Syria', 'airstrike', 36.2, 37.15, 2),
  ev('Explosion in Haifa', 'Israel', 'explosion', 32.79, 34.99, 3),
];
const OLD = [ev('Old strike in Sidon', 'Lebanon', 'airstrike', 33.56, 35.37, 120)];
const FEATURES = ['live_map', 'feed', 'event_open', 'event_summary', 'source_link', 'media', 'archive_days', 'feed_search', 'copy_text', 'share_daily'];
const planRows = [
  ...['guest', 'free', 'pro', 'max'].flatMap((p) => FEATURES.map((k) => ({ feature_key: k, plan_id: p, enabled: true, limit_value: null }))),
  { feature_key: 'feed_delay_min', plan_id: 'guest', enabled: true, limit_value: 0 },
  { feature_key: 'filter_sets', plan_id: 'guest', enabled: false, limit_value: 0 },
  { feature_key: 'filter_sets', plan_id: 'free', enabled: true, limit_value: 1 },
  { feature_key: 'filter_sets', plan_id: 'pro', enabled: true, limit_value: 6 },
  { feature_key: 'filter_sets', plan_id: 'max', enabled: true, limit_value: 6 },
];

const EMPTY = { preset: 'live', from: '', to: '', areas: [], categories: [], severities: [], sources: [], media: [], breakingOnly: false, verifiedOnly: false, placeKinds: [], polygons: [] };
const mk = (id, name, color, filter, enabled = true) => ({ id, name, color, enabled, filter: { ...EMPTY, ...filter } });
const square = (lat, lng, d = 0.3) => [[lat - d, lng - d], [lat - d, lng + d], [lat + d, lng + d], [lat + d, lng - d]];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const archiveCalls = [];
// An active Home Front alert makes the page re-render every second (the alert clock).
let withAlert = false;
const ALERT = { id: 'hfc-1', threat: 1, started_at: new Date().toISOString(), last_alert_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600e3).toISOString(), areas: ['חיפה'], areas_en: ['Haifa'], zones_he: [], zones_en: [], alert_count: 1, geojson: null, center_lat: 32.79, center_lng: 34.99, area_points: [] };
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
    if (u.pathname.startsWith('/auth/v1/user')) return PLAN === 'guest' ? json({}, 401) : json(user);
    if (u.pathname.startsWith('/auth/v1/token')) return json(session);
    if (u.pathname.startsWith('/auth/v1/')) return json({});
    if (u.pathname === '/rest/v1/app_settings') {
      const row = { key: 'enforce_plans', value: true };
      const wanted = u.searchParams.get('key') || '';
      if (single) return /enforce_plans/.test(wanted) ? json({ value: true }) : none();
      return json(/enforce_plans/.test(wanted) || !wanted ? [row] : []);
    }
    if (u.pathname === '/rest/v1/plan_features') return json(planRows);
    if (u.pathname === '/rest/v1/profiles') return PLAN === 'guest' ? (single ? none() : json([])) : json(single ? profile : [profile]);
    if (u.pathname === '/rest/v1/published_events') {
      const m = /in\.\(([^)]*)\)/.exec(u.searchParams.get('id') || '');
      return json(m ? LIVE.filter((e) => m[1].replace(/"/g, '').split(',').includes(e.id)) : LIVE);
    }
    if (u.pathname === '/rest/v1/archived_events') {
      const occ = u.searchParams.getAll('occurred_at');
      archiveCalls.push(occ);
      const from = occ.find((x) => x.startsWith('gte.'))?.slice(4);
      const to = occ.find((x) => x.startsWith('lt.'))?.slice(3);
      return json(OLD.filter((e) => (!from || e.occurred_at >= from) && (!to || e.occurred_at < to)));
    }
    if (u.pathname === '/rest/v1/active_hfc_alerts') return json(withAlert ? [ALERT] : []);
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
    ? { drawGeneral: /^סימון אזור במפה/, setsOn: (n) => `סטים פעילים · ${n}`, off: 'כיבוי הסטים', filters: /^(סינון|מסננים ·)/, set1: 'סט 1', lebanon: /^לבנון/, iran: /^איראן/, air: /^תקיפה אווירית/, missile: /^ירי רקטות וטילים/, week: /^שבוע$/, octagon: /^מתומן$/, cancel: /^ביטול$/, area1: 'אזור 1', clearAll: /^נקה הכול|^ניקוי הכול|^נקה הכל/ }
    : { drawGeneral: /^Draw an area on the map/, setsOn: (n) => `Filter sets · ${n}`, off: 'Switch sets off', filters: /^Filters( ·|$)/, set1: 'Set 1', lebanon: /^Lebanon/, iran: /^Iran/, air: /^Airstrike/, missile: /^Missile or Rocket Attack/, week: /^7 days$/, octagon: /^Octagon$/, cancel: /^Cancel$/, area1: 'Area 1', clearAll: /^Clear all$/ };

  // One fresh page per scenario: `seed` is written to storage before the app starts.
  async function open(seed, at = '/') {
    const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone });
    await ctx.addInitScript(([s, lang, key, seed, signedIn]) => {
      if (sessionStorage.getItem('qa-seeded')) return; // keep what the app saved across reloads
      sessionStorage.setItem('qa-seeded', '1');
      if (signedIn) localStorage.setItem('ofm.auth', JSON.stringify(s));
      localStorage.setItem('ofm.lang', lang);
      if (seed !== null) localStorage.setItem(key, typeof seed === 'string' ? seed : JSON.stringify(seed));
    }, [session, LANG, KEY, seed, PLAN !== 'guest']);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|net::ERR|ERR_FAILED/.test(m.text())) errors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => { if (!/Unexpected token '<'/.test(String(e))) errors.push(`pageerror: ${String(e).slice(0, 300)}`); });
    await routeAll(page);
    await page.goto(`http://127.0.0.1:${PORT}${at}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    // The cookie notice covers the phone's Map / Feed switch: dismiss it.
    const consent = page.getByRole('button', { name: /^(Reject non-essential|דחיית עוגיות לא-הכרחיות)$/ });
    if (await consent.count()) await consent.first().click().catch(() => {});
    return { ctx, page };
  }
  const cards = (page) => page.locator('article[id^="event-card-"]').count();
  const titles = (page) => page.locator('article[id^="event-card-"] h3').allInnerTexts();
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `sets-${LANG}-${DEVICE}-${PLAN}-${name}.png`) });
  const showFeed = async (page) => {
    if (!phone) return;
    const b = page.getByRole('button', { name: LANG === 'he' ? /^(עדכונים|פיד|רשימה)/ : /^(Feed|List|Updates)/ }).first();
    if (await b.count()) await b.click().catch(() => {});
    await page.waitForTimeout(300);
  };

  const A = mk('a', 'Lebanon strikes', '#7c3aed', { areas: ['lebanon'], categories: ['airstrike'] });
  const B = mk('b', 'Iran missiles', '#d97706', { areas: ['iran'], categories: ['missile-rocket-attack'] });

  try {
    if (PLAN === 'pro') {
      // 1. No sets: today's feed.
      let { ctx, page } = await open(null);
      await showFeed(page);
      out.c1_cards = await cards(page); // 8
      out.c1_noTags = (await page.locator('[data-set-tag]').count()) === 0;
      out.c1_noArchive = archiveCalls.length === 0;
      await ctx.close();

      // 2. Two sets in force.
      ({ ctx, page } = await open([A, B]));
      await showFeed(page);
      out.c2_cards = await cards(page); // 3
      const tags = await page.locator('[data-set-tag]').allInnerTexts();
      out.c2_tags = tags.filter((x) => x.includes('Lebanon strikes')).length === 2 && tags.filter((x) => x.includes('Iran missiles')).length === 1;
      await shot(page, 'two-sets-feed');
      out.c2_pill = (await page.getByRole('button', { name: T.setsOn(2) }).count()) > 0;
      // Pins are clustered at the start zoom: "show on map" on a card opens its pin.
      await page.locator('article[id^="event-card-"] h3').first().click(); // a tap on the card flies to its pin
      await page.waitForTimeout(1800);
      out.c2_ring = (await page.locator('.ofm-pin.has-ring').count()) > 0;
      out.c2_ringColour = await page.evaluate(() => getComputedStyle(document.querySelector('.ofm-pin.has-ring') || document.body).getPropertyValue('--pin-ring').trim() === '#7c3aed');
      await shot(page, 'two-sets');

      // 3. Switch off → today's feed; a reload keeps them off, still stored.
      await showFeed(page); // a phone switched to the map when the card was tapped
      await page.locator('[data-sets-off]').click();
      await page.waitForTimeout(600);
      out.c3_cards = await cards(page); // 8
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await showFeed(page);
      out.c3_cardsAfterReload = await cards(page); // 8
      const stored = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY));
      out.c3_storedOff = stored.length === 2 && stored.every((s) => s.enabled === false);
      await ctx.close();

      // 4. A 7-day set loads the archive and shows the old event.
      archiveCalls.length = 0;
      ({ ctx, page } = await open([mk('a', 'Lebanon week', '#7c3aed', { areas: ['lebanon'], categories: ['airstrike'], preset: '7d' })]));
      await showFeed(page);
      await page.waitForTimeout(1500);
      out.c4_archiveCalls = archiveCalls.length >= 1;
      out.c4_oldShown = (await titles(page)).some((x) => x.includes('Old strike in Sidon'));
      await ctx.close();

      // 5. A drawn area around Daraa, no country: only Daraa; outlined in the set's colour.
      ({ ctx, page } = await open([mk('a', 'Daraa', '#7c3aed', { polygons: [square(32.62, 36.1)] })]));
      await showFeed(page);
      const t5 = await titles(page);
      out.c5_onlyDaraa = t5.length === 1 && t5[0].includes('Daraa');
      if (phone) { const m = page.getByRole('button', { name: LANG === 'he' ? /^מפה$/ : /^Map$/ }).first(); if (await m.count()) await m.click().catch(() => {}); await page.waitForTimeout(400); }
      out.c5_outline = (await page.locator('path[stroke="#7c3aed"]').count()) > 0;
      await ctx.close();

      // 6. The archive page is not narrowed by sets.
      ({ ctx, page } = await open([A, B], '/archive'));
      out.c6_noSetPill = (await page.getByRole('button', { name: T.setsOn(2) }).count()) === 0;
      out.c6_noTags = (await page.locator('[data-set-tag]').count()) === 0;
      await ctx.close();

      // 7. Broken storage: the page loads as if there were no sets.
      ({ ctx, page } = await open('{not json'));
      await showFeed(page);
      out.c7_cards = await cards(page); // 8
      await ctx.close();

      // ── Panel, driven through the UI ──
      ({ ctx, page } = await open(null));
      page.on('dialog', (d) => d.accept());
      const dlg = page.locator('[role="dialog"][aria-labelledby="filters-title"]');
      const openPanel = async () => {
        if (await dlg.count()) return;
        await page.getByRole('button', { name: T.filters }).first().click();
        await dlg.waitFor({ timeout: 5000 });
      };
      const closePanel = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); };
      const pick = (re) => dlg.getByRole('button', { name: re }).first().click();
      const feedCount = async () => { await closePanel(); await showFeed(page); const n = await cards(page); await openPanel(); return n; };

      // P1: two sets through the UI.
      await openPanel();
      await dlg.locator('[data-set-action="add"]').click();
      out.p1_firstChip = (await dlg.locator('[data-set-scope][aria-pressed="true"]').innerText()).includes(T.set1);
      await pick(T.lebanon); await pick(T.air);
      out.p1_cards1 = await feedCount(); // 2
      await dlg.locator('[data-set-action="add"]').click();
      await pick(T.iran); await pick(T.missile);
      out.p1_cards2 = await feedCount(); // 3
      out.p1_footer = /\b3\b/.test(await dlg.locator('footer button').innerText());
      await shot(page, 'panel-set');

      // P2: set 1 off → 1; on → 3.
      const ids = await dlg.locator('[data-set-scope]:not([data-set-scope="general"]):not([data-set-scope="eei"])').evaluateAll((els) => els.map((e) => e.getAttribute('data-set-scope')));
      await dlg.locator(`[data-set-scope="${ids[0]}"]`).click();
      await dlg.locator('[data-set-action="toggle"]').click();
      out.p2_off = await feedCount(); // 1
      await dlg.locator('[data-set-action="toggle"]').click();
      out.p2_on = await feedCount(); // 3

      // P3: set 2 → 7 days: archive loaded from ~7 days ago; the old Lebanon strike stays out (set 1 is 12 h).
      archiveCalls.length = 0;
      await dlg.locator(`[data-set-scope="${ids[1]}"]`).click();
      await pick(T.week);
      await page.waitForTimeout(1500);
      const from = archiveCalls.flat().find((x) => x.startsWith('gte.'))?.slice(4);
      out.p3_archive7d = !!from && Math.abs(Date.parse(from) - (Date.now() - 168 * H)) < 2 * H;
      await closePanel(); await showFeed(page);
      out.p3_oldHidden = !(await titles(page)).some((x) => x.includes('Old strike'));
      await openPanel();

      // P4: draw for a new set (octagon over the visible map) → Area 1, the general filter untouched.
      await dlg.locator('[data-set-action="add"]').click();
      await dlg.locator('[data-set-action="draw"]').click();
      await page.getByRole('button', { name: T.octagon }).click();
      const map = page.locator('.leaflet-container');
      const box = await map.boundingBox();
      await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
      await map.click({ position: { x: 4, y: 4 } });
      await dlg.waitFor({ timeout: 5000 });
      out.p4_area = (await dlg.locator('[data-set-area]').count()) === 1;
      out.p4_generalUntouched = await page.evaluate(() => JSON.parse(localStorage.getItem('ofm.filters.v1') || '{}').polygon == null);

      // P5: cancel a drawing → back on the set, nothing added.
      await dlg.locator('[data-set-action="draw"]').click();
      await page.getByRole('button', { name: T.cancel }).click();
      await dlg.waitFor({ timeout: 5000 });
      out.p5_stillOneArea = (await dlg.locator('[data-set-area]').count()) === 1;

      // P6: General scope → paused note; switch off → 8, sets still listed.
      await dlg.locator('[data-set-scope="general"]').click();
      out.p6_paused = (await dlg.locator('[data-sets-paused]').count()) === 1;
      await dlg.locator('[data-set-action="switch-off"]').click();
      out.p6_cards = await feedCount(); // 8
      out.p6_listed = (await dlg.locator('[data-set-scope]:not([data-set-scope="eei"])').count()) === 4;

      // P7: switch set 1 on again, "Clear all" → off, still listed after reload.
      await dlg.locator(`[data-set-scope="${ids[0]}"]`).click();
      await dlg.locator('[data-set-action="toggle"]').click();
      await dlg.getByRole('button', { name: T.clearAll }).first().click();
      out.p7_cards = await feedCount(); // 8
      await closePanel();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await openPanel();
      out.p7_listed = (await dlg.locator('[data-set-scope]:not([data-set-scope="eei"])').count()) === 4;

      // P8: delete → chip gone, scope back to General.
      await dlg.locator(`[data-set-scope="${ids[0]}"]`).click();
      await dlg.locator('[data-set-action="delete"]').click();
      await page.waitForTimeout(300);
      out.p8_gone = (await dlg.locator(`[data-set-scope="${ids[0]}"]`).count()) === 0;
      out.p8_general = (await dlg.locator('[data-set-scope="general"][aria-pressed="true"]').count()) === 1;

      // P9: up to 6, then Add is disabled.
      for (let i = 0; i < 6; i++) if (!(await dlg.locator('[data-set-action="add"]').isDisabled())) await dlg.locator('[data-set-action="add"]').click();
      out.p9_six = (await dlg.locator('[data-set-scope]:not([data-set-scope="general"]):not([data-set-scope="eei"])').count()) === 6;
      out.p9_disabled = await dlg.locator('[data-set-action="add"]').isDisabled();
      if (LANG === 'en') out.p12_noHebrew = !/[\u0590-\u05FF]/.test(await dlg.innerText());
      await ctx.close();

      // R1 (review): a set's name can be typed while an alert clock re-renders the page every second.
      withAlert = true;
      ({ ctx, page } = await open([mk('a', 'Old name', '#7c3aed', { areas: ['lebanon'] })]));
      await page.getByRole('button', { name: T.filters }).first().click();
      const dlgR = page.locator('[role="dialog"][aria-labelledby="filters-title"]');
      await dlgR.waitFor({ timeout: 5000 });
      await dlgR.locator('[data-set-scope="a"]').click();
      const nameBox = dlgR.locator('[data-set-header] input');
      await nameBox.fill('');
      await nameBox.pressSequentially('Northern front', { delay: 250 });
      out.r1_typed = (await nameBox.inputValue()) === 'Northern front';
      out.r1_focused = await nameBox.evaluate((el) => document.activeElement === el);
      withAlert = false;
      await ctx.close();

      // R3 (review): Set → Draw area → back in the panel mid-draw → General → draw: the shape is the general one.
      ({ ctx, page } = await open([mk('a', 'A', '#7c3aed', { areas: ['lebanon'] })]));
      const dlg3 = page.locator('[role="dialog"][aria-labelledby="filters-title"]');
      await page.getByRole('button', { name: T.filters }).first().click();
      await dlg3.waitFor({ timeout: 5000 });
      await dlg3.locator('[data-set-scope="a"]').click();
      await dlg3.locator('[data-set-action="draw"]').click();
      await page.getByRole('button', { name: T.filters }).first().click();
      await dlg3.waitFor({ timeout: 5000 });
      await dlg3.locator('[data-set-scope="general"]').click();
      await dlg3.getByRole('button', { name: T.drawGeneral }).click();
      await page.getByRole('button', { name: T.octagon }).click();
      const map3 = page.locator('.leaflet-container');
      const b3 = await map3.boundingBox();
      await map3.click({ position: { x: b3.width / 2, y: b3.height / 2 } });
      await map3.click({ position: { x: b3.width / 2 + 60, y: b3.height / 2 } });
      await page.waitForTimeout(600);
      const st = await page.evaluate((k) => ({ sets: JSON.parse(localStorage.getItem(k)), general: JSON.parse(localStorage.getItem('ofm.filters.v1') || '{}') }), KEY);
      out.r3_setUntouched = st.sets[0].filter.polygons.length === 0;
      out.r3_generalDrawn = Array.isArray(st.general.polygon) && st.general.polygon.length >= 3;
      await ctx.close();
    }

    if (PLAN === 'free') {
      let { ctx, page } = await open(null);
      const dlg = page.locator('[role="dialog"][aria-labelledby="filters-title"]');
      await page.getByRole('button', { name: T.filters }).first().click();
      await dlg.waitFor({ timeout: 5000 });
      await dlg.locator('[data-set-action="add"]').click();
      out.f1_first = (await dlg.locator('[data-set-scope]:not([data-set-scope="general"]):not([data-set-scope="eei"])').count()) === 1;
      await dlg.locator('[data-set-action="add"]').click();
      await page.waitForTimeout(400);
      out.f1_upgrade = (await page.locator('[data-gate="upgrade"]').count()) === 1;
      out.f1_noSecond = (await dlg.locator('[data-set-scope]:not([data-set-scope="general"]):not([data-set-scope="eei"])').count()) === 1;
      await ctx.close();

      ({ ctx, page } = await open([A, B, mk('c', 'Third', '#059669', { areas: ['syria'] })]));
      await showFeed(page);
      out.f2_cards = await cards(page); // 2 (set A only)
      const dlg2 = page.locator('[role="dialog"][aria-labelledby="filters-title"]');
      await page.getByRole('button', { name: T.filters }).first().click();
      await dlg2.waitFor({ timeout: 5000 });
      out.f2_locked = (await dlg2.locator('[data-set-locked]:not([data-set-scope="eei"])').count()) === 2;
      await page.keyboard.press('Escape');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      out.f2_stored = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY)).length === 3;
      await ctx.close();
    }

    if (PLAN === 'guest') {
      const { ctx, page } = await open(null);
      const dlg = page.locator('[role="dialog"][aria-labelledby="filters-title"]');
      await page.getByRole('button', { name: T.filters }).first().click();
      await dlg.waitFor({ timeout: 5000 });
      await dlg.locator('[data-set-action="add"]').click();
      await page.waitForTimeout(400);
      out.g1_signup = (await page.locator('[data-gate="signup"]').count()) === 1;
      out.g1_noChip = (await dlg.locator('[data-set-scope]:not([data-set-scope="general"]):not([data-set-scope="eei"])').count()) === 0;
      await ctx.close();

      // R2 (review): a guest with a saved 7-day set is not sent to sign-up on every load (the set is locked).
      const r2 = await open([mk('a', 'Week', '#7c3aed', { areas: ['lebanon'], preset: '7d' })]);
      await r2.page.waitForTimeout(1000);
      out.r2_noSignupGate = (await r2.page.locator('[data-gate="signup"]').count()) === 0;
      await r2.ctx.close();
    }
  } catch (e) {
    out.FAILED = String(e).slice(0, 400);
  }

  out.consoleErrors = errors.slice(0, 5);
  const bad = [];
  for (const [k, v] of Object.entries(out)) if (v === false) bad.push([k, v]);
  const expect = { c1_cards: 8, c2_cards: 3, c3_cards: 8, c3_cardsAfterReload: 8, c7_cards: 8, p1_cards1: 2, p1_cards2: 3, p2_off: 1, p2_on: 3, p6_cards: 8, p7_cards: 8, f2_cards: 2 };
  for (const [k, v] of Object.entries(expect)) if (k in out && out[k] !== v) bad.push([k, out[k]]);
  if (out.consoleErrors.length) bad.push(['consoleErrors', out.consoleErrors]);
  if (out.FAILED) bad.push(['FAILED', out.FAILED]);
  console.log(JSON.stringify(out, null, 1));
  console.log(bad.length ? `FAIL ${JSON.stringify(bad)}` : 'PASS');
  process.exitCode = bad.length ? 1 : 0;
  await browser.close();
  server.close();
})();
