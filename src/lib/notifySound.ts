/**
 * Gentle notification chime, synthesised with the Web Audio API (no audio
 * files). Browsers only allow sound after the visitor has interacted with the
 * page, so the audio context is unlocked on the first click / key press.
 * Bursts (e.g. a barrage of alerts) produce a single chime.
 */
import { isSoundMuted } from '@/hooks/useSoundSetting';

type ChimeKind = 'event' | 'alert';

let ctx: AudioContext | null = null;
/** Per kind, so a red alert is never swallowed by a regular event's chime. */
const lastPlayed: Record<ChimeKind, number> = { event: 0, alert: 0 };
const MIN_GAP_MS = 2500;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

/** Call from a user gesture so later chimes are allowed to play. */
export function unlockAudio(): void {
  const c = context();
  if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
}

/** Soft two-note chime: rising for events, a lower, slightly longer pair for red alerts. */
export function playChime(kind: ChimeKind, opts: { force?: boolean } = {}): void {
  if (!opts.force && isSoundMuted()) return;
  const now = Date.now();
  if (!opts.force && now - lastPlayed[kind] < MIN_GAP_MS) return;
  lastPlayed[kind] = now;
  window.dispatchEvent(new CustomEvent('ofm:chime', { detail: kind }));

  const c = context();
  if (!c || c.state !== 'running') return;
  const notes: [number, number][] = kind === 'alert' ? [[659.25, 0], [880, 0.18]] : [[880, 0], [1318.5, 0.12]];
  const start = c.currentTime + 0.02;
  for (const [freq, offset] of notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = start + offset;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.11, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'alert' ? 0.75 : 0.55));
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.8);
  }
}
