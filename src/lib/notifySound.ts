/**
 * Gentle notification chime, synthesised with the Web Audio API (no audio
 * files).
 *
 * Browsers only let a page play sound after the visitor has interacted with
 * it (click, tap, key press). We keep listening for such an interaction until
 * audio is actually running, resume it when the tab comes back to the front,
 * and expose whether sound is ready so the UI can ask for a click when it
 * isn't. Bursts (e.g. a barrage of alerts) produce a single chime per kind.
 */
import { bindAudioState, isSoundMuted } from '@/hooks/useSoundSetting';

type ChimeKind = 'event' | 'alert';

let ctx: AudioContext | null = null;
const MIN_GAP_MS = 2500;
/** Per kind, so a red alert is never swallowed by a regular event's chime. */
const lastPlayed: Record<ChimeKind, number> = { event: 0, alert: 0 };
const readyListeners = new Set<() => void>();

function notifyReady() {
  readyListeners.forEach((l) => l());
}

function context(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    ctx.onstatechange = notifyReady;
  } catch {
    return null;
  }
  return ctx;
}

/** True when a chime would actually be heard right now. */
export function isAudioReady(): boolean {
  return ctx?.state === 'running';
}

export function subscribeAudioReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

/**
 * Call from a user gesture. Creates/resumes the audio context and plays a
 * silent sample — iOS Safari only unlocks audio once something has played.
 */
export function unlockAudio(): void {
  const c = context();
  if (!c) return;
  if (c.state !== 'running') void c.resume().then(notifyReady, () => undefined);
  try {
    const buffer = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(c.destination);
    src.start(0);
  } catch {
    // ignore
  }
  notifyReady();
}

/**
 * Listen for the first real interaction(s) until audio is running, and
 * resume audio when the tab becomes visible again. Returns a cleanup.
 */
export function installAudioUnlock(): () => void {
  const events = ['pointerdown', 'click', 'touchend', 'keydown'] as const;
  const onGesture = () => {
    unlockAudio();
    if (isAudioReady()) events.forEach((e) => window.removeEventListener(e, onGesture, true));
  };
  events.forEach((e) => window.addEventListener(e, onGesture, true));
  const onVisible = () => {
    if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') {
      void ctx.resume().then(notifyReady, () => undefined);
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    events.forEach((e) => window.removeEventListener(e, onGesture, true));
    document.removeEventListener('visibilitychange', onVisible);
  };
}

function schedule(c: AudioContext, kind: ChimeKind) {
  // Soft two-note chime: rising for events, a lower, slightly longer pair for red alerts.
  const notes: [number, number][] = kind === 'alert' ? [[659.25, 0], [880, 0.18]] : [[880, 0], [1318.5, 0.12]];
  const start = c.currentTime + 0.03;
  for (const [freq, offset] of notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = start + offset;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'alert' ? 0.8 : 0.6));
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.85);
  }
}

export function playChime(kind: ChimeKind, opts: { force?: boolean } = {}): void {
  if (!opts.force && isSoundMuted()) return;
  const now = Date.now();
  if (!opts.force && now - lastPlayed[kind] < MIN_GAP_MS) return;
  lastPlayed[kind] = now;
  window.dispatchEvent(new CustomEvent('ofm:chime', { detail: kind }));

  const c = context();
  if (!c) return;
  if (c.state === 'running') {
    schedule(c, kind);
  } else {
    // Suspended (e.g. tab was in the background): resume, then play.
    void c.resume().then(
      () => {
        notifyReady();
        if (c.state === 'running') schedule(c, kind);
      },
      () => undefined,
    );
  }
}

bindAudioState(subscribeAudioReady, isAudioReady);
