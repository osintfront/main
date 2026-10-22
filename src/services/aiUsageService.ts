import { supabase } from '@/integrations/supabase/client';
import { toServiceError } from './serviceError';

/** Tokens and cost of the site's AI calls, per day (view ai_usage_daily, Israel time). */
export interface AiUsageRow {
  day: string;
  fn: string;
  purpose: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  webSearches: number;
  costUsd: number;
}

export async function fetchAiUsage(days = 30): Promise<AiUsageRow[]> {
  if (!supabase) return [];
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('ai_usage_daily')
    .select('day,fn,purpose,model,calls,input_tokens,output_tokens,cache_read,cache_write,web_searches,cost_usd')
    .gte('day', since)
    .order('day', { ascending: false })
    .limit(2000);
  if (error) throw toServiceError(error);
  return (data ?? []).map((r) => ({
    day: String(r.day),
    fn: String(r.fn),
    purpose: String(r.purpose),
    model: String(r.model),
    calls: Number(r.calls) || 0,
    inputTokens: Number(r.input_tokens) || 0,
    outputTokens: Number(r.output_tokens) || 0,
    cacheRead: Number(r.cache_read) || 0,
    cacheWrite: Number(r.cache_write) || 0,
    webSearches: Number(r.web_searches) || 0,
    costUsd: Number(r.cost_usd) || 0,
  }));
}

/** The whole Claude API organization, per day (Anthropic Admin API, via event-agent). */
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

export async function fetchClaudeUsage(): Promise<{ configured: boolean; days: ClaudeDay[]; error?: string }> {
  if (!supabase) return { configured: false, days: [] };
  const { data, error } = await supabase.functions.invoke('event-agent', { body: { action: 'claude_usage' } });
  if (error) return { configured: true, days: [], error: String(error.message ?? error) };
  return { configured: !!data?.configured, days: Array.isArray(data?.days) ? data.days : [], error: data?.error };
}
