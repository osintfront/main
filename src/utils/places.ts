import type { PublicEvent } from '@/types/event';

/** Country names as stored (English) → Hebrew. Unknown names are shown as they are. */
const COUNTRY_HE: Record<string, string> = {
  israel: 'ישראל', lebanon: 'לבנון', syria: 'סוריה', iraq: 'עיראק', iran: 'איראן', yemen: 'תימן', jordan: 'ירדן',
  egypt: 'מצרים', 'saudi arabia': 'סעודיה', qatar: 'קטאר', 'united arab emirates': 'איחוד האמירויות', uae: 'איחוד האמירויות',
  bahrain: 'בחריין', oman: 'עומאן', kuwait: 'כווית', turkey: 'טורקיה', türkiye: 'טורקיה', cyprus: 'קפריסין',
  palestine: 'הרשות הפלסטינית', 'palestinian territories': 'הרשות הפלסטינית', 'gaza strip': 'רצועת עזה', gaza: 'רצועת עזה',
  'west bank': 'יהודה ושומרון', 'united states': 'ארצות הברית', usa: 'ארצות הברית', russia: 'רוסיה', china: 'סין',
  'united kingdom': 'בריטניה', uk: 'בריטניה', france: 'צרפת', germany: 'גרמניה', libya: 'לוב', sudan: 'סודן',
  afghanistan: 'אפגניסטן', pakistan: 'פקיסטן', azerbaijan: 'אזרבייג׳ן', armenia: 'ארמניה', ukraine: 'אוקראינה',
};
/** Hebrew → English: the first (full) English name of each Hebrew name wins, so "uae"/"uk" aren't used. */
const COUNTRY_EN: Record<string, string> = {};
for (const [en, he] of Object.entries(COUNTRY_HE)) {
  COUNTRY_EN[he] ??= en.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}
COUNTRY_EN['ישראל'] = 'Israel';
COUNTRY_EN['סעודיה'] = 'Saudi Arabia';
COUNTRY_EN['ערב הסעודית'] = 'Saudi Arabia';

const HEBREW = /[א-ת]/;

export function countryLabel(country: string, lang: string): string {
  const c = (country ?? '').trim();
  if (!c) return '';
  if (lang === 'he') return HEBREW.test(c) ? c : COUNTRY_HE[c.toLowerCase()] ?? c;
  return HEBREW.test(c) ? COUNTRY_EN[c] ?? c : c;
}

/** The event's place in the site language: the place database / editor name, else the stored name. */
export function placeLabel(event: Pick<PublicEvent, 'locationName' | 'locationNameHe' | 'locationNameEn'>, lang: string): string {
  if (lang === 'he') return event.locationNameHe || event.locationName || event.locationNameEn || '';
  return event.locationNameEn || (HEBREW.test(event.locationName) ? '' : event.locationName) || event.locationNameHe || event.locationName || '';
}

/** "Place, Country" in one language; a place that repeats the country is not doubled. */
export function whereLabel(event: Pick<PublicEvent, 'locationName' | 'locationNameHe' | 'locationNameEn' | 'country'>, lang: string): string {
  const place = placeLabel(event, lang);
  const country = countryLabel(event.country, lang);
  return [place, country && country !== place ? country : ''].filter(Boolean).join(', ');
}
