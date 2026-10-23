import { useSyncExternalStore } from 'react';

/**
 * Per-browser sound preferences:
 *  - a master on/off switch (on by default), and
 *  - categories the visitor chose not to hear (all are heard by default).
 * Stored in localStorage; if storage is blocked the choice lasts for the page.
 */
const KEY_MASTER = 'ofm.sound';
const KEY_CATEGORIES = 'ofm.sound.mutedCategories';
const KEY_SCOPE = 'ofm.sound.scope';

/** With a filter on: sound only for what the filter shows, or for everything. */
export type SoundScope = 'filtered' | 'all';

interface SoundState {
  muted: boolean;
  mutedCategories: ReadonlySet<string>;
  scope: SoundScope;
}

const listeners = new Set<() => void>();

function load(): SoundState {
  let muted = false;
  let cats: string[] = [];
  let scope: SoundScope = 'filtered';
  try {
    if (window.localStorage.getItem(KEY_SCOPE) === 'all') scope = 'all';
    muted = window.localStorage.getItem(KEY_MASTER) === 'off';
    const raw = JSON.parse(window.localStorage.getItem(KEY_CATEGORIES) ?? '[]');
    if (Array.isArray(raw)) cats = raw.filter((x): x is string => typeof x === 'string').slice(0, 100);
  } catch {
    // ignore unreadable storage
  }
  return { muted, mutedCategories: new Set(cats), scope };
}

let state: SoundState = typeof window !== 'undefined' ? load() : { muted: false, mutedCategories: new Set(), scope: 'filtered' };

function commit(next: SoundState) {
  state = next;
  try {
    window.localStorage.setItem(KEY_MASTER, next.muted ? 'off' : 'on');
    window.localStorage.setItem(KEY_CATEGORIES, JSON.stringify([...next.mutedCategories]));
    window.localStorage.setItem(KEY_SCOPE, next.scope);
  } catch {
    // Private mode / blocked storage
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => state;

export function isSoundMuted(): boolean {
  return state.muted;
}

/** Should an event of this category make a sound? (master switch + per-category choice) */
export function isCategoryAudible(slug: string): boolean {
  return !state.muted && !state.mutedCategories.has(slug);
}

export function soundScope(): SoundScope {
  return state.scope;
}

export function setSoundScope(scope: SoundScope) {
  commit({ ...state, scope });
}

export function setSoundMuted(muted: boolean) {
  commit({ ...state, muted });
}

export function setCategoryAudible(slug: string, audible: boolean) {
  const next = new Set(state.mutedCategories);
  if (audible) next.delete(slug);
  else next.add(slug);
  commit({ ...state, mutedCategories: next });
}

export function setAllCategoriesAudible(slugs: readonly string[], audible: boolean) {
  commit({ ...state, mutedCategories: audible ? new Set() : new Set(slugs) });
}

export function useSoundSetting(): SoundState & { toggle: () => void } {
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { ...value, toggle: () => setSoundMuted(!state.muted) };
}

/** Whether the browser currently allows the chime to be heard. */
export function useAudioReady(): boolean {
  return useSyncExternalStore(audioSubscribe, audioSnapshot, () => false);
}
let audioSubscribe: (l: () => void) => () => void = () => () => undefined;
let audioSnapshot: () => boolean = () => false;
/** Wired up by src/lib/notifySound.ts (avoids a circular import). */
export function bindAudioState(sub: typeof audioSubscribe, snap: typeof audioSnapshot) {
  audioSubscribe = sub;
  audioSnapshot = snap;
}
