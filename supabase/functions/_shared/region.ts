// Scope of the map: Israel and the Middle East. A report about anywhere else (Ukraine, Europe,
// world markets…) is dropped unless it is about the region (e.g. a US statement about Iran).
export const REGION_COUNTRIES = new Set([
  "israel", "palestine", "palestinian territories", "gaza", "gaza strip", "west bank", "lebanon", "syria", "iraq",
  "iran", "yemen", "saudi arabia", "jordan", "egypt", "united arab emirates", "uae", "qatar", "bahrain", "kuwait",
  "oman", "turkey", "türkiye", "cyprus", "middle east",
  "ישראל", "עזה", "רצועת עזה", "יהודה ושומרון", "הגדה המערבית", "לבנון", "סוריה", "עיראק", "איראן", "תימן", "סעודיה",
  "ירדן", "מצרים", "איחוד האמירויות", "קטאר", "בחריין", "כווית", "עומאן", "טורקיה", "קפריסין", "המזרח התיכון",
]);

const REGION_WORDS = new RegExp(
  [
    "israel", "isra[eë]li", "\\bidf\\b", "iran", "tehran", "irgc", "gaza", "hamas", "lebanon", "hezbollah", "hizbullah", "beirut",
    "syria", "damascus", "yemen", "houthi", "sanaa", "iraq", "baghdad", "saudi", "riyadh", "hormuz", "persian gulf", "red sea",
    "jerusalem", "west bank", "middle east", "centcom", "המזרח התיכון", "סנטקום", "פיקוד המרכז", "الشرق الأوسط", "خاورمیانه", "jordan", "egypt", "sinai", "qatar", "emirates", "\\buae\\b", "bahrain", "kuwait", "oman", "golan",
    "ישראל", "צה\"ל", "צה״ל", "איראן", "טהרן", "משמרות המהפכה", "עזה", "חמאס", "לבנון", "חזבאללה", "ביירות", "סוריה", "דמשק",
    "תימן", "חות'ים", "חות׳ים", "צנעא", "עיראק", "בגדאד", "סעודיה", "ריאד", "הורמוז", "המפרץ", "הים האדום", "ירושלים",
    "יהודה ושומרון", "ירדן", "מצרים", "סיני", "קטאר", "האמירויות", "בחריין", "כווית", "עומאן", "גולן",
    "إسرائيل", "اسرائيل", "الاحتلال", "إيران", "ايران", "طهران", "الحرس الثوري", "غزة", "حماس", "لبنان", "حزب الله", "بيروت",
    "سوريا", "سورية", "دمشق", "اليمن", "الحوثي", "صنعاء", "العراق", "بغداد", "السعودية", "الرياض", "هرمز", "الخليج",
    "البحر الأحمر", "القدس", "الضفة", "الأردن", "مصر", "سيناء", "قطر", "الإمارات", "البحرين", "الكويت", "عمان", "الجولان",
    "اسرائیل", "ایران", "تهران", "سپاه", "لبنان", "سوریه", "یمن", "عراق", "عربستان",
  ].join("|"),
  "i",
);

/** Is this report about the region? (its countries, else words in its text) */
export function inRegion(countries: (string | null | undefined)[], text: string): boolean {
  const named = countries.map((c) => String(c ?? "").trim().toLowerCase()).filter(Boolean);
  if (named.some((c) => REGION_COUNTRIES.has(c))) return true;
  if (!named.length) return true; // unknown country: keep (the editor places it)
  return REGION_WORDS.test(text);
}
