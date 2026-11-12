// Free-text EEI (צי"ח) — browser checks (Playwright) against a local build and a FAKED Supabase.
// No real database and no AI: the split answer is tests/fixtures/eei-sample.parsed.json, the AI's
// marks are held in this script. Checks the panel (paste → preview → save → list in force), the
// lenses on feed and map, fallback rules, priority, on/off, restore, degraded, plans, archive.
//
// Build:  VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=<any JWT with role anon> \
//         VITE_SITE_URL=https://osintfront.com npx vite build --outDir /tmp/sets-qa/dist --emptyOutDir
// Run:    SETS_QA_DIST=/tmp/sets-qa/dist node tests/e2e/eei.mock.cjs <he|en> <desktop|phone> <pro|free|guest>
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
  ev('Talks with the US in Doha', 'Iran', 'statements', 35.7, 51.42, 1),
  ev('Missile launch near Isfahan', 'Iran', 'missile-rocket-attack', 32.65, 51.67, 2),
  ev('Strike in Tyre', 'Lebanon', 'airstrike', 33.27, 35.2, 1),
  ev('Strike in Nabatieh', 'Lebanon', 'airstrike', 33.38, 35.48, 2),
  ev('Senior official raises readiness', 'Lebanon', 'statements', 33.89, 35.5, 3),
  ev('Protest in Daraa', 'Syria', 'protest-civil-unrest', 32.62, 36.1, 4),
  { ...ev('Explosion in Haifa', 'Israel', 'explosion', 32.79, 34.99, 5), severity: 'critical' },
  ev('Weather in Amman', 'Jordan', 'other', 31.95, 35.93, 6),
];
const [E1, E2, E3, E4, E5, E6, E7, E8] = LIVE.map((e) => e.id);
const OLD = [];
const FEATURES = ['live_map', 'feed', 'event_open', 'event_summary', 'source_link', 'media', 'archive_days', 'feed_search', 'copy_text', 'share_daily'];
const planRows = [
  ...['guest', 'free', 'pro', 'max'].flatMap((p) => FEATURES.map((k) => ({ feature_key: k, plan_id: p, enabled: true, limit_value: null }))),
  { feature_key: 'feed_delay_min', plan_id: 'guest', enabled: true, limit_value: 0 },
  { feature_key: 'filter_sets', plan_id: 'guest', enabled: false, limit_value: 0 },
  { feature_key: 'filter_sets', plan_id: 'free', enabled: true, limit_value: 1 },
  { feature_key: 'filter_sets', plan_id: 'pro', enabled: true, limit_value: 6 },
  { feature_key: 'filter_sets', plan_id: 'max', enabled: true, limit_value: 6 },
  { feature_key: 'eei_text', plan_id: 'guest', enabled: false, limit_value: 0 },
  { feature_key: 'eei_text', plan_id: 'free', enabled: false, limit_value: 0 },
  { feature_key: 'eei_text', plan_id: 'pro', enabled: true, limit_value: 5 },
  { feature_key: 'eei_text', plan_id: 'max', enabled: true, limit_value: 5 },
];


const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

// ── Fake EEI server ──
const PARSED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'eei-sample.parsed.json'), 'utf8'));
const keyed = (theatres) => theatres.map((t, i) => (t.kind === 'exceptional'
  ? { ...t, hash: null }
  : { ...t, hash: `h${i + 1}`, topics: t.topics.map((tp, j) => ({ ...tp, key: `k${i}${j}` })) }));
