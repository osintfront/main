// Media translation — browser checks (Playwright) against a local build and a FAKED Supabase.
// "Translate image/video" after Expand in the event details window: the button and its count, one
// paid call with polls, the panel (plain text only, own text direction, speech), saved readings
// opened with no call, refusals that do not loop, "new media", plan gates and the staff re-run.
//
// Build:  VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=<any JWT with role anon> \
//         VITE_SITE_URL=https://osintfront.com npx vite build --outDir /tmp/sets-qa/dist --emptyOutDir
// Run:    SETS_QA_DIST=/tmp/sets-qa/dist node tests/e2e/media-translation.mock.cjs <he|en> <desktop|phone> <pro|free|guest|staff>
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
const ev = (title, description, kinds) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`, title, description, severity: 'high', latitude: 33.27 + seq / 100, longitude: 35.2, location_name: 'Tyre',
  location_name_he: null, location_name_en: null, location_precision: 'city', sources: [], locations: [], country: 'Lebanon', region: '', city: '',
  source_name: 'Telegram', source_url: null, source_type: 'social_media', occurred_at: new Date(Date.now() - seq * H).toISOString(), published_at: new Date().toISOString(),
  is_breaking: false, is_verified: false, translations: { en: { title, summary: description } }, category_id: null, category_slug: 'uav', category_name: 'UAV', category_icon: 'FixedWingUav',
  category_color: '#6d28d9', category_marker_color: '#6d28d9', media_kinds: kinds, report_group: null, source_count: 0, updated_at: new Date().toISOString(), secondary_categories: [],
});
const A = ev('Drone wreck found near Tyre', 'Pictures of a drone fragment were shared.', ['image', 'video']);
const B = ev('Statement on the border', 'A spokesman spoke.', []);
const LIVE = [A, B];
const MEDIA = [
  { id: 'm-pic', event_id: A.id, kind: 'image', public_url: 'https://fake.supabase.co/storage/v1/object/public/m/p.jpg', width: 10, height: 10, source_msg_key: null, source_url: null, video_state: null, thumb_id: null, created_at: '2026-11-13T00:00:00Z' },
  { id: 'm-still', event_id: A.id, kind: 'image', public_url: 'https://fake.supabase.co/storage/v1/object/public/m/s.jpg', width: 10, height: 10, source_msg_key: 'k', source_url: null, video_state: 'remote', thumb_id: null, created_at: '2026-11-13T00:00:01Z' },
];
const pair = (o) => ({ orig: 'ساخت ایران', lang: 'fa', he: 'תוצרת איראן', en: 'Made in Iran', where_he: 'על הלוח', where_en: 'on the plate', from: 'frame', ...o });
const PIC = { media_id: 'm-pic', kind: 'image', thumb: 'https://fake.supabase.co/storage/v1/object/public/m/p.jpg', description_he: 'שבר <script>window.__x=1</script>', description_en: 'A fragment <script>window.__x=1</script>', texts: [pair({}), pair({ orig: 'LIVE', lang: 'en', he: 'שידור חי', en: 'live', where_he: '', where_en: '' })], speech: null };
const VID = { media_id: 'm-still', kind: 'video', thumb: 'https://fake.supabase.co/storage/v1/object/public/m/s.jpg', description_he: 'דובר מול מצלמה', description_en: 'A spokesman at a desk', texts: [pair({ orig: 'عاجل', lang: 'ar', he: 'דחוף', en: 'Urgent', where_he: 'בכותרת', where_en: 'in the banner', from: 'video' })],
  speech: { state: 'ok', lang: 'ar', seconds: 700, orig: 'قال المتحدث', he: 'הדובר אמר', en: 'The spokesman said', summary_he: 'הדובר הודיע על תקיפה', summary_en: 'The spokesman announced a strike', cut: true } };
const isStaff = PLAN === 'staff';
const limit = isStaff ? null : PLAN === 'pro' ? 3 : 0;
let mtState = 'empty'; // empty | filled | saved1
let mtMode = 'ok'; // ok | quota | budget | busy | fail
const mt = () => {
  const base = { working: false, failed: false, staff: isStaff, used: 0, limit, budget_left: true };
  if (mtState === 'empty') return { ...base, items: [], todo: 2 };
  if (mtState === 'saved1') return { ...base, items: [PIC], todo: 1, used: 1 };
  return { ...base, items: [PIC, VID], todo: 0, used: 1 };
};
const FEATURES = ['live_map', 'feed', 'event_open', 'event_summary', 'source_link', 'media', 'archive_days', 'feed_search', 'copy_text', 'share_daily'];
const planRows = [
  ...['guest', 'free', 'pro', 'max'].flatMap((p) => FEATURES.map((k) => ({ feature_key: k, plan_id: p, enabled: true, limit_value: null }))),
  { feature_key: 'feed_delay_min', plan_id: 'guest', enabled: true, limit_value: 0 },
  { feature_key: 'expand_daily', plan_id: 'free', enabled: true, limit_value: 5 },
  { feature_key: 'expand_daily', plan_id: 'pro', enabled: true, limit_value: 50 },
  { feature_key: 'expand_daily', plan_id: 'max', enabled: true, limit_value: null },
  { feature_key: 'media_translate', plan_id: 'guest', enabled: false, limit_value: 0 },
  { feature_key: 'media_translate', plan_id: 'free', enabled: false, limit_value: 0 },
  { feature_key: 'media_translate', plan_id: 'pro', enabled: true, limit_value: 3 },
  { feature_key: 'media_translate', plan_id: 'max', enabled: true, limit_value: 10 },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
const errors = [];
const calls = { start: 0, poll: 0, read: 0, expand: 0, redo: 0 };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';

async function routeAll(page) {
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
    if (url.startsWith(`${SB}/storage/`)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG });
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
    if (u.pathname === '/rest/v1/event_media') {
      const m = /in\.\(([^)]*)\)/.exec(u.searchParams.get('event_id') || '');
      const ids = m ? m[1].replace(/"/g, '').split(',') : [];
      return json(MEDIA.filter((r) => ids.includes(r.event_id)));
    }
    if (u.pathname === '/rest/v1/rpc/my_feature_usage') return json(PLAN === 'guest' ? {} : { expand_daily: { used: 0, limit: PLAN === 'free' ? 5 : 50 } });
    if (u.pathname === '/rest/v1/rpc/media_translation') {
      calls.read++;
      return json(PLAN === 'free' || PLAN === 'guest' ? null : mt());
    }
    if (u.pathname === '/functions/v1/event-agent') {
      const b = JSON.parse(req.postData() || '{}');
      if (b.action === 'expand') {
        calls.expand++;
        if (PLAN === 'guest') return json({ error: 'signup_required' }, 401);
        return json({ he: { details: 'פירוט מלא של האירוע.', religious: '', implications: '' }, en: { details: 'The full report of the event.', religious: '', implications: '' } });
      }
      if (b.action === 'media_translate') {
        if (b.poll) calls.poll++;
        else calls.start++;
        if (b.redo) calls.redo++;
        if (mtMode === 'quota') return json({ error: 'quota_exceeded', used: 3, limit: 3 }, 429);
        if (mtMode === 'budget') return json({ error: 'budget' }, 429);
        if (mtMode === 'busy') return json({ error: 'busy' }, 429);
        if (mtMode === 'fail') return b.poll ? json({ error: 'failed' }, 409) : json({ pending: true, started: true }, 202);
        if (!b.poll) return json({ pending: true, started: true }, 202);
        mtState = 'filled';
        return json({ ok: true });
      }
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
    ? { details: /^פרטי האירוע$/, expand: /^הרחב$/, button: 'תרגם תמונה/סרטון', left: 'נשארו 3/3 היום', working: 'קורא את המדיה', show: 'הצג תרגום מדיה', pic: 'תמונה 1', vid: 'סרטון 1', tr: 'תוצרת איראן', cut: 'ההקלטה ארוכה', ai: 'נוצר בידי AI', failed: 'לא ניתן היה לתרגם', retry: 'נסו שוב', quota: 'ניצלת את', budget: 'התקציב היומי לתרגומי', busy: 'שני תרגומי מדיה', more: '(1)', summary: 'הדובר הודיע על תקיפה', feed: /^(עדכונים|פיד|רשימה)/ }
    : { details: /^Event details$/, expand: /^Expand$/, button: 'Translate image/video', left: '3/3 left today', working: 'Reading the media', show: 'Show media translation', pic: 'Picture 1', vid: 'Video 1', tr: 'Made in Iran', cut: 'The recording is long', ai: 'Made by AI', failed: 'could not be translated', retry: 'Try again', quota: "You have used today's", budget: "Today's budget for media", busy: 'Two media translations', more: '(1)', summary: 'The spokesman announced a strike', feed: /^(Feed|List|Updates)/ };

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
    await settle(page);
    return { ctx, page };
  }
  async function settle(page) {
    await page.waitForTimeout(3500);
    const consent = page.getByRole('button', { name: /^(Reject non-essential|דחיית עוגיות לא-הכרחיות)$/ });
    if (await consent.count()) await consent.first().click().catch(() => {});
    if (phone) {
      const b = page.getByRole('button', { name: T.feed }).first();
      if (await b.count()) await b.click().catch(() => {});
    }
  }
  const details = (page) => page.locator('[aria-labelledby="event-details-title"]');
  const openDetails = async (page, e) => {
    await page.locator(`#event-card-${e.id}`).getByRole('button', { name: T.details }).click();
    await details(page).waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
  };
  const closeDetails = async (page) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  };
  const expand = async (page) => {
    await details(page).getByRole('button', { name: T.expand }).first().click();
    await page.waitForTimeout(1200);
  };
  const mtBtn = (page) => details(page).locator('[data-mt-button]');
  const panelText = async (page) => details(page).locator('[data-mt-panel]').innerText();
  const fresh = async (page, state, m) => {
    mtState = state;
    mtMode = m;
    await page.reload({ waitUntil: 'domcontentloaded' }); // new module state: the session cache is empty again
    await settle(page);
    await openDetails(page, A);
    await expand(page);
  };

  try {
    const { ctx, page } = await open();
    if (PLAN === 'guest') {
      await openDetails(page, A);
      await expand(page);
      out.c7_signupGate = (await page.locator('[data-gate="signup"]').count()) === 1;
      out.c7_noButton = (await page.locator('[data-mt-button]').count()) === 0;
      out.c7_noCalls = calls.read === 0 && calls.start === 0;
    } else if (PLAN === 'free') {
      await openDetails(page, A);
      await expand(page);
      out.c7_expanded = (await details(page).innerText()).includes('The full report');
      out.c7_lock = (await mtBtn(page).count()) === 1 && (await mtBtn(page).locator('svg.lucide-lock').count()) === 1;
      await mtBtn(page).click();
      await page.waitForTimeout(500);
      out.c7_upgradeGate = (await page.locator('[data-gate="upgrade"]').count()) === 1;
      out.c7_noCalls = calls.read === 0 && calls.start === 0;
    } else {
      // 1. the button only after Expand, only in the details window, only with media
      const cardExpand = page.locator(`#event-card-${A.id}`).getByRole('button', { name: T.expand });
      if (await cardExpand.count()) {
        await cardExpand.first().click();
        await page.waitForTimeout(1200);
      }
      out.c1_feedCardNone = (await page.locator(`#event-card-${A.id} [data-mt-button]`).count()) === 0;
      await openDetails(page, B);
      await expand(page);
      out.c1_noMediaNone = (await mtBtn(page).count()) === 0;
      await closeDetails(page);
      await openDetails(page, A);
      out.c1_beforeExpandNone = (await mtBtn(page).count()) === 0;
      await expand(page);
      await mtBtn(page).waitFor({ timeout: 5000 });
      await page.waitForTimeout(500);
      out.c1_buttonText = (await mtBtn(page).innerText()).includes(T.button);
      const row = await mtBtn(page).locator('xpath=..').innerText();
      out.c1_left = isStaff ? true : row.includes(T.left);
      if (isStaff) out.c9_noLeft = !/\d+\/\d+/.test(row);
      if (LANG === 'he') out.c8_rtl = (await page.evaluate(() => document.documentElement.dir)) === 'rtl';

      // 2. one paid call, a working line, then the panel
      await mtBtn(page).click();
      await details(page).locator('[data-mt-working]').waitFor({ timeout: 3000 });
      out.c2_working = (await details(page).locator('[data-mt-working]').innerText()).includes(T.working);
      await page.screenshot({ path: path.join(SHOTS, `mt-${LANG}-${DEVICE}-${PLAN}-working.png`) });
      await details(page).locator('[data-mt-item="video"]').waitFor({ timeout: 15000 });
      out.c2_oneCall = calls.start === 1;

      // 3. the panel
      const txt = await panelText(page);
      out.c3_labels = txt.includes(T.pic) && txt.includes(T.vid);
      out.c3_scriptText = txt.includes('<script>');
      out.c3_noScriptRun = await page.evaluate(() => window.__x === undefined);
      out.c3_pair = txt.includes('ساخت ایران') && txt.includes(T.tr);
      if (LANG === 'en') {
        const live = details(page).locator('[data-mt-pair]', { hasText: 'LIVE' });
        out.c3_liveNoTranslation = (await live.count()) === 1 && !(await live.innerText()).toLowerCase().replace('live', '').includes('live');
      }
      const vid = details(page).locator('[data-mt-item="video"]');
      out.c3_summary = (await vid.innerText()).includes(T.summary);
      out.c3_detailsClosed = (await vid.locator('details').count()) === 2 && (await vid.locator('details[open]').count()) === 0;
      out.c3_cut = (await vid.innerText()).includes(T.cut);
      out.c3_aiLine = txt.includes(T.ai);
      out.c8_persianAuto = (await details(page).locator('bdi[dir="auto"]', { hasText: 'ساخت ایران' }).count()) === 1;
      if (phone) {
        const box = await details(page).locator('[data-mt-panel]').boundingBox();
        out.c8_fits = box.x >= 0 && box.x + box.width <= 390 + 1;
        out.c8_noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
        const pr = details(page).locator('[data-mt-pair]').first();
        const a = await pr.locator('bdi').boundingBox();
        const b = await pr.locator(':scope > span').first().boundingBox();
        out.c8_stacked = b.y >= a.y + a.height - 1;
      }
      await details(page).locator('[data-mt-panel]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOTS, `mt-${LANG}-${DEVICE}-${PLAN}-panel.png`) });

      // 9. staff re-run: confirm, redo: true
      if (isStaff) {
        const before = out.confirms || 0;
        await details(page).locator('[data-mt-redo]').click();
        await details(page).locator('[data-mt-item="video"]').waitFor({ timeout: 15000 });
        await page.waitForTimeout(500);
        out.c9_confirm = (out.confirms || 0) === before + 1;
        out.c9_redo = calls.redo === 1 && calls.start === 2;
      }

      // 4. a saved reading opens with no call
      const startBefore = calls.start;
      await closeDetails(page);
      await openDetails(page, A);
      await expand(page);
      await mtBtn(page).waitFor({ timeout: 5000 });
      out.c4_show = (await mtBtn(page).innerText()).includes(T.show);
      await mtBtn(page).click();
      await page.waitForTimeout(800);
      out.c4_panel = (await details(page).locator('[data-mt-item]').count()) === 2;
      out.c4_noCall = calls.start === startBefore && calls.poll >= 1;

      if (!isStaff) {
        // 5. refusals that do not loop
        for (const [m, text] of [['fail', T.failed], ['quota', T.quota], ['budget', T.budget], ['busy', T.busy]]) {
          await fresh(page, 'empty', m);
          const s0 = calls.start;
          await mtBtn(page).click();
          await details(page).locator('[data-mt-notice]').waitFor({ timeout: 15000 });
          out[`c5_${m}`] = (await details(page).locator('[data-mt-notice]').innerText()).includes(text);
          if (m === 'fail') out.c5_retry = (await details(page).locator('[data-mt-retry]').innerText()).includes(T.retry);
          await page.waitForTimeout(5000);
          out[`c5_${m}_oneCall`] = calls.start === s0 + 1;
        }
        // 6. new media
        await fresh(page, 'saved1', 'ok');
        await details(page).locator('[data-mt-more]').waitFor({ timeout: 5000 });
        out.c6_both = (await mtBtn(page).count()) === 1 && (await details(page).locator('[data-mt-more]').count()) === 1;
        out.c6_count = (await details(page).locator('[data-mt-more]').innerText()).includes(T.more);
        const s0 = calls.start;
        await details(page).locator('[data-mt-more]').click();
        await page.waitForTimeout(6000);
        out.c6_oneCall = calls.start === s0 + 1;
      }
    }
    await ctx.close();
  } catch (e) {
    out.FAILED = String(e).slice(0, 400);
  }

  out.calls = { ...calls };
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
