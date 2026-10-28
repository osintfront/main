import { useSyncExternalStore } from 'react';

/** "Install the app": Chrome / Edge give a prompt event; iOS needs manual steps. */
interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for our own button
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; emit(); });
  // Installability needs a registered service worker on every page, not only the map.
  if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}

export type InstallMode = 'installed' | 'prompt' | 'ios' | 'unsupported';

export function installMode(): InstallMode {
  if (installed || window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone) return 'installed';
  if (deferred) return 'prompt';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios ? 'ios' : 'unsupported';
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  emit();
  return outcome === 'accepted';
}

export function useInstallMode(): InstallMode {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), installMode, () => 'unsupported');
}
