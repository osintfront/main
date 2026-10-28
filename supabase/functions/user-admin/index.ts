// user-admin: create users, reset their password, remove them — for staff who may manage users.
// Every permission check runs in the database as the caller (RLS + profile / invitation guard
// triggers); only the auth account itself is created / changed / deleted with the service role.
//   {action:"create", email, full_name, role}  → { ok, user_id, password }  (temporary password, shown once)
//   {action:"reset_password", user_id}         → { ok, password }
//   {action:"remove", user_id}                 → { ok }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
/** Never send raw server/database errors to the browser: log them here, answer generically. */
const RAW_ERR = /relation|column|violates|constraint|syntax|function |permission denied|duplicate key|PGRST|postgres|SQL|stack|at .+\.ts:\d+|Anthropic \d|api key|token/i;
function safeBody(b: unknown, s: number): unknown {
  const e = (b as { error?: unknown } | null)?.error;
  if (typeof e !== "string" || (s < 500 && !RAW_ERR.test(e))) return b;
  console.error("error hidden from client:", e);
  return { ...(b as object), error: s >= 500 ? "internal error" : "request failed" };
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(safeBody(b, s)), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const ROLES = ["super_admin", "admin", "analyst", "viewer"];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

/** 16 characters, letters + digits (no look-alikes). */
function tempPassword(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => abc[x % abc.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const auth = req.headers.get("authorization") ?? "";
  const me = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } });
  const { data: who } = await me.auth.getUser();
  if (!who?.user) return json({ error: "Not signed in." }, 401);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");

  try {
    if (action === "create") {
      const email = String(body?.email ?? "").trim().toLowerCase();
      const fullName = String(body?.full_name ?? "").trim().slice(0, 120);
      const role = String(body?.role ?? "");
      if (!EMAIL.test(email)) return json({ error: "Invalid email address." }, 400);
      if (!ROLES.includes(role)) return json({ error: "Invalid role." }, 400);
      // The invitation insert (as the caller) checks who may create which role.
      const { data: inv, error: invErr } = await me.from("administrator_invitations")
        .insert({ email, full_name: fullName, intended_role: role }).select("id").single();
      if (invErr) return json({ error: invErr.message }, 403);
      const password = tempPassword();
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName },
      });
      if (error || !created?.user) {
        await admin.from("administrator_invitations").update({ status: "revoked" }).eq("id", inv.id);
        return json({ error: error?.message ?? "Could not create the user." }, 400);
      }
      return json({ ok: true, user_id: created.user.id, password });
    }

    const userId = String(body?.user_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "Bad user id." }, 400);
    if (userId === who.user.id) return json({ error: "Not on your own account." }, 403);

    if (action === "reset_password") {
      // Re-saving the name as the caller: the profile guard decides whether they may manage this user.
      const { data: p } = await me.from("profiles").select("full_name").eq("id", userId).maybeSingle();
      if (!p) return json({ error: "You may not manage this user." }, 403);
      const { data: ok, error: e2 } = await me.from("profiles").update({ full_name: p.full_name }).eq("id", userId).select("id").maybeSingle();
      if (e2 || !ok) return json({ error: e2?.message ?? "You may not manage this user." }, 403);
      const password = tempPassword();
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, password });
    }

    if (action === "remove") {
      // Deleting the profile as the caller runs the removal guards (last super admin, admins…).
      const { data: gone, error: e1 } = await me.from("profiles").delete().eq("id", userId).select("id").maybeSingle();
      if (e1 || !gone) return json({ error: e1?.message ?? "You may not remove this user." }, 403);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, 500);
  }
});
