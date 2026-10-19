/**
 * Geocoding service. Components talk to `geocoder`, never to a provider
 * directly, so Nominatim can be swapped for Google / Mapbox / HERE later
 * by adding a provider and changing `createGeocoder()`.
 *
 * Nominatim (OpenStreetMap) needs no API key. Its usage policy allows
 * light, interactive use — max 1 request per second — so requests here are
 * only made on explicit user actions and are throttled.
 */

export interface GeocodeResult {
  label: string;
  latitude: number;
  longitude: number;
  locationName: string;
  country: string;
  region: string;
  city: string;
  address: string;
  /** 0–1. Provider-specific relevance mapped to a confidence score. */
  confidence: number;
}

export interface GeocodingProvider {
  readonly id: string;
  search(query: string, opts?: { language?: string; limit?: number; signal?: AbortSignal }): Promise<GeocodeResult[]>;
  reverse(lat: number, lng: number, opts?: { language?: string; signal?: AbortSignal }): Promise<GeocodeResult | null>;
}

export class GeocodingError extends Error {
  constructor(message: string, public readonly kind: 'network' | 'rate_limited' | 'bad_response') {
    super(message);
    this.name = 'GeocodingError';
  }
}

// ── Nominatim provider ────────────────────────────────────────────

interface NominatimAddress {
  country?: string;
  state?: string;
  region?: string;
  county?: string;
  state_district?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  suburb?: string;
  neighbourhood?: string;
  road?: string;
  house_number?: string;
}

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  importance?: number;
  address?: NominatimAddress;
}

function fromNominatim(p: NominatimPlace): GeocodeResult | null {
  const latitude = Number(p.lat);
  const longitude = Number(p.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const a = p.address ?? {};
  const city = a.city || a.town || a.village || a.municipality || '';
  const region = a.state || a.region || a.state_district || a.county || '';
  const street = [a.road, a.house_number].filter(Boolean).join(' ');
  const locationName = p.name || a.suburb || a.neighbourhood || city || p.display_name.split(',')[0] || '';
  return {
    label: p.display_name,
    latitude,
    longitude,
    locationName: locationName.slice(0, 200),
    country: (a.country ?? '').slice(0, 100),
    region: region.slice(0, 100),
    city: city.slice(0, 100),
    address: street.slice(0, 300),
    confidence: Math.max(0.1, Math.min(1, p.importance ?? 0.5)),
  };
}

class NominatimProvider implements GeocodingProvider {
  readonly id = 'nominatim';
  private lastCall = 0;
  constructor(private readonly baseUrl = 'https://nominatim.openstreetmap.org') {}

  private async throttle() {
    const wait = this.lastCall + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();
  }

  private async get<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
    await this.throttle();
    const url = `${this.baseUrl}${path}?${new URLSearchParams({ format: 'jsonv2', addressdetails: '1', ...params })}`;
    let res: Response;
    try {
      res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new GeocodingError('The location service could not be reached.', 'network');
    }
    if (res.status === 429) throw new GeocodingError('Too many location searches. Wait a moment and try again.', 'rate_limited');
    if (!res.ok) throw new GeocodingError(`The location service returned an error (${res.status}).`, 'bad_response');
    return (await res.json()) as T;
  }

  async search(query: string, opts: { language?: string; limit?: number; signal?: AbortSignal } = {}) {
    const q = query.trim().slice(0, 200);
    if (!q) return [];
    const rows = await this.get<NominatimPlace[]>(
      '/search',
      { q, limit: String(opts.limit ?? 6), 'accept-language': opts.language ?? 'en' },
      opts.signal,
    );
    return rows.map(fromNominatim).filter((r): r is GeocodeResult => r !== null);
  }

  async reverse(lat: number, lng: number, opts: { language?: string; signal?: AbortSignal } = {}) {
    const row = await this.get<NominatimPlace & { error?: string }>(
      '/reverse',
      { lat: lat.toFixed(6), lon: lng.toFixed(6), zoom: '14', 'accept-language': opts.language ?? 'en' },
      opts.signal,
    );
    if (!row || row.error) return null;
    return fromNominatim(row);
  }
}

function createGeocoder(): GeocodingProvider {
  return new NominatimProvider();
}

export const geocoder: GeocodingProvider = createGeocoder();
