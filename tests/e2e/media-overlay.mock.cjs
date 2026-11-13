// Translation on the picture and subtitles on the video — browser checks (Playwright) against a local
// build and a FAKED Supabase: the Original / Translated switch over a picture, boxes placed on the drawn
// picture, the full-screen viewer, plain text only, each text's direction, the phone, plan gates; the
// subtitle track and its switch; the staff speech note.
//
// Build:  VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=<any JWT with role anon> \
//         VITE_SITE_URL=https://osintfront.com npx vite build --outDir /tmp/sets-qa/dist --emptyOutDir
// Run:    SETS_QA_DIST=/tmp/sets-qa/dist node tests/e2e/media-overlay.mock.cjs <he|en> <desktop|phone> <pro|free|staff>
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
const LIVE = [A];
const ST = 'https://fake.supabase.co/storage/v1/object/public/event-media/t/';
const MEDIA = [
  { id: 'm-vid', event_id: A.id, kind: 'video', public_url: ST + 'v.mp4', width: 640, height: 360, source_msg_key: null, source_url: null, video_state: null, thumb_id: null, created_at: '2026-11-13T00:00:00Z' },
  { id: 'm-pic', event_id: A.id, kind: 'image', public_url: ST + 'p.svg', width: 800, height: 1600, source_msg_key: null, source_url: null, video_state: null, thumb_id: null, created_at: '2026-11-13T00:00:01Z' },
  { id: 'm-old', event_id: A.id, kind: 'image', public_url: ST + 'o.svg', width: 800, height: 600, source_msg_key: null, source_url: null, video_state: null, thumb_id: null, created_at: '2026-11-13T00:00:02Z' },
];
const pair = (o) => ({ orig: 'ساخت ایران', lang: 'fa', he: 'תוצרת איראן', en: 'Made in Iran <script>window.__x=1</script>', where_he: '', where_en: '', from: 'frame', ...o });
const PIC = { media_id: 'm-pic', kind: 'image', thumb: ST + 'p.svg', description_he: 'שבר', description_en: 'A fragment', speech: null,
  texts: [pair({ box: [100, 100, 300, 600] }), pair({ orig: 'بدون صندوق', he: 'בלי תיבה', en: 'No box' })] };
const OLD = { media_id: 'm-old', kind: 'image', thumb: ST + 'o.svg', description_he: 'ישן', description_en: 'Old', speech: null, texts: [pair({ orig: 'قديم', he: 'ישן', en: 'Old text' })] };
const segs = [{ start: 0, end: 2, orig: 'مرحبا', he: 'שלום לכולם', en: 'Hello everyone' }, { start: 2, end: 4, orig: 'أخبار', he: 'חדשות', en: 'News' }];
const VID = (withSegs) => ({ media_id: 'm-vid', kind: 'video', thumb: null, description_he: 'דובר', description_en: 'A spokesman', texts: [],
  speech: { state: 'ok', lang: 'ar', seconds: 4, orig: 'مرحبا\nأخبار', he: 'שלום לכולם\nחדשות', en: 'Hello everyone\nNews', summary_he: 'ברכה', summary_en: 'A greeting', cut: false, ...(withSegs ? { segments: segs } : {}) } });