const FULL = keyed(PARSED.theatres);
let stored = null;           // { raw_text, list, prev_raw_text, prev_list }
let marks = [];              // [{ h, e, t, at }]
let degraded = false;
const fnCalls = [];
const saves = [];
const mark = (h, e, t) => marks.push({ h, e, t, at: new Date(Date.now() + marks.length).toISOString() });

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
    if (u.pathname === '/functions/v1/event-agent') {
      const b = JSON.parse(req.postData() || '{}');
      fnCalls.push(b.action);
      if (b.action === 'eei_parse') {
        if (/bad/.test(b.text)) return json({ error: 'empty' }, 422);
        const theatres = /^Only Lebanon/.test(b.text) ? FULL.filter((t) => t.hash === 'h2') : FULL;
        return json({ ok: true, theatres, cached: false });
      }
      if (b.action === 'eei_save') {
        saves.push(b);
        const list = { theatres: b.list.theatres.map((t, i) => (t.kind === 'exceptional' ? t : { ...t, hash: t.hash || `hn${i}` })) };
        if (stored?.list && JSON.stringify(stored.list) !== JSON.stringify(list)) { stored.prev_raw_text = stored.raw_text; stored.prev_list = stored.list; }
        stored = { ...(stored || {}), raw_text: b.raw_text, list };
        return json({ ok: true, list });
      }
      if (b.action === 'eei_clear') { if (stored) { stored.prev_raw_text = stored.raw_text; stored.prev_list = stored.list; stored.raw_text = ''; stored.list = null; } return json({ ok: true }); }
      return json({ error: 'not mocked' }, 400);
    }
    if (u.pathname === '/rest/v1/eei_lists') return stored ? json(single ? stored : [stored]) : (single ? none() : json([]));
    if (u.pathname === '/rest/v1/rpc/eei_my_tags') {
      const after = JSON.parse(req.postData() || '{}').p_after;
      return json({ degraded, tags: marks.filter((m) => !after || m.at > after) });
    }
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
    if (u.pathname.startsWith('/rest/v1/rpc/')) return json(null);
    if (u.pathname.startsWith('/rest/v1/')) return single ? none() : json([]);
    return json({});
  });
}

