// The editor's Hebrew name for the event's place (stored as events.location_name_he),
// so the Hebrew site never falls back to spelling an Arabic/Persian name letter by letter.
const HEBREW = /[א-ת]/;

const strip = (s: unknown) => String(s ?? "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();

export function hebrewPlaceName(r: { location_name?: string; locations?: { name?: string }[] }): string | null {
  for (const n of [r.location_name, ...(r.locations ?? []).map((l) => l?.name)]) {
    const s = strip(n);
    if (s && HEBREW.test(s)) return s.slice(0, 200);
  }
  return null;
}
