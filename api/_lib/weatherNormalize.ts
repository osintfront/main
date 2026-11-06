// MET Norway Locationforecast 2.0 (compact) → the slim shape the weather card uses.
// Shared with the browser as types (import type), so it stays free of Node APIs.

export interface Hour {
  t: string; temp: number | null; cloud: number | null; rain: number | null; windKmh: number | null; windDir: number | null;
  gustKmh: number | null; humidity: number | null; symbol: string | null;
}
export interface Day { date: string; tMax: number | null; tMin: number | null; rain: number; windMaxKmh: number | null; symbol: string | null }
export interface PointForecast { updated: string; now: Hour; hours: Hour[]; days: Day[] }

interface Step {
  time: string;
  data: {
    instant: { details: Record<string, number | undefined> };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
    next_6_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
    next_12_hours?: { summary?: { symbol_code?: string } };
  };
}

const HOUR = 3600_000;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (v: number) => Math.round(v * 10) / 10;
const kmh = (ms: number | null) => (ms === null ? null : round1(ms * 3.6));

export function roundCoord(v: number): number {
  return Math.round(Math.round(v * 20) / 20 * 100) / 100;
}

function symbolOf(s: Step): string | null {
  return s.data.next_1_hours?.summary?.symbol_code ?? s.data.next_6_hours?.summary?.symbol_code ?? s.data.next_12_hours?.summary?.symbol_code ?? null;
}

/** Rain in mm per hour at a step: next hour if given, otherwise the next 6 hours spread evenly. */
function rainRate(s: Step): number | null {
  const one = num(s.data.next_1_hours?.details?.precipitation_amount);
  if (one !== null) return one;
  const six = num(s.data.next_6_hours?.details?.precipitation_amount);
  return six === null ? null : six / 6;
}

function toHour(s: Step): Hour {
  const d = s.data.instant.details;
  const rain = rainRate(s);
  return {
    t: s.time.replace(/\.\d+Z$/, 'Z'),
    temp: num(d.air_temperature),
    cloud: num(d.cloud_area_fraction),
    rain: rain === null ? null : round1(rain),
    windKmh: kmh(num(d.wind_speed)),
    windDir: num(d.wind_from_direction),
    gustKmh: kmh(num(d.wind_speed_of_gust)),
    humidity: num(d.relative_humidity),
    symbol: symbolOf(s),
  };
}

function localDate(ms: number, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}
function localHour(ms: number, zone: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }).format(ms)) % 24;
}

export function normalizeMet(raw: unknown, zone: string, now: Date = new Date()): PointForecast {
  const steps = (raw as { properties?: { timeseries?: Step[] } })?.properties?.timeseries;
  if (!Array.isArray(steps) || steps.length === 0 || !steps[0]?.data?.instant) throw new Error('bad MET response');
  const updated = String((raw as { properties: { meta?: { updated_at?: string } } }).properties.meta?.updated_at ?? '');

  const start = Math.floor(now.getTime() / HOUR) * HOUR;
  const from = Math.max(0, steps.findIndex((s) => Date.parse(s.time) >= start));
  const hours: Hour[] = [];
  for (let i = from; i < steps.length && hours.length < 48; i++) {
    const t = Date.parse(steps[i].time);
    if (hours.length && t - Date.parse(hours[hours.length - 1].t) !== HOUR) break; // hourly part only
    hours.push(toHour(steps[i]));
  }

  // Days: every step from the start of today (local), rain weighted by the step's length (1 h or 6 h).
  const today = localDate(now.getTime(), zone);
  const byDay = new Map<string, { temps: number[]; winds: number[]; rain: number; symbol: string | null; noonGap: number }>();
  steps.forEach((s, i) => {
    const t = Date.parse(s.time);
    const date = localDate(t, zone);
    if (date < today) return;
    const day = byDay.get(date) ?? { temps: [], winds: [], rain: 0, symbol: null, noonGap: 99 };
    const d = s.data.instant.details;
    const temp = num(d.air_temperature), wind = num(d.wind_speed);
    if (temp !== null) day.temps.push(temp);
    if (wind !== null) day.winds.push(wind);
    const next = steps[i + 1] ? Date.parse(steps[i + 1].time) : null;
    const span = next === null ? (s.data.next_6_hours ? 6 : 0) : Math.min(6, (next - t) / HOUR);
    day.rain += (rainRate(s) ?? 0) * span;
    const gap = Math.abs(localHour(t, zone) - 12);
    if (gap < day.noonGap && symbolOf(s)) { day.noonGap = gap; day.symbol = symbolOf(s); }
    byDay.set(date, day);
  });
  const days: Day[] = [...byDay.entries()].slice(0, 7).map(([date, d]) => ({
    date,
    tMax: d.temps.length ? Math.max(...d.temps) : null,
    tMin: d.temps.length ? Math.min(...d.temps) : null,
    rain: round1(d.rain),
    windMaxKmh: d.winds.length ? kmh(Math.max(...d.winds)) : null,
    symbol: d.symbol,
  }));

  return { updated, now: hours[0], hours, days };
}
