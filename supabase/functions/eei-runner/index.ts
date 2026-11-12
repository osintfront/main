// supabase/functions/eei-runner/index.ts — free-text EEI (צי"ח) tagger.
//
// POST {"action":"tick"}              (pg_cron every 5 min, see eei_tick) — Haiku reads the new events of every
//                                     theatre used in the last 24 h and marks their topics (≤ 25 calls a run).
// POST {"action":"try", text, max}    (internal check) — split `text`, store its theatres, tag at most `max`
//                                     events in total (≤ 200); answers what it did and what it cost.
//
// Who may call it: pg_cron only (header x-cron-secret = intel_config.cron_secret). Deployed with
// verify_jwt = false; the check is done here.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { setUsageSink } from "../_shared/usage.ts";
import { eeiSpentToday, parseEei, tagTheatre, tick, upsertTheatres } from "../_shared/eei.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
setUsageSink(db, "eei-runner");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function safeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function cronOk(req: Request): Promise<boolean> {
  const secret = req.headers.get("x-cron-secret") ?? "";
  if (!secret) return false;
  const { data } = await db.from("intel_config").select("value").eq("key", "cron_secret").maybeSingle();
  return typeof data?.value === "string" && safeEqual(secret, data.value);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!(await cronOk(req))) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.action === "tick") return json({ ok: true, ...(await tick(db)) });
    if (body?.action === "try") {
      const before = await eeiSpentToday(db);
      const { theatres } = await parseEei(db, String(body?.text ?? ""));
      await upsertTheatres(db, theatres);
      let left = Math.max(0, Math.min(Number(body?.max) || 0, 200));
      let tagged = 0;
      let calls = 0;
      for (const t of theatres) {
        if (!t.hash || left <= 0) continue;
        const r = await tagTheatre(db, t.hash, left, 10);
        tagged += r.tagged;
        calls += r.calls;
        left -= r.tagged;
      }
      // ai_usage rows are written without waiting: give them a moment before reading the spend.
      await new Promise((r) => setTimeout(r, 1500));
      return json({ ok: true, theatres, tagged, calls, spent_usd: Math.round(((await eeiSpentToday(db)) - before) * 1e6) / 1e6 });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, 502);
  }
});
