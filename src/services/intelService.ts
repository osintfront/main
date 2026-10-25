import { supabase } from '@/integrations/supabase/client';
import { ServiceError, toServiceError } from './serviceError';

/** News agents (per-country crawlers) and their source list — staff only. */

export const INTEL_AGENTS = ['lebanon', 'yemen', 'syria', 'iran', 'international', 'research'] as const;
export type IntelAgentId = (typeof INTEL_AGENTS)[number];

export interface IntelAgent {
  agent: IntelAgentId;
  labelHe: string;
  sortOrder: number;
  lastRunAt: string | null;
  lastResult: {
    sources?: number;
    new_items?: number;
    baseline?: number;
    selected?: number;
    published?: number;
    duplicates?: number;
    irrelevant?: number;
    errors?: string[];
    finished_at?: string;
    fatal?: string;
  };
}

export interface IntelSource {
  id: string;
  agent: IntelAgentId;
  url: string;
  name: string;
  feedUrl: string | null;
  active: boolean;
  baselineDone: boolean;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  itemsFound: number;
  eventsCreated: number;
}

export interface IntelItem {
  id: number;
  agent: string | null;
  url: string;
  title: string;
  status: string;
  eventId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface CrawlerSettings {
  enabled: boolean;
  raw: Record<string, unknown>;
}

function client() {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  return supabase;
}

export async function fetchIntelAgents(): Promise<IntelAgent[]> {
  const { data, error } = await client()
    .from('intel_agents')
    .select('agent,label_he,sort_order,last_run_at,last_result')
    .order('sort_order', { ascending: true });
  if (error) throw toServiceError(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    agent: r.agent as IntelAgentId,
    labelHe: String(r.label_he ?? ''),
    sortOrder: Number(r.sort_order ?? 0),
    lastRunAt: (r.last_run_at as string | null) ?? null,
    lastResult: (r.last_result ?? {}) as IntelAgent['lastResult'],
  }));
}

export async function fetchIntelSources(): Promise<IntelSource[]> {
  const { data, error } = await client()
    .from('intel_sources')
    .select('id,agent,url,name,feed_url,active,baseline_done,last_run_at,last_ok_at,last_error,consecutive_failures,items_found,events_created')
    .order('name', { ascending: true });
  if (error) throw toServiceError(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    agent: r.agent as IntelAgentId,
    url: String(r.url),
    name: String(r.name ?? ''),
    feedUrl: (r.feed_url as string | null) ?? null,
    active: r.active === true,
    baselineDone: r.baseline_done === true,
    lastRunAt: (r.last_run_at as string | null) ?? null,
    lastOkAt: (r.last_ok_at as string | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
    consecutiveFailures: Number(r.consecutive_failures ?? 0),
    itemsFound: Number(r.items_found ?? 0),
    eventsCreated: Number(r.events_created ?? 0),
  }));
}

/** Latest articles that reached the editor (published / duplicate / error). */
export async function fetchIntelItems(limit = 40): Promise<IntelItem[]> {
  const { data, error } = await client()
    .from('intel_items')
    .select('id,agent,url,title,status,event_id,reason,created_at')
    .in('status', ['published', 'duplicate', 'error'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw toServiceError(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    agent: (r.agent as string | null) ?? null,
    url: String(r.url),
    title: String(r.title ?? ''),
    status: String(r.status),
    eventId: (r.event_id as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    createdAt: String(r.created_at),
  }));
}

function assertChanged(data: unknown) {
  // RLS hides rows from users without settings.manage: zero rows means "not allowed".
  if (!Array.isArray(data) || data.length === 0) throw new ServiceError('permission_denied', 'Not allowed to change settings.');
}

export async function setSourceActive(id: string, active: boolean): Promise<void> {
  const { data, error } = await client().from('intel_sources').update({ active }).eq('id', id).select('id');
  if (error) throw toServiceError(error);
  assertChanged(data);
}

export async function addSource(agent: IntelAgentId, url: string, name: string): Promise<void> {
  let clean: string;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
    clean = u.toString();
  } catch {
    throw new ServiceError('validation', 'invalid url');
  }
  const { error } = await client()
    .from('intel_sources')
    .insert({ agent, url: clean, name: name.trim().slice(0, 200) || new URL(clean).hostname.replace(/^www\./, '') });
  if (error) throw toServiceError(error);
}

