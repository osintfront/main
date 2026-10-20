import { useCallback, useSyncExternalStore } from 'react';

/** Per-browser "sound on/off" preference (on by default). */
const KEY = 'ofm.sound';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
}

let muted = typeof window !== 'undefined' ? read() : false;

export function isSoundMuted(): boolean {
  return muted;
}

function setMuted(next: boolean) {
  muted = next;
  try {
    window.localStorage.setItem(KEY, next ? 'off' : 'on');
  } catch {
    // Private mode / blocked storage: the choice lasts for this page only.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSoundSetting(): { muted: boolean; toggle: () => void } {
  const value = useSyncExternalStore(subscribe, isSoundMuted, () => false);
  const toggle = useCallback(() => setMuted(!isSoundMuted()), []);
  return { muted: value, toggle };
}