const isStaff = PLAN === 'staff';
let mtState = 'empty'; // empty | filled | nosegs
const mt = () => {
  const base = { working: false, failed: false, staff: isStaff, used: 0, limit: isStaff ? null : 3, budget_left: true, speech_note: isStaff ? 'route 502 busy generate 429' : null };
  if (mtState === 'empty') return { ...base, items: [], todo: 3 };
  return { ...base, items: [VID(mtState !== 'nosegs'), PIC, OLD], todo: 0, used: 1 };
};
const FEATURES = ['live_map', 'feed', 'event_open', 'event_summary', 'source_link', 'media', 'media_download', 'archive_days', 'feed_search', 'copy_text', 'share_daily'];
const planRows = [
  ...['guest', 'free', 'pro', 'max'].flatMap((p) => FEATURES.map((k) => ({ feature_key: k, plan_id: p, enabled: true, limit_value: null }))),
  { feature_key: 'feed_delay_min', plan_id: 'guest', enabled: true, limit_value: 0 },
  { feature_key: 'expand_daily', plan_id: 'free', enabled: true, limit_value: 5 },
  { feature_key: 'expand_daily', plan_id: 'pro', enabled: true, limit_value: 50 },
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
const calls = { start: 0, poll: 0, read: 0 };
const svg = (w, h, c) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${c}"/></svg>`;
// A 4-second silent mp4 is not available offline; the player is checked through its track only.
const VIDEO = fs.existsSync('/tmp/sets-qa/clip.mp4') ? fs.readFileSync('/tmp/sets-qa/clip.mp4') : Buffer.alloc(0);

async function routeAll(page) {
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
    if (url.startsWith(ST + 'p.svg')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(800, 1600, '#94a3b8') });
    if (url.startsWith(ST + 'o.svg')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(800, 600, '#cbd5e1') });
    if (url.startsWith(ST + 'v.mp4')) return route.fulfill({ status: 200, contentType: 'video/mp4', body: VIDEO });
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
      const m = /in\.\(([^)]*)\)/.exec(u.searchParams.get('id') || '');
      return json(m ? LIVE.filter((e) => m[1].replace(/"/g, '').split(',').includes(e.id)) : LIVE);
    }
    if (u.pathname === '/rest/v1/event_media') {
      const m = /in\.\(([^)]*)\)/.exec(u.searchParams.get('event_id') || '');
      const ids = m ? m[1].replace(/"/g, '').split(',') : [];
      return json(MEDIA.filter((r) => ids.includes(r.event_id)));
    }
    if (u.pathname === '/rest/v1/rpc/my_feature_usage') return json({ expand_daily: { used: 0, limit: 50 } });
    if (u.pathname === '/rest/v1/rpc/media_translation') {
      calls.read++;
      return json(PLAN === 'free' ? null : mt());
    }
    if (u.pathname === '/functions/v1/event-agent') {
      const b = JSON.parse(req.postData() || '{}');
      if (b.action === 'expand') return json({ he: { details: 'פירוט מלא.', religious: '', implications: '' }, en: { details: 'The full report.', religious: '', implications: '' } });
      if (b.action === 'media_translate') {
        if (b.poll) calls.poll++;
        else calls.start++;
        if (!b.poll) return json({ pending: true, started: true }, 202);
        if (mtState === 'empty') mtState = 'filled';
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
    ? { details: /^פרטי האירוע$/, expand: /^הרחב$/, tr: 'תוצרת איראן', sub1: 'שלום לכולם', feed: /^(עדכונים|פיד|רשימה)/ }
    : { details: /^Event details$/, expand: /^Expand$/, tr: 'Made in Iran', sub1: 'Hello everyone', feed: /^(Feed|List|Updates)/ };

  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript(([s, lang]) => {
    if (sessionStorage.getItem('qa-seeded')) return;
    sessionStorage.setItem('qa-seeded', '1');
    localStorage.setItem('ofm.auth', JSON.stringify(s));
    localStorage.setItem('ofm.lang', lang);
  }, [session, LANG]);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|net::ERR|ERR_FAILED|MEDIA_ERR|video/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => { if (!/Unexpected token '<'/.test(String(e))) errors.push(`pageerror: ${String(e).slice(0, 300)}`); });
  await routeAll(page);
  const settle = async () => {
    await page.waitForTimeout(3500);
    const consent = page.getByRole('button', { name: /^(Reject non-essential|דחיית עוגיות לא-הכרחיות)$/ });
    if (await consent.count()) await consent.first().click().catch(() => {});
    if (phone) {
      const b = page.getByRole('button', { name: T.feed }).first();
      if (await b.count()) await b.click().catch(() => {});
    }
  };
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await settle();
  const details = () => page.locator('[aria-labelledby="event-details-title"]');
  const pic = (id) => details().locator(`[data-media-id="${id}"]`);
  const openDetails = async () => {
    await page.locator(`#event-card-${A.id}`).getByRole('button', { name: T.details }).click();
    await details().waitFor({ timeout: 5000 });
    await page.waitForTimeout(600);
  };
  // the box over m-pic, compared with boxPx(imageRect(...)) computed in the page
  const boxCheck = async () =>
    page.evaluate((id) => {
      const host = document.querySelector(`[aria-labelledby="event-details-title"] [data-media-id="${id}"] button`);
      const img = host.querySelector('img');
      const box = host.querySelector('[data-ov-box]');
      if (!img || !box) return { ok: false, why: 'missing' };
      const hr = img.getBoundingClientRect();
      const s = Math.max(hr.width / img.naturalWidth, hr.height / img.naturalHeight);
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      const left = hr.left + (hr.width - w) / 2;
      const top = hr.top + (hr.height - h) / 2;
      const want = { left: left + 0.1 * w, top: top + 0.1 * h, width: 0.5 * w, height: 0.2 * h };
      const b = box.getBoundingClientRect();
      const near = (a, c) => Math.abs(a - c) <= 2;
      const ok = near(b.left, want.left) && near(b.top, want.top) && near(b.width, want.width) && near(b.height, want.height);
      return { ok, b: [b.left, b.top, b.width, b.height].map(Math.round), want: Object.values(want).map(Math.round), inside: b.left >= hr.left - 1 && b.right <= hr.right + 1 };
    }, 'm-pic');

  try {
    await openDetails();
    out.c1_noSwitchBeforeExpand = (await page.locator('[data-ov-mode]').count()) === 0;
    await details().getByRole('button', { name: T.expand }).first().click();
    await page.waitForTimeout(1200);
    if (PLAN === 'free') {
      out.c9_noSwitch = (await page.locator('[data-ov-mode]').count()) === 0;
      out.c9_noRun = calls.start === 0;
    } else {
      await details().locator('[data-mt-button]').click();
      await details().locator('[data-mt-item="video"]').waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      // 2. the switch, Translated pressed, one box in the right place
      out.c2_switch = (await pic('m-pic').locator('[data-ov-mode]').count()) === 2;
      out.c2_translatedPressed = (await pic('m-pic').locator('[data-ov-mode="translated"]').getAttribute('aria-pressed')) === 'true';
      out.c2_oneBox = (await pic('m-pic').locator('[data-ov-box]').count()) === 1;
      const bc = await boxCheck();
      out.c2_boxPlaced = bc.ok;
      if (!bc.ok) out.c2_detail = bc;
      // 3. the file is untouched
      out.c3_src = (await pic('m-pic').locator('img').first().getAttribute('src')) === ST + 'p.svg';
      const dl = pic('m-pic').locator('a[download]');
      out.c3_download = (await dl.count()) === 0 || (await dl.getAttribute('href')) === ST + 'p.svg';
      out.c3_noCanvas = (await page.locator('canvas').count()) === 0;
      // 4. Original / Translated
      await pic('m-pic').locator('[data-ov-mode="original"]').click();
      await page.waitForTimeout(300);
      out.c4_originalHides = (await pic('m-pic').locator('[data-ov-box]').count()) === 0;
      await pic('m-pic').locator('[data-ov-mode="translated"]').click();
      await page.waitForTimeout(300);
      out.c4_translatedShows = (await pic('m-pic').locator('[data-ov-box]').count()) === 1;
      // 5. the old reading has no switch, its pairs still in the panel
      out.c5_oldNoSwitch = (await pic('m-old').locator('[data-ov-mode]').count()) === 0;
      out.c5_oldInPanel = (await details().locator('[data-mt-panel]').innerText()).includes('قديم');
      // 7 / 8. plain text, own direction
      const box = pic('m-pic').locator('[data-ov-box]');
      const text = await box.textContent();
      if (LANG === 'en') out.c7_scriptText = text.includes('<script>');
      out.c7_noScriptRun = await page.evaluate(() => window.__x === undefined);
      out.c8_text = text.includes(T.tr);
      out.c8_dir = (await box.evaluate((el) => getComputedStyle(el).direction)) === (LANG === 'he' ? 'rtl' : 'ltr');
      // 10. phone: inside the picture, no sideways scroll
      if (phone) {
        out.c10_inside = bc.inside;
        out.c10_noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      }
      await pic('m-pic').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOTS, `ov-${LANG}-${DEVICE}-${PLAN}-picture.png`) });
      // 6. the viewer
      await pic('m-pic').locator('button').first().click();
      const lb = page.locator('.ofm-lightbox');
      await lb.waitFor({ timeout: 3000 });
      await page.waitForTimeout(500);
      out.c6_viewerBox = (await lb.locator('[data-ov-box]').count()) === 1;
      await page.screenshot({ path: path.join(SHOTS, `ov-${LANG}-${DEVICE}-${PLAN}-viewer.png`) });
      await lb.locator('[data-ov-box]').click();
      await page.waitForTimeout(300);
      out.c6_orig = (await lb.locator('[data-ov-box][data-ov-state="orig"]').count()) === 1 && (await lb.locator('[data-ov-box]').textContent()).includes('ساخت ایران');
      out.c6_stillOpen = (await page.locator('.ofm-lightbox').count()) === 1;
      await lb.locator('[data-ov-box]').click();
      await page.waitForTimeout(300);
      out.c6_back = (await lb.locator('[data-ov-box][data-ov-state="orig"]').count()) === 0;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      out.c6_closed = (await page.locator('.ofm-lightbox').count()) === 0;
      out.c6_dialogStays = (await details().count()) === 1; // Escape closes the viewer only
      // 11. subtitles on the uploaded video
      const vid = details().locator('[data-media-video="m-vid"]');
      out.c11_track = (await vid.locator('track[kind="subtitles"]').count()) === 1;
      const cues = await vid.locator('video').evaluate(async (v) => {
        const tr = v.querySelector('track');
        if (tr && tr.readyState !== 2) await new Promise((r) => { tr.addEventListener('load', r, { once: true }); setTimeout(r, 3000); });
        const tt = v.textTracks[0];
        return tt && tt.cues ? { n: tt.cues.length, first: tt.cues[0]?.text, mode: tt.mode } : null;
      });
      out.c11_cues = !!cues && cues.n === 2 && cues.first === T.sub1 && cues.mode === 'showing';
      if (!out.c11_cues) out.c11_detail = cues;
      const tog = vid.locator('[data-sub-toggle]');
      await tog.click();
      await page.waitForTimeout(200);
      out.c11_off = (await vid.locator('video').evaluate((v) => v.textTracks[0]?.mode)) === 'disabled' && (await tog.getAttribute('aria-pressed')) === 'false';
      await tog.click();
      await page.waitForTimeout(200);
      out.c11_on = (await vid.locator('video').evaluate((v) => v.textTracks[0]?.mode)) === 'showing';
      // 13. the staff note
      const note = details().locator('[data-mt-staff-note]');
      out.c13_note = isStaff ? (await note.count()) === 1 && (await note.innerText()).includes('route 502 busy generate 429') : (await note.count()) === 0;
      // 12. a reading without timed lines: no track, no switch, the speech text still in the panel
      mtState = 'nosegs';
      await page.reload({ waitUntil: 'domcontentloaded' });
      await settle();
      await openDetails();
      await details().getByRole('button', { name: T.expand }).first().click();
      await details().locator('[data-mt-button]').waitFor({ timeout: 5000 });
      await page.waitForTimeout(800);
      await details().locator('[data-mt-button]').click();
      await details().locator('[data-mt-item="video"]').waitFor({ timeout: 5000 });
      out.c12_noTrack = (await details().locator('[data-media-video="m-vid"] track').count()) === 0 && (await details().locator('[data-sub-toggle]').count()) === 0;
      out.c12_text = (await details().locator('[data-mt-item="video"]').innerText()).includes(LANG === 'he' ? 'ברכה' : 'A greeting');
    }
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
