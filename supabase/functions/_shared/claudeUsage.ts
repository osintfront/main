// Claude API usage and cost for the whole Anthropic organization (Admin API).
// Needs the secret ANTHROPIC_ADMIN_KEY (sk-ant-admin…). Staff only; cached 10 minutes.
const ADMIN_KEY = Deno.env.get("ANTHROPIC_ADMIN_KEY") ?? "";
const BASE = "https://api.anthropic.com/v1/organizations";
const HEADERS = { "x-api-key": ADMIN_KEY, "anthropic-version": "2023-06-01", "User-Agent": "Osintfront/1.0 (https://osintfront.com)" };

export interface ClaudeDay {
  day: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  webSearches: number;
  costUsd: number;
  models: Record<string, { input: number; output: number; costUsd: number }>;
}

let cache: { at: number; days: ClaudeDay[] } | null = null;

async function getAll(path: string, params: Record<string, string | string[]>) {
  const out: any[] = [];
  let page: string | null = null;
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : [v]) q.append(k, x);
    if (page) q.set("page", page);
    const res = await fetch(`${BASE}/${path}?${q}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    out.push(...(body.data ?? []));
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return out;
}

export async function claudeUsage(days = 30): Promise<{ configured: boolean; days: ClaudeDay[] }> {
  if (!ADMIN_KEY) return { configured: false, days: [] };
  if (cache && Date.now() - cache.at < 600_000) return { configured: true, days: cache.days };
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end.getTime() - Math.min(days, 31) * 86400_000);
  const range = { starting_at: start.toISOString().replace(/\.\d+Z$/, "Z"), ending_at: end.toISOString().replace(/\.\d+Z$/, "Z"), bucket_width: "1d", limit: "31" };
  const [usage, cost] = await Promise.all([
    getAll("usage_report/messages", { ...range, "group_by[]": ["model"] }),
    getAll("cost_report", { ...range, "group_by[]": ["description"] }),
  ]);
  const byDay = new Map<string, ClaudeDay>();
  const dayOf = (b: any) => {
    const d = String(b.starting_at).slice(0, 10);
    let x = byDay.get(d);
    if (!x) byDay.set(d, (x = { day: d, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, webSearches: 0, costUsd: 0, models: {} }));
    return x;
  };
  const model = (x: ClaudeDay, m: string) => (x.models[m] ??= { input: 0, output: 0, costUsd: 0 });
  for (const b of usage) {
    const x = dayOf(b);
    for (const r of b.results ?? []) {
      const cw = Number(r.cache_creation?.ephemeral_5m_input_tokens ?? 0) + Number(r.cache_creation?.ephemeral_1h_input_tokens ?? 0);
      const inp = Number(r.uncached_input_tokens ?? 0);
      x.input += inp;
      x.cacheRead += Number(r.cache_read_input_tokens ?? 0);
      x.cacheWrite += cw;
      x.output += Number(r.output_tokens ?? 0);
      x.webSearches += Number(r.server_tool_use?.web_search_requests ?? 0);
      const m = model(x, String(r.model ?? "other"));
      m.input += inp + Number(r.cache_read_input_tokens ?? 0) + cw;
      m.output += Number(r.output_tokens ?? 0);
    }
  }
  for (const b of cost) {
    const x = dayOf(b);
    for (const r of b.results ?? []) {
      const usd = Number(r.amount ?? 0) / 100; // amounts are in cents
      x.costUsd += usd;
      if (r.model) model(x, String(r.model)).costUsd += usd;
    }
  }
  const out = [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  cache = { at: Date.now(), days: out };
  return { configured: true, days: out };
}
