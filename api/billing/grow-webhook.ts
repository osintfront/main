/// <reference types="node" />
// Grow payment notifications (capture only).
//
// POST /api/billing/grow-webhook?token=<GROW_WEBHOOK_TOKEN>
//   Stores the notification (card-like fields removed) in billing_webhook_inbox and answers 200.
//   It never grants or changes a plan. That waits until the real payload format is known and each
//   payment can be confirmed with Grow server-to-server; then billing_apply does it.
import { env, json } from '../_lib/member.js';
import { MAX_WEBHOOK_BYTES, parseWebhookBody, stripCardFields, tokenMatches } from '../_lib/billing.js';

export async function POST(req: Request): Promise<Response> {
  const secret = env('GROW_WEBHOOK_TOKEN');
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !url || !key) return json({ error: 'not_configured' }, 503);
  if (!tokenMatches(new URL(req.url).searchParams.get('token'), secret)) return json({ error: 'forbidden' }, 403);

  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_WEBHOOK_BYTES) return json({ error: 'too_large' }, 413);
  const contentType = req.headers.get('content-type');
  const body = stripCardFields(parseWebhookBody(contentType, text));

  const res = await fetch(`${url}/rest/v1/billing_webhook_inbox`, {
    method: 'POST',
    headers: {
      apikey: key,
      ...(key.startsWith('sb_') ? {} : { authorization: `Bearer ${key}` }),
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify({ source: 'grow', content_type: contentType?.slice(0, 120) ?? null, body }),
  });
  // A storage failure answers 500 so Grow sends the notification again later.
  if (!res.ok) return json({ error: 'store_failed' }, 500);
  return json({ ok: true });
}
