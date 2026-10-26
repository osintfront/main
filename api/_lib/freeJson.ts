/// <reference types="node" />
// Free LLM chain for JSON tasks (classification): Groq → Gemini → Cloudflare → Ollama → OpenRouter free.
// A provider without its key is skipped silently; a rate-limited one rests for a minute.
// Runs on Vercel (keys live there); called by Supabase through /api/classify.
// The caller validates the JSON and falls back to Claude when every provider fails.
const env = (k: string) => (process.env[k] ?? "").trim();

type Provider = { name: string; ready: () => boolean; url: () => string; key: () => string; model: () => string; json: boolean; extra?: Record<string, unknown> };

const PROVIDERS: Provider[] = [
  { name: "groq", ready: () => !!env("GROQ_API_KEY"), url: () => "https://api.groq.com/openai/v1/chat/completions", key: () => env("GROQ_API_KEY"), model: () => env("GROQ_CLASSIFY_MODEL") || "openai/gpt-oss-120b", json: true, extra: { reasoning_effort: "low" } },
  { name: "gemini", ready: () => !!env("GEMINI_API_KEY"), url: () => "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: () => env("GEMINI_API_KEY"), model: () => env("GEMINI_MODEL") || "gemini-3.5-flash-lite", json: true },
  { name: "cloudflare", ready: () => !!env("CLOUDFLARE_API_TOKEN") && !!env("CLOUDFLARE_ACCOUNT_ID"), url: () => `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env("CLOUDFLARE_ACCOUNT_ID"))}/ai/v1/chat/completions`, key: () => env("CLOUDFLARE_API_TOKEN"), model: () => env("CLOUDFLARE_MODEL") || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", json: false },
  { name: "ollama", ready: () => !!env("OLLAMA_API_KEY"), url: () => "https://ollama.com/v1/chat/completions", key: () => env("OLLAMA_API_KEY"), model: () => env("OLLAMA_MODEL") || "gemma4:31b", json: false },
  { name: "openrouter", ready: () => !!env("OPENROUTER_API_KEY"), url: () => "https://openrouter.ai/api/v1/chat/completions", key: () => env("OPENROUTER_API_KEY"), model: () => "openrouter/free", json: true },
];

const resting = new Map<string, number>();
/** What the last call tried (diagnostics). */
export let lastTried: string[] = [];

/** Which providers have keys here (names only — never the keys). */
export const freeProvidersReady = () => PROVIDERS.filter((p) => p.ready()).map((p) => p.name);

function parseJson(s: string): Record<string, unknown> | null {
  const t = s.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { const o = JSON.parse(t.slice(a, b + 1)); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
}

/**
 * First provider whose answer parses and passes `valid` wins. Returns null when all fail.
 * `only` limits the chain (tests).
 */
export async function freeJson(
  system: string,
  user: string,
  valid: (o: Record<string, unknown>) => boolean,
  opts: { maxTokens?: number; timeoutMs?: number; only?: string[] } = {},
): Promise<{ data: Record<string, unknown>; provider: string; model: string; tried: string[] } | null> {
  const tried: string[] = [];
  lastTried = tried;
  for (const p of PROVIDERS) {
    if (!p.ready() || (opts.only && !opts.only.includes(p.name))) continue;
    if ((resting.get(p.name) ?? 0) > Date.now()) { tried.push(`${p.name}:resting`); continue; }
    const model = p.model();
    try {
      const res = await fetch(p.url(), {
        method: "POST",
        headers: { authorization: `Bearer ${p.key()}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: opts.maxTokens ?? 800,
          ...(p.json ? { response_format: { type: "json_object" } } : {}),
          ...(p.extra ?? {}),
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
      if (res.status === 429 || res.status === 402 || res.status === 503) {
        resting.set(p.name, Date.now() + 60_000);
        tried.push(`${p.name}:${res.status}`);
        continue;
      }
      if (!res.ok) { tried.push(`${p.name}:${res.status}`); continue; }
      const out = await res.json();
      const data = parseJson(String(out?.choices?.[0]?.message?.content ?? ""));
      if (!data || !valid(data)) { tried.push(`${p.name}:bad`); continue; }
      return { data, provider: p.name, model, tried };
    } catch (e) {
      tried.push(`${p.name}:${(e as Error)?.name === "TimeoutError" ? "timeout" : "error"}`);
    }
  }
  return null;
}
