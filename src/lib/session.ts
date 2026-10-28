import { supabase } from '@/integrations/supabase/client';

/**
 * One active session per user (super admins exempt — decided on the server): after sign-in this
 * device registers its session and the server ends the user's other sessions. Every minute (and
 * when the tab comes back) the device asks whether it is still the active one.
 */
const KICKED_KEY = 'ofm.kicked';

function device(): { type: string; browser: string } {
  const ua = navigator.userAgent;
  const type = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|iPhone|Android/i.test(ua) ? 'phone' : 'desktop';
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return { type, browser: os ? `${browser} · ${os}` : browser };
}

export async function registerSession() {
  if (!supabase) return;
  const d = device();
  await supabase.rpc('register_session', { p_device: d.type, p_browser: d.browser });
}

export function wasKickedOut(): boolean {
  try {
    const v = sessionStorage.getItem(KICKED_KEY) === '1';
    sessionStorage.removeItem(KICKED_KEY);
    return v;
  } catch {
    return false;
  }
}

let timer: number | undefined;
/** Start watching this device's session (call when signed in). Returns a stop function. */
export function watchSession(onKicked: () => void): () => void {
  if (!supabase) return () => {};
  const check = async () => {
    if (document.visibilityState !== 'visible') return;
    const { data, error } = await supabase!.rpc('session_active');
    if (!error && data === false) {
      try { sessionStorage.setItem(KICKED_KEY, '1'); } catch { /* ignore */ }
      onKicked();
    }
  };
  timer = window.setInterval(check, 60_000);
  document.addEventListener('visibilitychange', check);
  void check();
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', check);
  };
}
