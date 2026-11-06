// Sun and moon for the weather card, computed in the browser (no network) with suncalc.
import SunCalc from 'suncalc';

export type MoonState = 'new' | 'partial' | 'half' | 'full';

/** How much of the moon is lit, its state (project plan: no moon / partial / half / full) and whether it grows. */
export function moonPhase(at: Date): { fraction: number; state: MoonState; waxing: boolean } {
  const { fraction, phase } = SunCalc.getMoonIllumination(at);
  const state: MoonState = fraction < 0.03 ? 'new' : fraction > 0.97 ? 'full' : fraction >= 0.45 && fraction <= 0.55 ? 'half' : 'partial';
  return { fraction, state, waxing: phase < 0.5 };
}

/** Moonlight that actually reaches the ground: lit fraction × (1 − 0.9 × cloud/100); 0 when the moon is down. */
export function effectiveLight(fraction: number, cloudPct: number | null, moonUp: boolean): number | null {
  if (cloudPct === null) return null;
  if (!moonUp) return 0;
  return fraction * (1 - 0.9 * Math.min(Math.max(cloudPct, 0), 100) / 100);
}

export interface SunTimes {
  astroDawn: Date | null; nauticalDawn: Date | null; civilDawn: Date | null; sunrise: Date | null;
  sunset: Date | null; civilDusk: Date | null; nauticalDusk: Date | null; astroDusk: Date | null;
  dayLengthMin: number | null;
}

const valid = (d: Date | undefined | null): Date | null => (d instanceof Date && !Number.isNaN(d.getTime()) ? d : null);

export function sunTimes(day: Date, lat: number, lng: number): SunTimes {
  const t = SunCalc.getTimes(day, lat, lng);
  const sunrise = valid(t.sunrise), sunset = valid(t.sunset);
  return {
    astroDawn: valid(t.nightEnd), nauticalDawn: valid(t.nauticalDawn), civilDawn: valid(t.dawn), sunrise,
    sunset, civilDusk: valid(t.dusk), nauticalDusk: valid(t.nauticalDusk), astroDusk: valid(t.night),
    dayLengthMin: sunrise && sunset ? Math.round((sunset.getTime() - sunrise.getTime()) / 60000) : null,
  };
}

export function moonTimes(day: Date, lat: number, lng: number): { rise: Date | null; set: Date | null } {
  const t = SunCalc.getMoonTimes(day, lat, lng);
  return { rise: valid(t.rise), set: valid(t.set) };
}

export function moonUp(at: Date, lat: number, lng: number): boolean {
  return SunCalc.getMoonPosition(at, lat, lng).altitude > 0;
}

/** Whole hours from `from` to `to` (inclusive), e.g. sunset → sunrise for "tonight, hour by hour". */
export function tonightHours(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const t = new Date(from);
  t.setMinutes(0, 0, 0);
  if (t < from) t.setHours(t.getHours() + 1);
  for (; t <= to; t.setHours(t.getHours() + 1)) out.push(new Date(t));
  return out;
}

const ZONES: Record<string, string> = {
  IL: 'Asia/Jerusalem', PS: 'Asia/Hebron', LB: 'Asia/Beirut', SY: 'Asia/Damascus', JO: 'Asia/Amman', IQ: 'Asia/Baghdad',
  IR: 'Asia/Tehran', SA: 'Asia/Riyadh', YE: 'Asia/Aden', AE: 'Asia/Dubai', OM: 'Asia/Muscat', QA: 'Asia/Qatar',
  BH: 'Asia/Bahrain', KW: 'Asia/Kuwait', EG: 'Africa/Cairo', TR: 'Europe/Istanbul', CY: 'Asia/Nicosia',
};
export function zoneForCountry(cc: string | null): string | null {
  return (cc && ZONES[cc.toUpperCase()]) || null;
}

/** HH:MM in the zone (default: the user's), or a dash. */
export function fmtTime(d: Date | null, zone?: string): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, ...(zone ? { timeZone: zone } : {}) }).format(d);
}