export async function deleteSource(id: string): Promise<void> {
  const { data, error } = await client().from('intel_sources').delete().eq('id', id).select('id');
  if (error) throw toServiceError(error);
  assertChanged(data);
}

export async function getCrawlerSettings(): Promise<CrawlerSettings> {
  const { data, error } = await client().from('app_settings').select('value').eq('key', 'intel_crawler').maybeSingle();
  if (error) throw toServiceError(error);
  const raw = ((data as { value?: unknown } | null)?.value ?? {}) as Record<string, unknown>;
  return { enabled: raw.enabled === true, raw };
}

export async function setCrawlerEnabled(current: CrawlerSettings, enabled: boolean): Promise<void> {
  const { data, error } = await client()
    .from('app_settings')
    .update({ value: { ...current.raw, enabled } })
    .eq('key', 'intel_crawler')
    .select('key');
  if (error) throw toServiceError(error);
  assertChanged(data);
}

/** Public Telegram channels read every minute (same pipeline as the WhatsApp feed). */
export interface TelegramChannel {
  username: string;
  title: string;
  active: boolean;
  baselineDone: boolean;
  lastPostId: number;
  postsSeen: number;
  lastOkAt: string | null;
  lastError: string | null;
  /** Country / area the channel mainly reports on (see CHANNEL_REGIONS). */
  region: string | null;
  /** The Telegram worker's tab it came from (null = added here). */
  folder: string | null;
  /** Pinned at the top of a Telegram tab: only those are read (worker channels). */
  pinned: boolean;
}

export async function fetchTelegramChannels(): Promise<TelegramChannel[]> {
  const { data, error } = await client()
    .from('telegram_channels')
    .select('username,title,active,baseline_done,last_post_id,posts_seen,last_ok_at,last_error,region,folder,pinned')
    .order('created_at', { ascending: true });
  if (error) throw toServiceError(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    username: String(r.username),
    title: String(r.title ?? ''),
    active: r.active === true,
    baselineDone: r.baseline_done === true,
    lastPostId: Number(r.last_post_id ?? 0),
    postsSeen: Number(r.posts_seen ?? 0),
    lastOkAt: (r.last_ok_at as string | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
    region: (r.region as string | null) ?? null,
    folder: (r.folder as string | null) ?? null,
    pinned: r.pinned === true,
  }));
}

/** "https://t.me/name", "t.me/s/name", "@name" or "name" → "name". */
export function telegramUsername(input: string): string | null {
  const s = input.trim();
  const m =
    s.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]{4,64})\/?$/i) ?? s.match(/^@?([A-Za-z0-9_]{4,64})$/);
  return m ? m[1] : null;
}

export async function addTelegramChannel(input: string): Promise<void> {
  const username = telegramUsername(input);
  if (!username) throw new ServiceError('validation', 'invalid telegram channel');
  const { error } = await client().from('telegram_channels').insert({ username });
  if (error) throw toServiceError(error);
}

export async function setTelegramChannelActive(username: string, active: boolean): Promise<void> {
  const { data, error } = await client().from('telegram_channels').update({ active }).eq('username', username).select('username');
  if (error) throw toServiceError(error);
  assertChanged(data);
}

export async function deleteTelegramChannel(username: string): Promise<void> {
  const { data, error } = await client().from('telegram_channels').delete().eq('username', username).select('username');
  if (error) throw toServiceError(error);
  assertChanged(data);
}
