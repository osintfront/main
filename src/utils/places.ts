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

const ARABIC = /[\u0600-\u06FF]/;
/** Common Arabic place words → Hebrew (whole words). */
const AR_WORDS: Record<string, string> = {
  'جنوب': 'דרום', 'شمال': 'צפון', 'شرق': 'מזרח', 'غرب': 'מערב', 'وسط': 'מרכז', 'شرقي': 'מזרחי', 'غربي': 'מערבי',
  'لبنان': 'לבנון', 'سوريا': 'סוריה', 'سورية': 'סוריה', 'العراق': 'עיראק', 'اليمن': 'תימן', 'إيران': 'איראן', 'ايران': 'איראן',
  'الأردن': 'ירדן', 'مصر': 'מצרים', 'السعودية': 'סעודיה', 'فلسطين': 'השטחים', 'غزة': 'עזה', 'قطاع': 'רצועת', 'الضفة': 'הגדה',
  'الغربية': 'המערבית', 'دمشق': 'דמשק', 'بيروت': 'ביירות', 'صنعاء': 'צנעא', 'بغداد': 'בגדאד', 'طهران': 'טהרן', 'محافظة': 'מחוז',
  'قضاء': 'נפת', 'ريف': 'אזור הכפר של', 'مدينة': 'העיר', 'بلدة': 'העיירה', 'قرية': 'הכפר', 'مخيم': 'מחנה', 'وادي': 'ואדי', 'جبل': "ג'בל",
  'البحر': 'הים', 'الأحمر': 'האדום', 'المتوسط': 'התיכון', 'الجنوبي': 'הדרומי', 'الشمالي': 'הצפוני', 'مطار': 'נמל התעופה', 'ميناء': 'נמל',
};
/** Arabic letters → Hebrew sounds (for names without a Hebrew form). */
const AR_LETTERS: Record<string, string> = {
  'ا': 'א', 'أ': 'א', 'إ': 'א', 'آ': 'א', 'ء': '', 'ب': 'ב', 'ت': 'ת', 'ث': 'ת', 'ج': "ג'", 'ح': 'ח', 'خ': "ח'", 'د': 'ד', 'ذ': "ד'",
  'ر': 'ר', 'ز': 'ז', 'س': 'ס', 'ش': 'ש', 'ص': 'צ', 'ض': "ד'", 'ط': 'ט', 'ظ': "ט'", 'ع': 'ע', 'غ': "ע'", 'ف': 'פ', 'ق': 'ק', 'ك': 'כ',
  'ل': 'ל', 'م': 'מ', 'ن': 'נ', 'ه': 'ה', 'ة': 'ה', 'و': 'ו', 'ي': 'י', 'ى': 'א', 'ئ': 'א', 'ؤ': 'ו',
};
const FINAL: Record<string, string> = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };
/** Arabic place name → Hebrew: known words translated, the rest written in Hebrew letters. */
export function arabicToHebrew(name: string): string {
  return name.split(/(\s+|[،,\-])/).map((w) => {
    if (AR_WORDS[w]) return AR_WORDS[w];
    if (!ARABIC.test(w)) return w;
    let core = w.replace(/[\u064B-\u065F\u0670]/g, '');
    let pre = '';
    if (core.startsWith('ال') && core.length > 3) { pre = 'א-'; core = core.slice(2); }
    let he = [...core].map((c) => AR_LETTERS[c] ?? c).join('');
    he = he.replace(/([כמנפצ])$/, (c) => FINAL[c]);
    return pre + he;
  }).join('');
}

/** The event's place in the site language: the place database / editor name, else the stored name. */
export function placeLabel(event: Pick<PublicEvent, 'locationName' | 'locationNameHe' | 'locationNameEn'>, lang: string): string {
  if (lang === 'he') {
    if (event.locationNameHe) return event.locationNameHe;
    if (event.locationName && ARABIC.test(event.locationName)) return arabicToHebrew(event.locationName);
    return event.locationName || event.locationNameEn || '';
  }
  return event.locationNameEn || (HEBREW.test(event.locationName) ? '' : event.locationName) || event.locationNameHe || event.locationName || '';
}

/** "Place, Country" in one language; a place that repeats the country is not doubled. */
export function whereLabel(event: Pick<PublicEvent, 'locationName' | 'locationNameHe' | 'locationNameEn' | 'country'>, lang: string): string {
  const place = placeLabel(event, lang);
  const country = countryLabel(event.country, lang);
  return [place, country && country !== place ? country : ''].filter(Boolean).join(', ');
}

/** One extra place's name in the site language (Arabic → Hebrew letters on the Hebrew site). */
export function placeNameIn(p: { name: string; nameEn: string }, lang: string): string {
  if (lang === 'he') return p.name && /[\u0600-\u06FF]/.test(p.name) ? arabicToHebrew(p.name) : p.name || p.nameEn;
  return p.nameEn || p.name;
}
