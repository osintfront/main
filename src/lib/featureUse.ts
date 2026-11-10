import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Daily uses counted in the database (migration 20261104000077): every "expand" click and every
 * satellite turn-on. The server decides; the site only asks and shows what is left.
 * Today's usage is loaded once and shared by every card (not one request per card).
 */
export type UseReason = null | 'signup_required' | 'not_in_plan' | 'quota_exceeded' | 'error';
export interface UseResult { ok: boolean; reason: UseReason; used: number; limit: number | null; remaining: number | null }
export type CountedFeature = 'expand_daily' | 'satellite' | 'event_open' | 'share_daily';
type Usage = Partial<Record<CountedFeature, { used: number; limit: number | null }>>;

const EMPTY: Usage = Object.freeze({});
let usage: Usage = EMPTY;
let loadedFor: string | null | undefined; // user id the usage belongs to (undefined = never loaded)
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Usage) {
  if (JSON.stringify(next) === JSON.stringify(usage)) return; // only real changes re-render
  usage = Object.keys(next).length ? next : EMPTY;
  listeners.forEach((l) => l());
}

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Today's uses for the signed-in user (empty for guests). force = after a spend or sign-in. */
export function refreshFeatureUsage(force = false): Promise<void> {
  if (inFlight && !force) return inFlight;
  inFlight = (async () => {
    const uid = await currentUserId();
    if (!force && uid === loadedFor) return;
    loadedFor = uid;
    if (!uid || !supabase) return set(EMPTY);
    const { data, error } = await supabase.rpc('my_feature_usage');
    if (!error && data) set(data as Usage);
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

if (supabase) supabase.auth.onAuthStateChange(() => void refreshFeatureUsage());

/** Spend one use of a counted feature. Guests get signup_required without a request. */
export async function spendFeature(key: CountedFeature): Promise<UseResult> {
  const refused = (reason: UseReason): UseResult => ({ ok: false, reason, used: 0, limit: null, remaining: null });
  if (!supabase || !(await currentUserId())) return refused('signup_required');
  const { data, error } = await supabase.rpc('use_feature', { p_key: key });
  if (error || !data) return refused('error');
  const r = data as UseResult;
  set({ ...usage, [key]: { used: r.used, limit: r.limit } });
  return r;
}

/** Live view of today's uses (loaded once for the whole page). */
export function useFeatureUsage(): Usage {
  useEffect(() => void refreshFeatureUsage(), []);
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => usage, () => EMPTY);
}

// ── Event windows per day (plan_features 'event_open') ───────────────────────────
// Signed-in viewers: counted by the server (use_feature). Guests: counted in this browser.
// An event already opened today opens again for free.
const OPENED_KEY = 'ofm.opened';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
function openedToday(): { day: string; ids: string[] } {
  try {
    const v = JSON.parse(localStorage.getItem(OPENED_KEY) ?? 'null');
    if (v && v.day === today() && Array.isArray(v.ids)) return v;
  } catch { /* storage blocked */ }
  return { day: today(), ids: [] };
}
function remember(id: string) {
  const v = openedToday();
  if (v.ids.includes(id)) return;
  v.ids = [...v.ids, id].slice(-500);
  try { localStorage.setItem(OPENED_KEY, JSON.stringify(v)); } catch { /* storage blocked */ }
}

/**
 * May this event's window open? limit = the plan's daily limit (null = unlimited).
 * Returns null when allowed, else the refusal reason for openGateFor.
 */
export async function openEventAllowed(id: string, limit: number | null, signedIn: boolean): Promise<UseReason> {
  if (limit == null) return null;
  const v = openedToday();
  if (v.ids.includes(id)) return null;
  if (!signedIn) {
    if (v.ids.length >= limit) return 'signup_required';
    remember(id);
    return null;
  }
  const r = await spendFeature('event_open');
  if (r.ok) { remember(id); return null; }
  return r.reason === 'error' ? null : r.reason; // a network error never blocks reading
}
