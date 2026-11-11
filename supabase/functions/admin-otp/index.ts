// admin-otp: sends the login code of the email 2FA (accounts in public.two_factor_users).
// Called with the password session. The code is requested here, on the server, so the answer of
// the mail service can be trusted: when the email quota is used up (hourly limit or the daily
// Resend quota), this very session is let in without a code — the browser cannot fake that.
//   POST {} → { sent: true } | { bypass: true } | { error: "cooldown", seconds } | { error }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function claims(token: string): Record<string, unknown> {
  try {
    const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "=".repeat((4 - (p.length % 4)) % 4)));
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  // getUser checks the token with the auth server (signature, expiry, session not ended).
  const { data: u, error: ue } = await admin.auth.getUser(token);
  if (ue || !u?.user?.email) return json({ error: "not signed in" }, 401);
  const sid = String(claims(token).session_id ?? "");
  if (!sid) return json({ error: "not signed in" }, 401);

  // As the caller: must be on the 2FA list and on a password (not code) session.
  const asUser = createClient(URL_, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { error: be } = await asUser.rpc("otp_begin");
  if (be) return json({ error: "not allowed" }, 403);

  const res = await fetch(`${URL_}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: u.user.email, create_user: false }),
  });
  if (res.ok) return json({ sent: true });

  const body = await res.json().catch(() => ({})) as { msg?: string; message?: string; error_description?: string; error_code?: string };
  const msg = String(body.msg ?? body.message ?? body.error_description ?? "");
  console.log("otp send failed", res.status, body.error_code, msg);

  const wait = msg.match(/after (\d+) seconds/i);
  if (wait) return json({ error: "cooldown", seconds: Number(wait[1]) });

  // Quota used up: Supabase's hourly email limit, or the mail provider refusing (daily quota).
  const quota = (res.status === 429 && /email rate limit/i.test(msg)) || (res.status >= 500 && /sending|smtp|email/i.test(msg));
  if (!quota) return json({ error: "send failed" }, 502);

  const { error: ie } = await admin.from("otp_verified").upsert({ session_id: sid, user_id: u.user.id, via: "mail_quota" });
  if (ie) { console.error(ie.message); return json({ error: "send failed" }, 502); }
  await admin.from("otp_pending").delete().eq("session_id", sid);
  return json({ bypass: true });
});