const errors = [];
(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const phone = DEVICE === 'phone';
  const out = { lang: LANG, device: DEVICE, plan: PLAN };
  const T = LANG === 'he'
    ? { filters: /^(סינון|מסננים ·)/, feed: /^עדכונים/, map: /^מפה$/, consent: /^דחיית עוגיות לא-הכרחיות$/, clearAll: /^נקה הכול|^ניקוי הכול|^נקה הכל/ }
    : { filters: /^Filters( ·|$)/, feed: /^Feed/, map: /^Map$/, consent: /^Reject non-essential$/, clearAll: /^Clear all$/ };
  const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'eei-sample.txt'), 'utf8');

  async function open(seedSets, at = '/') {
    const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone });
    await ctx.addInitScript(([s, lang, seed, signedIn]) => {
      if (sessionStorage.getItem('qa-seeded')) return;
      sessionStorage.setItem('qa-seeded', '1');
      if (signedIn) localStorage.setItem('ofm.auth', JSON.stringify(s));
      localStorage.setItem('ofm.lang', lang);
      if (seed) localStorage.setItem('ofm.filterSets.v1', JSON.stringify(seed));
    }, [session, LANG, seedSets, PLAN !== 'guest']);
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|net::ERR|ERR_FAILED/.test(m.text())) errors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => { if (!/Unexpected token '<'/.test(String(e))) errors.push(`pageerror: ${String(e).slice(0, 300)}`); });
    await routeAll(page);
    await page.goto(`http://127.0.0.1:${PORT}${at}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const c = page.getByRole('button', { name: T.consent });
    if (await c.count()) await c.first().click().catch(() => {});
    return { ctx, page };
  }
  const dlgOf = (page) => page.locator('[role="dialog"][aria-labelledby="filters-title"]');
  const openPanel = async (page) => { const d = dlgOf(page); if (await d.count()) return d; await page.getByRole('button', { name: T.filters }).first().click(); await d.waitFor({ timeout: 5000 }); return d; };
  const closePanel = async (page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); };
  const showFeed = async (page) => { if (!phone) return; const b = page.getByRole('button', { name: T.feed }).first(); if (await b.count()) await b.click().catch(() => {}); await page.waitForTimeout(300); };
  const titles = async (page) => { await closePanel(page); await showFeed(page); return (await page.locator('article[id^="event-card-"] h3').allInnerTexts()).sort(); };
  const eeiScope = async (page) => { const d = await openPanel(page); await d.locator('[data-set-scope="eei"]').click(); await page.waitForTimeout(300); return d; };
  const reload = async (page) => { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000); };
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `eei-${LANG}-${DEVICE}-${PLAN}-${name}.png`) });
  const has = (list, ...names) => names.every((n) => list.some((x) => x.includes(n)));

  try {
    if (PLAN === 'pro') {
      let { ctx, page } = await open(null);
      // 1. paste → analyse → preview
      let d = await eeiScope(page);
      await d.locator('textarea').fill(SAMPLE);
      await d.locator('[data-eei-action="analyse"]').click();
      await d.locator('[data-eei-action="save"]').waitFor({ timeout: 5000 });
      out.c1_theatres = await d.locator('[data-eei-theatre]').count(); // 7
      const prio = PARSED.theatres.flatMap((t) => t.topics).filter((t) => t.priority).length;
      out.c1_stars = (await d.locator('[data-eei-action="priority"][aria-pressed="true"]').count()) === prio;
      await shot(page, 'preview');
      // 2. rename k03, delete k02, save
      const iran = d.locator('[data-eei-theatre="h1"]');
      await iran.locator('[data-eei-topic="k03"] input').fill('Israeli government talk');
      await iran.locator('[data-eei-topic="k02"] [data-eei-action="remove-topic"]').click();
      await d.locator('[data-eei-action="save"]').click();
      await d.locator('[data-eei-action="new"]').waitFor({ timeout: 5000 });
      const sent = saves[saves.length - 1].list.theatres[0].topics.map((t) => t.label);
      out.c2_saved = sent.includes('Israeli government talk') && !sent.some((l) => l.includes('הורמוז'));
      out.c2_noClientId = !('id' in saves[saves.length - 1].list.theatres[0]);
      // 4a. no marks yet → fallback: talks, missile, readiness, protest, exceptional
      let tl = await titles(page);
      // (the missile event fits "possible strikes" by its category, whose name contains "attack")
      out.c4_fallback = tl.length === 5 && has(tl, 'Talks', 'Isfahan', 'readiness', 'Protest', 'Haifa');
      // 3. marks arrive
      mark('h2', E3, ['k10']); mark('h2', E4, ['k10']); mark('h1', E2, ['k00']); mark('h2', E5, []);
      await reload(page);
      tl = await titles(page);
      out.c3_cards = tl.length; // 6
      out.c4_emptyMarkHides = !has(tl, 'readiness');
      out.c3_topicChip = (await page.locator('article [data-eei-topic]').count()) >= 3;
      out.c3_star = (await page.locator('article [data-eei-topic] svg').count()) >= 3;
      await shot(page, 'feed');
      // 5. priority only
      d = await eeiScope(page);
      await d.locator('[data-eei-action="priority-only"]').check();
      tl = await titles(page);
      out.c5_priority = tl.length === 5 && !has(tl, 'Protest');
      d = await eeiScope(page);
      await d.locator('[data-eei-action="priority-only"]').uncheck();
      // 6. theatre off, topic off, kept after reload
      await d.locator('[data-eei-theatre="h2"] [data-eei-action="toggle-theatre"]').click();
      await d.locator('[data-eei-theatre="h1"] [data-eei-topic="k00"]').click();
      tl = await titles(page);
      out.c6_off = tl.length === 3 && !has(tl, 'Tyre') && !has(tl, 'Isfahan');
      await reload(page);
      tl = await titles(page);
      out.c6_kept = tl.length === 3;
      d = await eeiScope(page);
      await d.locator('[data-eei-theatre="h2"] [data-eei-action="toggle-theatre"]').click();
      await d.locator('[data-eei-theatre="h1"] [data-eei-topic="k00"]').click();
      // 8. degraded
      degraded = true;
      await reload(page);
      d = await eeiScope(page);
      out.c8_degraded = (await d.locator('[data-eei-status="degraded"]').count()) === 1;
      degraded = false;
      // 14. English chrome
      if (LANG === 'en') out.c14_noHebrew = !(await d.locator('[data-eei-action]').allInnerTexts()).some((x) => /[֐-׿]/.test(x));
      // 7. new list, then restore
      await d.locator('[data-eei-action="new"]').click();
      // 11. a text with no list → message, text kept
      await d.locator('textarea').fill('bad bad bad bad');
      await d.locator('[data-eei-action="analyse"]').click();
      await page.waitForTimeout(800);
      out.c11_message = (await d.innerText()).includes(LANG === 'he' ? 'לא הצלחתי לזהות רשימה' : 'Could not read a list');
      out.c11_textKept = (await d.locator('textarea').inputValue()) === 'bad bad bad bad';
      await d.locator('textarea').fill('Only Lebanon: readiness and statements');
      await d.locator('[data-eei-action="analyse"]').click();
      await d.locator('[data-eei-action="save"]').waitFor({ timeout: 5000 });
      await d.locator('[data-eei-action="save"]').click();
      await d.locator('[data-eei-action="restore"]').waitFor({ timeout: 5000 });
      out.c7_replaced = (await d.locator('[data-eei-theatre]').count()) === 1;
      await d.locator('[data-eei-action="restore"]').click();
      await page.waitForTimeout(800);
      out.c7_restored = (await d.locator('[data-eei-theatre]').count()) === 7;
      // 10. Clear all → off, list kept; Remove → text state
      await d.getByRole('button', { name: T.clearAll }).first().click();
      tl = await titles(page);
      out.c10_allEvents = tl.length === 8;
      d = await eeiScope(page);
      out.c10_kept = (await d.locator('[data-eei-theatre]').count()) === 7;
      await d.locator('[data-eei-action="remove"]').click();
      await page.waitForTimeout(800);
      out.c10_textState = (await d.locator('textarea').count()) === 1;
      await ctx.close();

      // 9. together with a manual set (Jordan)
      stored = { raw_text: SAMPLE, list: { theatres: FULL }, prev_raw_text: null, prev_list: null };
      ({ ctx, page } = await open([{ id: 'j', name: 'Jordan', color: '#d97706', enabled: true, filter: { preset: 'live', from: '', to: '', areas: ['jordan'], categories: [], severities: [], sources: [], media: [], breakingOnly: false, verifiedOnly: false, placeKinds: [], polygons: [] } }]));
      tl = await titles(page);
      out.c9_orSet = has(tl, 'Amman', 'Tyre', 'Haifa');
      if (phone) { await page.getByRole('button', { name: T.map }).first().click().catch(() => {}); await page.waitForTimeout(300); }
      await page.locator('article[id^="event-card-"] h3', { hasText: 'Tyre' }).first().click().catch(() => {});
      await page.waitForTimeout(1500);
      out.c3_ring = (await page.locator('.ofm-pin.has-ring').count()) > 0;
      await ctx.close();

      // 13. archive: no EEI chip, not narrowed
      ({ ctx, page } = await open(null, '/archive'));
      d = await openPanel(page);
      out.c13_noChip = (await d.locator('[data-set-scope="eei"]').count()) === 0;
      await ctx.close();
    }
    if (PLAN === 'free' || PLAN === 'guest') {
      const { ctx, page } = await open(null);
      const d = await openPanel(page);
      await d.locator('[data-set-scope="eei"]').click();
      await page.waitForTimeout(500);
      out.c12_gate = (await page.locator(`[data-gate="${PLAN === 'free' ? 'upgrade' : 'signup'}"]`).count()) === 1;
      out.c12_noCall = fnCalls.length === 0;
      await ctx.close();
    }
  } catch (e) {
    out.FAILED = String(e).slice(0, 400);
  }
  out.consoleErrors = errors.slice(0, 5);
  const bad = Object.entries(out).filter(([, v]) => v === false);
  if (out.c1_theatres !== undefined && out.c1_theatres !== 7) bad.push(['c1_theatres', out.c1_theatres]);
  if (out.c3_cards !== undefined && out.c3_cards !== 6) bad.push(['c3_cards', out.c3_cards]);
  if (out.consoleErrors.length) bad.push(['consoleErrors', out.consoleErrors]);
  if (out.FAILED) bad.push(['FAILED', out.FAILED]);
  console.log(JSON.stringify(out, null, 1));
  console.log(bad.length ? `FAIL ${JSON.stringify(bad)}` : 'PASS');
  process.exitCode = bad.length ? 1 : 0;
  await browser.close();
  server.close();
})();
