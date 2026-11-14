import { useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PushFilters } from '@/lib/eventFilters';
import { playChime } from '@/lib/notifySound';

/**
 * Push notifications (sound + alert) for new events by the site's filters — also when the site
 * is closed or installed as an app. The browser's subscription is saved with the visitor's current
 * filters and muted event types (push_subscriptions); /api/push sends to it.
 */
export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on' | 'busy';

const listeners = new Set<() => void>();
let state: PushState = 'off';
const set = (s: PushState) => { state = s; listeners.forEach((l) => l()); };

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function b64ToBytes(b64: string): Uint8Array {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/** Phone notifications only: lowest severity this device gets (does not change the website). */
export type MinSeverity = 'low' | 'medium' | 'high' | 'critical';

export async function getMinSeverity(): Promise<MinSeverity> {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub || !supabase) return 'high';
  const { data } = await supabase.from('push_subscriptions').select('min_severity').eq('endpoint', sub.endpoint).maybeSingle();
  return (data?.min_severity as MinSeverity) ?? 'high';
}

export async function setMinSeverity(min: MinSeverity): Promise<boolean> {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub || !supabase) return false;
  const { data, error } = await supabase.rpc('push_set_min_severity', { p_endpoint: sub.endpoint, p_min: min });
  return !error && data === true;
}

let listening = false;
/** App open on screen: a push plays the website's own chime (same rules as the site: mute, gap). */
function listen() {
  if (listening) return;
  listening = true;
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'push' && document.visibilityState === 'visible') playChime('event');
  });
}

/** On page load: register the worker and find out whether this browser is subscribed. */
export async function initPush() {
  if (!supported()) return set(isIos() && !standalone() ? 'needs-install' : 'unsupported');
  try {
    const reg = await registration();
    listen();
    if (Notification.permission === 'denied') return set('denied');
    const on = !!(await reg.pushManager.getSubscription());
    set(on ? 'on' : 'off');
    // The page already told us its filters before we knew push was on: save them now.
    if (on && hasLast) syncPush(last.filters, last.muted, last.lang);
  } catch {
    set('unsupported');
  }
}

let hasLast = false;
let last: { filters: PushFilters; muted: string[]; lang: string } = { filters: null, muted: [], lang: 'he' };

async function save(sub: PushSubscription) {
  const j = sub.toJSON();
  if (!supabase || !j.endpoint || !j.keys) return;
  const { error } = await supabase.rpc('push_subscribe', {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth,
    p_filters: last.filters, p_muted: last.muted, p_lang: last.lang,
  });
  if (error) throw error;
}

/** Turn on (asks the browser's permission). Must be called from a click. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) { set(isIos() && !standalone() ? 'needs-install' : 'unsupported'); return state; }
  set('busy');
  try {
    if ((await Notification.requestPermission()) !== 'granted') { set('denied'); return state; }
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const { publicKey } = await (await fetch('/api/push')).json();
    const sub = (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) as BufferSource }));
    await save(sub);
    set('on');
  } catch (e) {
    console.warn('push enable failed', e);
    set('off');
  }
  return state;
}

export async function disablePush() {
  set('busy');
  try {
    const sub = await (await registration()).pushManager.getSubscription();
    if (sub) {
      await supabase?.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } finally {
    set('off');
  }
}

let timer: number | undefined;
/** Keep the saved filters in step with the site (debounced). null → every event; { sets } → any set. */
export function syncPush(filters: PushFilters, muted: string[], lang: string) {
  last = { filters, muted, lang };
  hasLast = true;
  if (state !== 'on') return;
  window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    try {
      const sub = await (await registration()).pushManager.getSubscription();
      if (sub) await save(sub);
    } catch (e) {
      console.warn('push sync failed', e);
    }
  }, 1500);
}

export function usePushState(): PushState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state, () => 'off');
}
