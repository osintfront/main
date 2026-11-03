// Stage A / Task 5 check — run with Playwright browser_evaluate on any osintfront.com page.
// Expect: guest → 401 signup_required; free test user → 3× 200 then 429 quota_exceeded (enforce_plans on),
// or 4× 200 with feature_usage.count = 4 (enforce_plans off). Cached expansions count too.
async ({ eventId, email, password }) => {
  const U = 'https://kbfggmvrfevstzneqfzf.supabase.co', K = 'sb_publishable_HKjLFBdnYbxNLtdm57t5uQ_fP56nEW5';
  const fn = (tok) => fetch(U + '/functions/v1/event-agent', { method: 'POST', headers: { 'content-type': 'application/json', apikey: K, authorization: 'Bearer ' + (tok || K) }, body: JSON.stringify({ action: 'expand', id: eventId }) }).then(async (r) => r.status + ' ' + (await r.text()).slice(0, 60));
  const out = { guest: await fn(null), calls: [] };
  const t = await fetch(U + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'content-type': 'application/json', apikey: K }, body: JSON.stringify({ email, password }) }).then((r) => r.json());
  for (let i = 0; i < 4; i++) out.calls.push(await fn(t.access_token));
  return out;
};
