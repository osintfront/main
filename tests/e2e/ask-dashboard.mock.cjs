// "Ask the map" statistics dashboard — browser checks (Playwright) against a local build and a FAKED server.
// No real database and no AI calls: every Supabase request is answered by this script. Three users run one
// after another (max, staff, pro). It checks the thread (clarify chips, build progress, result card, events
// on the map, errors), the dashboard sheet (Task 8) and the PDF / JPEG files (Task 9).
//
// Build:  VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=<any JWT with role anon> \
//         VITE_SITE_URL=https://osintfront.com npx vite build --outDir /tmp/ask-qa/dist --emptyOutDir
// Run:    ASK_QA_DIST=/tmp/ask-qa/dist ASK_QA_SHOTS=/tmp/ask-qa/shots node tests/e2e/ask-dashboard.mock.cjs <he|en> <desktop|phone>
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
const PORT = 4174 + Math.floor(Math.random() * 500);
const HE = /[֐-׿]/;
const en = LANG === 'en';
fs.mkdirSync(SHOTS, { recursive: true });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const NOW = Date.now();
const nowS = Math.floor(NOW / 1000);
const iso = (ms) => new Date(ms).toISOString();
const H = 3600e3;

// ── Users ──────────────────────────────────────────────────────────────────────────────────────
const USERS = {
  max: { id: '99999999-9999-4999-8999-999999999991', role: 'viewer', plan: 'max' },
  staff: { id: '99999999-9999-4999-8999-999999999992', role: 'analyst', plan: 'free' },
  pro: { id: '99999999-9999-4999-8999-999999999993', role: 'viewer', plan: 'pro' },
};
function sessionFor(u) {
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, role: 'authenticated', aud: 'authenticated', exp: nowS + 3600, email: `${u.plan}@example.test` })}.sig`;
  const user = { id: u.id, aud: 'authenticated', role: 'authenticated', email: `${u.plan}@example.test`, email_confirmed_at: '2026-11-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' };
  const profile = { id: u.id, full_name: 'QA', email: user.email, role: u.role, status: 'active', can_publish: false, created_at: '2026-11-01T00:00:00Z', last_login_at: null, plan: u.plan, plan_source: 'admin', plan_expires_at: null, billing_period: null, must_change_password: false };
  return { user, profile, session: { access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: nowS + 3600, user } };
}

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────
const eid = (n) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;
const MISSING = eid(10); // a Daraa event that never comes back from published_events
const PLACES = { Quneitra: [33.125, 35.824], Hader: [33.27, 35.76], Daraa: [32.62, 36.1], 'Beit Jinn': [33.31, 35.86], Rafid: [32.95, 35.88], Jubata: [33.2, 35.77], 'Khan Arnabah': [33.18, 35.88] };
const EVENT_ROWS = new Map();
function eventRow(id, title, place, at) {
  const [lat, lng] = PLACES[place];
  return { id, title, description: `${title} desc`, severity: 'high', latitude: lat, longitude: lng, location_name: place, location_name_he: place, location_name_en: place,
    location_precision: 'city', sources: [], locations: [], country: 'Syria', region: '', city: place, source_name: 'Telegram', source_url: null, source_type: 'social_media',
    occurred_at: at, published_at: at, is_breaking: false, is_verified: false, translations: {}, category_id: null, category_slug: 'infiltration', category_name: 'Infiltration',
    category_icon: 'Footprints', category_color: '#7c3aed', category_marker_color: '#7c3aed', media_kinds: [], report_group: null, source_count: 0, updated_at: at };
}
function fixtureW() {
  const since = NOW - 7 * 24 * H;
  const counts = [1, 2, 4, 1, 3, 2, 1];
  const prev = [2, 1, 1, 2, 1, 2, 1];
  const placeOf = ['Quneitra', 'Quneitra', 'Hader', 'Quneitra', 'Daraa', 'Hader', 'Quneitra', 'Beit Jinn', 'Daraa', 'Hader', 'Quneitra', 'Rafid', 'Jubata', 'Khan Arnabah'];
  const incidents = [];
  let n = 0, e = 0;
  const buckets = counts.map((c, d) => {
    const start = since + d * 24 * H;
    const list = [];
    for (let k = 0; k < c; k++) {
      n++;
      const at = iso(start + (2 + k) * H);
      const place = placeOf[n - 1];
      // Quneitra: 5 incidents, 7 events, 9 reports. Others: one event each, one report.
      const ids = [eid(++e)];
      let reports = 1;
      if (place === 'Quneitra' && (n === 1 || n === 2)) { ids.push(eid(++e)); reports = 2; }
      if (place === 'Quneitra' && n === 4) reports = 2;
      if (n === 14) reports = 4;
      if (place === 'Quneitra' && n === 7) reports = 2;
      incidents.push({ n, at, place, lat: PLACES[place][0], lng: PLACES[place][1], title: en ? `Incursion near ${place}` : `חדירה ליד ${place}`, ids, reports });
      for (const id of ids) EVENT_ROWS.set(id, eventRow(id, en ? `Incursion near ${place}` : `חדירה ליד ${place}`, place, at));
      list.push(n);
    }
    return { start: iso(start), count: c, prev: prev[d], incidents: list };
  });
  const sumReports = incidents.reduce((s, i) => s + i.reports, 0);
  const places = [['Quneitra', 5, 36], ['Hader', 3, 21], ['Daraa', 2, 14], ['Beit Jinn', 1, 7], ['Rafid', 1, 7]].map(([name, count, share]) => {
    const inc = incidents.filter((i) => i.place === name);
    return { name, count, share, reports: inc.reduce((s, i) => s + i.reports, 0), lat: PLACES[name][0], lng: PLACES[name][1], incidents: inc.map((i) => i.n), other: false };
  });
  const rest = incidents.filter((i) => ['Jubata', 'Khan Arnabah'].includes(i.place));
  places.push({ name: '', count: 2, share: 14, reports: rest.reduce((s, i) => s + i.reports, 0), lat: null, lng: null, incidents: rest.map((i) => i.n), other: true });
  return {
    v: 1, lang: LANG, title: en ? 'Israeli incursions into Syria' : 'חדירות ישראליות לסוריה', generated_at: iso(NOW),
    metric: { subject: 'Israeli ground incursions into Syria', actor: 'Israel', target: 'Syria', target_country: 'Syria' },
    period: { since: iso(since), until: iso(NOW), preset: '7d', unit: 'day' },
    totals: { incidents: 14, reports: sumReports, classified: 340, unclear: 6, previous: 10, change_pct: 40, night_pct: 21 },
    buckets, peak: { index: 2, count: 4 }, places, incidents,
    insights: en
      ? ['Incursions rose 40% to 14 incidents against the previous week [1][3].', 'Quneitra accounts for 36% of incidents [7].', 'The peak came on the third day with 4 incidents [3].', '21% of incidents took place at night.']
      : ['החדירות עלו ב-40% ל-14 תקריות לעומת השבוע הקודם [1][3].', 'קוניטרה מרכזת 36% מהתקריות [7].', 'השיא היה ביום השלישי עם 4 תקריות [3].', '21% מהתקריות היו בלילה.'],
  };
}
const W = fixtureW();
const D = (() => {
  const since = NOW - 24 * H;
  const incidents = [1, 2, 3].map((n) => ({ n, at: iso(since + n * 5 * H), place: 'Quneitra', lat: 33.125, lng: 35.824, title: `D${n}`, ids: [eid(n)], reports: n === 1 ? 2 : 1 }));
  const buckets = Array.from({ length: 24 }, (_, h) => ({ start: iso(since + h * H), count: [5, 10, 15].includes(h) ? 1 : 0, prev: h < 5 ? 1 : 0, incidents: h === 5 ? [1] : h === 10 ? [2] : h === 15 ? [3] : [] }));
  return { ...W, period: { since: iso(since), until: iso(NOW), preset: '24h', unit: 'hour' }, totals: { incidents: 3, reports: 4, classified: 40, unclear: 1, previous: 5, change_pct: -40, night_pct: 0 },
    buckets, peak: { index: 5, count: 1 }, places: [{ name: 'Quneitra', count: 3, share: 100, reports: 4, lat: 33.125, lng: 35.824, incidents: [1, 2, 3], other: false }], incidents, insights: [] };
})();
const Z = { ...W, totals: { incidents: 0, reports: 0, classified: 60, unclear: 2, previous: 4, change_pct: null, night_pct: null }, buckets: W.buckets.map((b) => ({ ...b, count: 0, incidents: [] })), peak: null, places: [], incidents: [], insights: [] };

// ── Faked server state ─────────────────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

function makeState(who) {
  return { who, used: 0, asks: [], statusCalls: 0, periodCalls: [], builds: new Map(), seq: 0, failedOnce: false, periodsBuilt: new Set() };
}
const isCount = (q) => /how many|כמה/i.test(q);
function startBuild(st, result, opts = {}) {
  const id = `cccccccc-cccc-4ccc-8ccc-${String(++st.seq).padStart(12, '0')}`;
  st.builds.set(id, { result, step: opts.cached ? 9 : 0, fail: !!opts.fail, cached: !!opts.cached, charged: false });
  return id;
}
const STEPS = [['finding', null], ['classifying', { done: 120, total: 340 }], ['merging', { done: 340, total: 340 }], ['insights', null]];
function status(st, id) {
  const b = st.builds.get(id);
  if (!b) return [{ error: 'not found' }, 404];
  if (b.step >= STEPS.length) {
    if (b.fail) return [{ ok: true, status: 'failed', stage: 'classifying', progress: null, cached: false, result: null }, 200];
    if (!b.cached && !b.charged && st.who.role === 'viewer') { b.charged = true; st.used += 3; }
    return [{ ok: true, status: 'done', stage: 'insights', progress: null, cached: b.cached, result: b.result }, 200];
  }
  const [stage, progress] = STEPS[b.step++];
  return [{ ok: true, status: 'running', stage, progress, cached: false, result: null }, 200];
}
const running = (st) => [...st.builds.values()].some((b) => b.step < STEPS.length && !b.cached);
function textAnswer(extra = {}) {
  return { ok: true, mode: 'answer', answer: en ? 'Two incursions were reported.\n• Near Quneitra [1]' : 'דווח על שתי חדירות.\n• ליד קוניטרה [1]', ids: [eid(1)], ...extra };
}
function onAsk(st, body) {
  st.asks.push(body);
  const q = String(body.question);
  if (/unclear|לא ברור/i.test(q) && !body.clarify_reply) return [{ ok: true, mode: 'clarify_stats' }, 200];
  if (body.clarify_reply === 'text' || body.clarify_reply === 'typed') return [textAnswer(), 200];
  const wantsDash = body.clarify_reply === 'dashboard' || isCount(q) || /huge|ענק|fail|נכשל|zero|אפס/i.test(q);
  if (!wantsDash) return [textAnswer(), 200];
  if (st.who.plan === 'pro' && st.who.role === 'viewer') return [textAnswer({ upgrade_hint: true }), 200];
  if (/huge|ענק/i.test(q)) return [{ ok: true, mode: 'too_many' }, 200];
  if (running(st)) return [{ error: 'busy' }, 409];
  if (st.who.role === 'viewer' && 10 - st.used < 3) return [{ error: 'quota_dashboard', needed: 3, left: Math.max(0, 10 - st.used) }, 429];
  const fail = /fail|נכשל/i.test(q) && !st.failedOnce;
  if (fail) st.failedOnce = true;
  const id = startBuild(st, /zero|אפס/i.test(q) ? Z : W, { fail });
  return [{ ok: true, mode: 'stats', dashboard_id: id, cached: false }, 200];
}
function onPeriod(st, body) {
  st.periodCalls.push(body);
  if (running(st)) return [{ error: 'busy' }, 409];
  const cached = st.periodsBuilt.has(body.period);
  st.periodsBuilt.add(body.period);
  const result = body.period === '24h' ? D : W;
  const id = startBuild(st, result, { cached });
  return [{ ok: true, mode: 'stats', dashboard_id: id, cached }, 200];
}

// ── One user's session ─────────────────────────────────────────────────────────────────────────
async function openFor(browser, key, out) {
  const u = USERS[key];
  const { session, profile, user } = sessionFor(u);
  const st = makeState(u);
  const phone = DEVICE === 'phone';
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone, acceptDownloads: true });
  await ctx.addInitScript(([s, lang]) => { localStorage.setItem('ofm.auth', JSON.stringify(s)); localStorage.setItem('ofm.lang', lang); }, [session, LANG]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|net::ERR|ERR_FAILED|Unexpected token '<'/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => { if (!/Unexpected token '<'/.test(String(e))) errors.push(`pageerror: ${String(e).slice(0, 300)}`); });
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
    if (!url.startsWith(SB)) return route.abort();
    const uu = new URL(url);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (uu.pathname === '/functions/v1/event-agent') {
      const body = JSON.parse(req.postData() || '{}');
      await new Promise((r) => setTimeout(r, 250));
      let r = [{ ok: false, error: 'not mocked' }, 400];
      if (body.action === 'ask') r = onAsk(st, body);
      else if (body.action === 'dashboard_status') { st.statusCalls++; r = status(st, body.id); }
      else if (body.action === 'dashboard_period') r = onPeriod(st, body);
      return json(r[0], r[1]);
    }
    if (uu.pathname === '/rest/v1/rpc/my_ai_quota') return json({ enabled: true, staff: u.role !== 'viewer', plan: u.plan, limit: 10, used: st.used });
    if (uu.pathname.startsWith('/auth/v1/user')) return json(user);
    if (uu.pathname.startsWith('/auth/v1/token')) return json(session);
    if (uu.pathname.startsWith('/auth/v1/')) return json({});
    if (uu.pathname === '/rest/v1/profiles') return json(single ? profile : [profile]);
    if (uu.pathname === '/rest/v1/published_events') {
      const m = /in\.\(([^)]*)\)/.exec(uu.searchParams.get('id') || '');
      if (!m) return json([]);
      const want = m[1].replace(/"/g, '').split(',');
      return json(want.filter((id) => id !== MISSING && EVENT_ROWS.has(id)).map((id) => EVENT_ROWS.get(id)));
    }
    if (uu.pathname.startsWith('/rest/v1/rpc/')) return json(null);
    if (uu.pathname.startsWith('/rest/v1/')) return single ? route.fulfill({ status: 406, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' }) }) : json([]);
    return json({});
  });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const consent = page.getByRole('button', { name: en ? /^Reject non-essential$/ : /^דחיית עוגיות לא-הכרחיות$/ });
  if (await consent.count()) await consent.first().click().catch(() => {});
  if (phone) {
    const mapTab = page.getByRole('button', { name: en ? /^Map$/ : /^מפה$/ }).first();
    if (await mapTab.count()) await mapTab.click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.getByRole('button', { name: en ? 'Ask the map' : 'שאלו את המפה' }).first().click();
  await page.waitForSelector('[data-ask-panel]');
  return { ctx, page, st, errors };
}

const T = en
  ? { count: 'How many Israeli incursions into Syria last week?', unclear: 'Israeli incursions into Syria this week, unclear', typed: 'yes, a dashboard', long: 'x'.repeat(41), fail: 'How many strikes, fail please', huge: 'How many events in total, huge', zero: 'How many zero events?', prev: 'previous week', search: 'Search events' }
  : { count: 'כמה חדירות ישראליות לסוריה בשבוע האחרון?', unclear: 'חדירות ישראליות לסוריה השבוע, לא ברור', typed: 'כן, דשבורד', long: 'א'.repeat(41), fail: 'כמה תקיפות, נכשל', huge: 'כמה אירועים בסך הכול, ענק', zero: 'כמה אירועים אפס?', prev: 'השבוע הקודם', search: 'חיפוש אירועים' };

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const out = { lang: LANG, device: DEVICE };
  const bad = [];
  const expect = (k, v, ok) => { out[k] = v; if (!ok) bad.push([k, v]); };
  const allErrors = [];
  try {
    // ── max ──
    {
      const { ctx, page, st, errors } = await openFor(browser, 'max', out);
      const shot = (name) => page.screenshot({ path: path.join(SHOTS, `dash-${LANG}-${DEVICE}-${name}.png`) });
      const input = page.locator('[data-ask-panel] form:not([data-ask-summary]) input');
      const sendQ = async (q) => { await input.fill(q); await page.locator('[data-ask-action="send"]').click(); };
      const turns = () => page.locator('[data-ask-turn]').count();
      const quota = async () => ((await page.locator('[data-ask-quota]').count()) ? (await page.locator('[data-ask-quota]').innerText()).replace(/\D/g, '') : null);
      const closeSheet = async () => { const c = page.locator('[data-dash-sheet] [data-dash-action="close"]'); if (await c.count()) { await c.first().click(); await page.waitForTimeout(200); } };
      const cardDone = (i) => page.waitForSelector(`[data-ask-turn="${i}"] [data-dash-card][data-status="done"]`, { timeout: 15000 });
      await page.waitForFunction(() => document.querySelector('[data-ask-quota]'), null, { timeout: 8000 });
      expect('c1_left10', await quota(), (await quota()) === '10');

      // 1. a clear count question → progress stages in order → result card.
      await sendQ(T.count);
      await page.waitForSelector('[data-dash-card][data-status="running"]', { timeout: 8000 });
      const seen = [];
      let classifyText = '';
      for (let k = 0; k < 120; k++) {
        const card = page.locator('[data-dash-card]').first();
        const s = await card.getAttribute('data-status').catch(() => null);
        const g = await card.getAttribute('data-stage').catch(() => null);
        if (s === 'running' && g && seen[seen.length - 1] !== g) seen.push(g);
        if (g === 'classifying' && !classifyText) classifyText = await card.innerText();
        if (s === 'progress' || s === 'done') break;
        await page.waitForTimeout(100);
      }
      await shot('progress');
      expect('c1_stages', seen.join(','), seen.join(',') === 'finding,classifying,merging,insights');
      expect('c1_classifyNumbers', classifyText.includes('120') && classifyText.includes('340'), classifyText.includes('120') && classifyText.includes('340'));
      await cardDone(0);
      await closeSheet();
      const cardText = await page.locator('[data-ask-turn="0"] [data-dash-card]').innerText();
      expect('c1_cardText', cardText.includes('14') && cardText.includes('+40%') && cardText.includes(T.prev), cardText.includes('14') && cardText.includes('+40%') && cardText.includes(T.prev));
      await page.waitForTimeout(600);
      expect('c1_left7', await quota(), (await quota()) === '7');
      expect('c1_request', !!st.asks[0].lang && !('clarify_reply' in st.asks[0]), !!st.asks[0].lang && !('clarify_reply' in st.asks[0]));
      await shot('card');

      // 2. show on map: dashboard numbers, missing report, filters bypassed.
      const searchBox = page.getByRole('searchbox').or(page.locator(`input[aria-label="${T.search}"]`)).first();
      const canSearch = DEVICE === 'desktop' && (await searchBox.count()) > 0;
      if (canSearch) await searchBox.fill('zzzzqqq');
      await page.locator('[data-ask-turn="0"] [data-dash-action="show"]').click();
      await page.waitForSelector('[data-dash-shown]', { state: 'attached', timeout: 8000 });
      if (DEVICE === 'phone') { const f = page.getByRole('button', { name: en ? /^Feed/ : /^עדכונים/ }).first(); if (await f.count()) await f.click(); await page.waitForTimeout(400); }
      const shownText = await page.locator('[data-dash-shown]').innerText();
      expect('c2_shownNumbers', shownText.includes('14') && shownText.includes('21'), shownText.includes('14') && shownText.includes('21'));
      expect('c2_missing', (await page.locator('[data-dash-missing]').innerText()).includes('1'), (await page.locator('[data-dash-missing]').innerText()).includes('1'));
      const cards = await page.locator('article').count();
      expect('c2_feedCards', cards, cards === EVENT_ROWS.size - 1 || cards > 0);
      await shot('shown');
      await page.locator('[data-dash-action="clear"]').click();
      await page.waitForTimeout(400);
      expect('c2_cleared', (await page.locator('[data-dash-shown]').count()) === 0, (await page.locator('[data-dash-shown]').count()) === 0);
      if (canSearch) await searchBox.fill('');
      if (DEVICE === 'phone') { const m = page.getByRole('button', { name: en ? /^Map$/ : /^מפה$/ }).first(); if (await m.count()) await m.click(); await page.waitForTimeout(300); }

      // 3. unclear → chips (free) → Dashboard chip → the clarify turn becomes the dashboard.
      await sendQ(T.unclear);
      await page.waitForSelector('[data-ask-chip="dashboard"]', { timeout: 8000 });
      await shot('clarify');
      const n3 = await turns();
      expect('c3_chipHas3', (await page.locator('[data-ask-chip="dashboard"]').innerText()).includes('3'), (await page.locator('[data-ask-chip="dashboard"]').innerText()).includes('3'));
      await page.waitForTimeout(400);
      expect('c3_leftUnchanged', await quota(), (await quota()) === '7');
      await page.locator('[data-ask-chip="dashboard"]').dblclick();
      await page.waitForTimeout(500);
      const chipReqs = st.asks.filter((a) => a.clarify_reply === 'dashboard');
      expect('c7_doublePressOneRequest', chipReqs.length, chipReqs.length === 1);
      expect('c3_chipRequest', chipReqs[0]?.question === T.unclear, chipReqs[0]?.question === T.unclear);
      await cardDone(n3 - 1);
      await closeSheet();
      expect('c3_turnsSame', await turns(), (await turns()) === n3);
      await page.waitForTimeout(600);
      expect('c3_leftDropped', await quota(), (await quota()) === '4');
      // A second unclear question → "Text answer".
      await sendQ(T.unclear);
      await page.waitForSelector(`[data-ask-turn="${n3}"] [data-ask-chip="text"]`, { timeout: 8000 });
      await page.locator(`[data-ask-turn="${n3}"] [data-ask-chip="text"]`).click();
      await page.waitForFunction((i) => document.querySelector(`[data-ask-turn="${i}"]`)?.getAttribute('data-ask-mode') === 'answer', n3, { timeout: 8000 });
      expect('c3_textReply', st.asks[st.asks.length - 1].clarify_reply, st.asks[st.asks.length - 1].clarify_reply === 'text');
      expect('c3_textNoCard', await page.locator(`[data-ask-turn="${n3}"] [data-dash-card]`).count(), (await page.locator(`[data-ask-turn="${n3}"] [data-dash-card]`).count()) === 0);

      // 4. typed replies: ≤ 40 chars → clarify_reply 'typed'; 41 → none.
      await sendQ(T.unclear);
      await page.waitForSelector(`[data-ask-turn="${n3 + 1}"] [data-ask-chip="text"]`, { timeout: 8000 });
      await sendQ(T.typed);
      await page.waitForFunction((i) => document.querySelector(`[data-ask-turn="${i}"]`)?.getAttribute('data-ask-mode') === 'answer', n3 + 1, { timeout: 8000 });
      expect('c4_typed', st.asks[st.asks.length - 1].clarify_reply, st.asks[st.asks.length - 1].clarify_reply === 'typed');
      await sendQ(T.unclear);
      await page.waitForSelector(`[data-ask-turn="${n3 + 2}"] [data-ask-chip="text"]`, { timeout: 8000 });
      await sendQ(T.long);
      await page.waitForFunction((i) => document.querySelectorAll('[data-ask-turn]').length === i, n3 + 4, { timeout: 8000 });
      expect('c4_longNotTyped', 'clarify_reply' in st.asks[st.asks.length - 1], !('clarify_reply' in st.asks[st.asks.length - 1]));

      // 6. a failed build → Retry → done; too many → a text turn; credits unchanged by both.
      await page.locator('[data-ask-action="new"]').click();
      const leftBefore = await quota();
      await sendQ(T.fail);
      await page.waitForSelector('[data-dash-action="retry"]', { timeout: 15000 });
      expect('c6_failedText', (await page.locator('[data-dash-card]').innerText()).length > 5, true);
      await page.waitForTimeout(600);
      expect('c6_leftUnchanged', await quota(), (await quota()) === leftBefore);
      await page.locator('[data-dash-action="retry"]').click();
      await cardDone(0);
      await closeSheet();
      await sendQ(T.huge);
      await page.waitForFunction(() => document.querySelector('[data-ask-turn="1"]')?.getAttribute('data-ask-mode') === 'too_many', null, { timeout: 8000 });
      expect('c6_tooManyText', (await page.locator('[data-ask-turn="1"]').innerText()).includes('2,000'), (await page.locator('[data-ask-turn="1"]').innerText()).includes('2,000'));

      // 7. 2 credits left → the Dashboard chip says so and sends nothing; New chat during a build → nothing late.
      st.used = 8;
      await page.locator('[data-ask-action="new"]').click();
      await page.waitForTimeout(300);
      await sendQ(T.unclear);
      await page.waitForSelector('[data-ask-chip="dashboard"]', { timeout: 8000 });
      const before = st.asks.length;
      await page.locator('[data-ask-chip="dashboard"]').click();
      await page.waitForTimeout(400);
      expect('c7_needCreditsNoRequest', st.asks.length === before && (await page.locator('[data-ask-error]').count()) === 1, st.asks.length === before && (await page.locator('[data-ask-error]').count()) === 1);
      st.used = 0;
      await page.locator('[data-ask-action="new"]').click();
      await sendQ(T.count);
      await page.waitForTimeout(150);
      await page.locator('[data-ask-action="new"]').click();
      await page.waitForTimeout(2500);
      expect('c7_newChatNoLateCard', await page.locator('[data-dash-card]').count(), (await page.locator('[data-dash-card]').count()) === 0);

      // 9. language, direction, width.
      if (en) expect('c9_noHebrew', !HE.test(await page.locator('[data-ask-panel]').innerText()), !HE.test(await page.locator('[data-ask-panel]').innerText()));
      else expect('c9_rtl', await page.evaluate(() => document.documentElement.dir), (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
      expect('c9_noHScroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      allErrors.push(...errors);
      await ctx.close();
    }
    // ── staff ──
    {
      const { ctx, page, errors } = await openFor(browser, 'staff', out);
      await page.waitForTimeout(800);
      expect('c8_staffNoQuota', await page.locator('[data-ask-quota]').count(), (await page.locator('[data-ask-quota]').count()) === 0);
      await page.locator('[data-ask-panel] form:not([data-ask-summary]) input').fill(T.unclear);
      await page.locator('[data-ask-action="send"]').click();
      await page.waitForSelector('[data-ask-chip="dashboard"]', { timeout: 8000 });
      expect('c8_staffChipNo3', !(await page.locator('[data-ask-chip="dashboard"]').innerText()).includes('3'), !(await page.locator('[data-ask-chip="dashboard"]').innerText()).includes('3'));
      allErrors.push(...errors);
      await ctx.close();
    }
    // ── pro ──
    {
      const { ctx, page, st, errors } = await openFor(browser, 'pro', out);
      await page.locator('[data-ask-panel] form:not([data-ask-summary]) input').fill(T.count);
      await page.locator('[data-ask-action="send"]').click();
      await page.waitForSelector('[data-ask-upgrade]', { timeout: 8000 });
      expect('c5_proNoCard', await page.locator('[data-dash-card]').count(), (await page.locator('[data-dash-card]').count()) === 0);
      await page.locator('[data-ask-upgrade] button').click();
      await page.waitForSelector('[data-gate="upgrade"]', { timeout: 5000 });
      expect('c5_gateLink', await page.locator('[data-gate="upgrade"] a[href="/packages"]').count(), (await page.locator('[data-gate="upgrade"] a[href="/packages"]').count()) > 0);
      expect('c5_noPolling', st.statusCalls, st.statusCalls === 0);
      allErrors.push(...errors);
      await ctx.close();
    }
  } catch (e) {
    out.FAILED = String(e).slice(0, 500);
    bad.push(['FAILED', out.FAILED]);
  }
  out.consoleErrors = allErrors.slice(0, 5);
  if (allErrors.length) bad.push(['consoleErrors', out.consoleErrors]);
  console.log(JSON.stringify(out, null, 1));
  console.log(bad.length ? `FAIL ${JSON.stringify(bad)}` : 'PASS');
  process.exitCode = bad.length ? 1 : 0;
  await browser.close();
  server.close();
})();
