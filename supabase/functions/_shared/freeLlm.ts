// Free LLM chain for the classifier, run on Vercel (/api/classify — the free providers' keys live there).
// Returns null when the site cannot be reached or every free provider failed → the caller uses Claude.
import { TRANSLATE_API_URL } from "./translate.ts";

const URL_ = TRANSLATE_API_URL.replace(/\/api\/translate\/?$/, "/api/classify");
const SECRET = Deno.env.get("TRANSLATE_SECRET") ?? "";

export async function freeClassify(body: { system: string; user: string; decisions: string[]; slugs: string[]; ids: string[]; only?: string[] }):
  Promise<{ data: Record<string, unknown>; provider: string; model: string; tried?: string[] } | null> {
  if (!URL_.endsWith("/api/classify") || !SECRET) return null;
  try {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { "content-type": "application/json", "x-translate-secret": SECRET },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55_000),
    });
    if (!res.ok) return null;
    const r = await res.json();
    return r?.data ? r : null;
  } catch {
    return null;
  }
}
