// Analyses & summaries — browser checks (Playwright) against a local build and a FAKED Supabase.
// The feed card of an analysis: Pro reads the whole text, Free the first paragraph + an
// upgrade button (opens the "not in your plan" window), a guest the headline + sign-up lock.
// (The database does the cut: analysis_gate in migration 129. Here the fake rows play its part.)
//
// Build:  VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=<any JWT> npx vite build --outDir /tmp/an-qa/dist --emptyOutDir
// Run:    AN_QA_DIST=/tmp/an-qa/dist node tests/e2e/analysis.mock.cjs <he|en> <desktop|phone> <pro|free|guest> <light|dark>
// Passes when it prints "PASS" and exits 0.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const [LANG = 'he', DEVICE = 'desktop', PLAN = 'pro', THEME = 'light'] = process.argv.slice(2);
const DIST = process.env.AN_QA_DIST || '/tmp/an-qa/dist';
const SHOTS = process.env.AN_QA_SHOTS || '/tmp';
const SB = 'https://fake.supabase.co';
const UID = '99999999-9999-4999-8999-999999999999';
const PORT = 4174 + Math.floor(Math.random() * 500);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', aud: 'authenticated', exp: now + 3600, email: 'qa@example.test' })}.sig`;
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa@example.test', email_confirmed_at: '2026-11-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' };
const session = { access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
const profile = { id: UID, full_name: 'QA', email: 'qa@example.test', role: 'viewer', status: 'active', can_publish: false, created_at: '2026-11-01T00:00:00Z', last_login_at: null, plan: PLAN === 'free' ? 'free' : 'pro', plan_source: 'admin', plan_expires_at: null, billing_period: null, must_change_password: false };

const FULL = {
  he: 'תאריך: 13/11/2026\n\nשבע המפות המצורפות מראות שחיל האוויר הישראלי ביצע סריקת מודיעין רחבה ומתואמת מעל לבנון, מהחוף ועד הבקעה, בצירי חדירה מהים ומהיבשה.\n\nכטב"מים נכנסים מהים מול ביירות, הזהראני וצור, ומשם חודרים פנימה. מעל נקודות חמות המסלולים הופכים ללולאות סגורות — מעבר מסריקה חולפת לתצפית קבועה.\n\nבבקעה המסלול עובר לאורך המדרונות המערביים של הרי האנטי-לבנון, מזחלה ועד בעלבכ.',
  en: 'Date: 13/11/2026\n\nThe seven attached maps show the Israeli Air Force carrying out a wide, coordinated intelligence sweep over Lebanon, from the coast to the Bekaa, along sea and land entry routes.\n\nDrones come in from the sea off Beirut, Zahrani and Tyre and then push inland. Over hot spots the tracks turn into closed loops — a move from passing survey to fixed surveillance.\n\nIn the Bekaa the route runs along the western slopes of the Anti-Lebanon range, from Zahle to Baalbek.',
};
const cut = (t) => t.split('\n\n').slice(0, 2).join('\n\n');
const tr = (l) => {
  const title = l === 'he' ? 'ניתוח: כטב"מים ישראליים ביצעו סריקת מודיעין רחבה מעל לבנון' : 'Analysis: Israeli drones carried out a wide intelligence sweep over Lebanon';
  if (PLAN === 'guest') return { title };
  return { title, summary: l === 'he' ? 'הערוץ מנתח את מסלולי הכטב"מים מעל לבנון' : 'The channel analyses drone routes over Lebanon', ...(PLAN === 'pro' ? { full: FULL[l] } : { full: cut(FULL[l]), full_cut: true }) };
};
const A = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', title: tr('he').title, description: PLAN === 'guest' ? null : tr('he').summary, severity: 'medium', latitude: null, longitude: null, location_name: '',
  location_name_he: null, location_name_en: null, location_precision: null, sources: [], locations: [], country: 'Lebanon', region: '', city: '',
  source_name: 'Telegram – رضوان', source_url: null, source_type: 'social_media', occurred_at: new Date(Date.now() - 3600e3).toISOString(), published_at: new Date().toISOString(),
  is_breaking: false, is_verified: false, translations: { he: tr('he'), en: tr('en') }, category_id: 'c-an', category_slug: 'analysis', category_name: 'Analyses & summaries', category_icon: 'ScrollText',
  category_color: '#475569', category_marker_color: '#475569', media_kinds: [], report_group: null, source_count: 1, updated_at: new Date().toISOString(), secondary_categories: ['military-activity'],
};
const FEATURES = ['live_map', 'feed', 'event_open', 'source_link', 'media', 'archive_days', 'feed_search', 'copy_text', 'share_daily'];
const planRows = [
  ...['guest', 'free', 'pro', 'max'].flatMap((p) => FEATURES.map((k) => ({ feature_key: k, plan_id: p, enabled: true, limit_value: null }))),
  ...['guest', 'free', 'pro', 'max'].map((p) => ({ feature_key: 'event_summary', plan_id: p, enabled: p !== 'guest', limit_value: null })),
  ...['guest', 'free', 'pro', 'max'].map((p) => ({ feature_key: 'analysis_full', plan_id: p, enabled: p === 'pro' || p === 'max', limit_value: null })),
  { feature_key: 'feed_delay_min', plan_id: 'guest', enabled: true, limit_value: 0 },
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
    if (u.pathname === '/rest/v1/event_categories') return json([{ id: 'c-an', slug: 'analysis', name: 'Analyses & summaries', description: '', icon: 'ScrollText', color: '#475569', marker_color: '#475569', is_active: true, sort_order: 900, translations: { he: 'ניתוחים וסיכומים' } }]);
    if (u.pathname === '/rest/v1/published_events') return json([A]);
    if (u.pathname.startsWith('/rest/v1/rpc/')) return json(null);
    if (u.pathname.startsWith('/rest/v1/')) return single ? none() : json([]);
    return json({});
  });
}

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const phone = DEVICE === 'phone';
  const out = { lang: LANG, device: DEVICE, plan: PLAN, theme: THEME };
  try {
    const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone });
    await ctx.addInitScript(([s, lang, theme, signedIn]) => {
      if (sessionStorage.getItem('qa-seeded')) return;
      sessionStorage.setItem('qa-seeded', '1');
      if (signedIn) localStorage.setItem('ofm.auth', JSON.stringify(s));
      localStorage.setItem('ofm.lang', lang);
      localStorage.setItem('ofm.theme', theme);
    }, [session, LANG, THEME, PLAN !== 'guest']);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { if (!/Unexpected token '<'/.test(String(e))) errors.push(`pageerror: ${String(e).slice(0, 300)}`); });
    await routeAll(page);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const consent = page.getByRole('button', { name: /^(Reject non-essential|דחיית עוגיות לא-הכרחיות)$/ });
    if (await consent.count()) await consent.first().click().catch(() => {});
    if (phone) {
      const b = page.getByRole('button', { name: LANG === 'he' ? /^(עדכונים|פיד|רשימה)/ : /^(Feed|List|Updates)/ }).first();
      if (await b.count()) await b.click().catch(() => {});
    }
    const card = page.locator(`#event-card-${A.id}`);
    await card.waitFor({ timeout: 8000 });
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const text = await card.innerText();
    const lastPara = LANG === 'he' ? 'בעלבכ' : 'Baalbek';
    const firstPara = LANG === 'he' ? 'סריקת מודיעין רחבה ומתואמת' : 'wide, coordinated intelligence sweep';
    const lockLabel = LANG === 'he' ? 'המשך הניתוח ב-Pro' : 'Read the rest of the analysis with Pro';
    if (PLAN === 'pro') {
      out.full = (await card.locator('[data-analysis="full"]').count()) === 1 && text.includes(lastPara);
      out.noLock = !text.includes(lockLabel);
    } else if (PLAN === 'free') {
      out.cut = (await card.locator('[data-analysis="cut"]').count()) === 1 && text.includes(firstPara) && !text.includes(lastPara);
      const btn = card.getByRole('button', { name: lockLabel });
      const box = await btn.boundingBox();
      out.tap = !!box && box.height >= 32;
      await page.screenshot({ path: `${SHOTS}/an-${LANG}-${DEVICE}-${PLAN}-${THEME}.png` });
      await btn.click();
      await page.waitForTimeout(400);
      out.gate = (await page.locator('[data-gate="upgrade"]').count()) === 1;
      await page.screenshot({ path: `${SHOTS}/an-${LANG}-${DEVICE}-${PLAN}-${THEME}-gate.png` });
    } else {
      out.noAnalysis = (await card.locator('[data-analysis]').count()) === 0 && !text.includes(firstPara);
      out.headline = text.includes(LANG === 'he' ? 'סריקת מודיעין רחבה מעל לבנון' : 'wide intelligence sweep over Lebanon');
    }
    out.category = text.includes(LANG === 'he' ? 'ניתוחים וסיכומים' : 'Analyses & summaries');
    if (PLAN !== 'free') await page.screenshot({ path: `${SHOTS}/an-${LANG}-${DEVICE}-${PLAN}-${THEME}.png` });
    out.errors = errors;
    const ok = Object.entries(out).every(([k, v]) => (k === 'errors' ? v.length === 0 : v !== false));
    console.log(JSON.stringify(out));
    console.log(ok ? 'PASS' : 'FAIL');
    process.exitCode = ok ? 0 : 1;
    await ctx.close();
  } catch (e) {
    console.log(JSON.stringify(out), String(e).slice(0, 400));
    console.log('FAIL');
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
