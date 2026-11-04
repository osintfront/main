// notify-signup: emails the owner whenever a profile first becomes 'active' (self sign-up
// after email confirm, Google sign-in, or an accepted invitation). Called by the DB trigger
// public.notify_signup() (pg_net), never by the browser.
//
// Auth: header x-notify-secret must equal public.intel_config.notify_secret.
// Body: { full_name, email, role, plan, created_at, total_users }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const TO = "osintfront@gmail.com";
const FROM = "Osintfront <onboarding@resend.dev>";

let secret: string | null = null;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (secret === null) {
    const { data } = await db.from("intel_config").select("value").eq("key", "notify_secret").maybeSingle();
    secret = data?.value ?? "";
  }
  const given = req.headers.get("x-notify-secret") ?? "";
  if (!secret || given.length !== secret.length || given !== secret) return new Response("unauthorized", { status: 401 });
  if (!RESEND_API_KEY) return new Response("no RESEND_API_KEY", { status: 500 });

  const body = await req.json().catch(() => null);
  if (!body) return new Response("bad json", { status: 400 });

  const name = String(body.full_name ?? "").trim() || "(ללא שם)";
  const email = String(body.email ?? "");
  const role = String(body.role ?? "");
  const plan = String(body.plan ?? "");
  const createdAt = String(body.created_at ?? "");
  const total = body.total_users ?? "?";

  const subject = `משתמש ${name} נרשם לאתר!`;
  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">
      <p>נרשם משתמש חדש ל-Osintfront:</p>
      <ul>
        <li><b>שם:</b> ${escapeHtml(name)}</li>
        <li><b>אימייל:</b> ${escapeHtml(email)}</li>
        <li><b>תפקיד:</b> ${escapeHtml(role)}</li>
        <li><b>חבילה:</b> ${escapeHtml(plan)}</li>
        <li><b>תאריך הרשמה:</b> ${escapeHtml(createdAt)}</li>
      </ul>
      <p>סך כל המשתמשים הרשומים במערכת כעת: <b>${escapeHtml(String(total))}</b></p>
    </div>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [TO], subject, html }),
  });
  if (!r.ok) return new Response(await r.text(), { status: 502 });
  return new Response("ok");
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
