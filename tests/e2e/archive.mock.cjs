// Archive page — browser check (Playwright) against a local build and a FAKED Supabase.
// An event from three days ago shows on its archive day, whatever time filter the visitor keeps
// on the live map (it was hidden by the live 12-hour window), and the time filter is not counted.
//
// Build:  VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=<any JWT with role anon> \
//         VITE_SITE_URL=https://osintfront.com npx vite build --outDir /tmp/sets-qa/dist --emptyOutDir
// Run:    SETS_QA_DIST=/tmp/sets-qa/dist node tests/e2e/archive.mock.cjs <he|en> <desktop|phone>
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
const OLD = [ev('O', 'Old strike in Tyre', 'airstrike', [], 33.27, 35.2, 72)];
const pad = (n) => String(n).padStart(2, '0');
const d0 = new Date(Date.now() - 72 * H);
const DAY = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}`;
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
    if (u.pathname === '/rest/v1/archived_events') return json(OLD.map(({ key: _k, ...r }) => r));
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
  const bad = [];
  for (const preset of [null, '1h']) {
    const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone });
    await ctx.addInitScript(([s, lang, preset]) => {
      if (sessionStorage.getItem('qa-seeded')) return;
      sessionStorage.setItem('qa-seeded', '1');
      localStorage.setItem('ofm.auth', JSON.stringify(s));
      localStorage.setItem('ofm.lang', lang);
      if (preset) {
        for (const k of Object.keys(localStorage)) if (/filter/i.test(k) && k !== 'ofm.filterSets.v1') localStorage.removeItem(k);
        window.__qaPreset = preset;
      }
    }, [session, LANG, preset]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { if (!/Unexpected token '<'/.test(String(e))) errors.push(`pageerror: ${String(e).slice(0, 300)}`); });
    await routeAll(page);
    if (preset) {
      // Choose the 1-hour time filter on the live map first, the way a visitor would keep it.
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      const key = await page.evaluate(() => Object.keys(localStorage).find((k) => /filter/i.test(k) && k !== 'ofm.filterSets.v1') || null);
      if (!key) { bad.push('no saved filter key'); } else {
        await page.evaluate(([k]) => { const f = JSON.parse(localStorage.getItem(k)); f.preset = '1h'; localStorage.setItem(k, JSON.stringify(f)); }, [key]);
      }
    }
    await page.goto(`http://127.0.0.1:${PORT}/archive?date=${DAY}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const consent = page.getByRole('button', { name: /^(Reject non-essential|דחיית עוגיות לא-הכרחיות)$/ });
    if (await consent.count()) await consent.first().click().catch(() => {});
    if (phone) {
      const b = page.getByRole('button', { name: LANG === 'he' ? /^(עדכונים|פיד|רשימה)/ : /^(Feed|List|Updates)/ }).first();
      if (await b.count()) await b.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    const shown = await page.getByText('Old strike in Tyre').count();
    if (!shown) bad.push(`old event hidden (time filter ${preset || 'default'})`);
    const counted = await page.getByRole('button', { name: LANG === 'he' ? /^מסננים ·/ : /^Filters ·/ }).count();
    if (counted) bad.push(`time filter counted as active (${preset || 'default'})`);
    await page.screenshot({ path: path.join(SHOTS, `archive-${LANG}-${DEVICE}-${preset || 'default'}.png`) });
    await ctx.close();
  }
  bad.push(...errors);
  console.log(bad.length ? `FAIL ${JSON.stringify(bad)}` : 'PASS');
  process.exitCode = bad.length ? 1 : 0;
  await browser.close();
  server.close();
})();
