// AI usage log: tokens and cost of every Anthropic call → public.ai_usage (daily view ai_usage_daily).
// Costs only a database insert; never throws.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

/** USD per million tokens [input, output]. Cache reads cost 10% of input, cache writes 125%. */
const PRICES: Record<string, [number, number]> = {
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-4-5": [3, 15],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-haiku-4-5": [1, 5],
  "claude-opus-5-5": [5, 25],
};
const WEB_SEARCH_USD = 0.01;

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
}

export function costUsd(model: string, u: Usage): number {
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  const [pin, pout] = key ? PRICES[key] : [3, 15];
  const m = 1e6;
  return (
    ((u.input_tokens ?? 0) * pin) / m +
    ((u.output_tokens ?? 0) * pout) / m +
    ((u.cache_read_input_tokens ?? 0) * pin * 0.1) / m +
    ((u.cache_creation_input_tokens ?? 0) * pin * 1.25) / m +
    (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD
  );
}

let sink: { db: SupabaseClient; fn: string } | null = null;

/** Call once per function: where usage rows go and which function they belong to. */
export function setUsageSink(db: SupabaseClient, fn: string) {
  sink = { db, fn };
}

export function logUsage(purpose: string, model: string, usage: Usage | undefined, eventId?: string | null) {
  if (!sink || !usage) return;
  const row = {
    fn: sink.fn,
    purpose,
    model,
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read: usage.cache_read_input_tokens ?? 0,
    cache_write: usage.cache_creation_input_tokens ?? 0,
    web_searches: usage.server_tool_use?.web_search_requests ?? 0,
    cost_usd: Math.round(costUsd(model, usage) * 1e6) / 1e6,
    event_id: eventId ?? null,
  };
  // Fire and forget: logging must never slow down or break the pipeline.
  void sink.db.from("ai_usage").insert(row).then(({ error }) => {
    if (error) console.warn("ai_usage insert failed", error.message);
  });
}
