// "Same place within the hour" merge for the ingest: two channels reporting one incident.
// A whole country or region ("Iran", "Lebanon", "Middle East") is not a place for this rule:
// a US statement about Iran and drone activity over Iran are different events (14 Nov 2026).
import { REGION_COUNTRIES } from "./region.ts";

/** A place name reduced to compare spellings: "Rashaf" / "Rshaf" / "رشاف" → same key. */
export function placeKeys(...names: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const raw of names) {
    let n = String(raw ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ًͯ-ٟ֑-ׇ]/g, "").trim();
    if (!n) continue;
    n = n.replace(/^(al|el|ad|an|ar|as|at|az)[- ]/, "").replace(/^ال/, "").replace(/[^a-z؀-ۿא-ת]/g, "");
    if (/^[a-z]+$/.test(n)) n = n.replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1"); // consonant skeleton
    if (n.length >= 2) out.add(n);
  }
  return out;
}

export const eventPlaceKeys = (e: any) => placeKeys(e.location_name, e.ai_suggestions?.place_en);

const normName = (raw: unknown) => String(raw ?? "").toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f\u064B-\u065F\u0591-\u05C7]/g, "").replace(/^(the |ה)/, "").replace(/[^a-z\u0600-\u06FF\u05D0-\u05EA]/g, "");

/** Whole countries / regions: never enough on their own to call two reports one incident. */
const WIDE_NAMES = new Set([
  ...REGION_COUNTRIES,
  "إسرائيل", "اسرائيل", "اسرائیل", "فلسطين", "فلسطین", "غزة", "قطاع غزة", "الضفة الغربية", "لبنان", "سوريا", "سورية", "سوریه",
  "العراق", "عراق", "إيران", "ايران", "ایران", "اليمن", "یمن", "السعودية", "عربستان", "الأردن", "مصر", "الإمارات", "قطر",
  "البحرين", "الكويت", "عمان", "تركيا", "ترکیه", "قبرص", "الشرق الأوسط", "خاورمیانه", "palestinian territory",
  "united states", "usa", "us", "america", "ארצות הברית", "ארה\"ב", "الولايات المتحدة", "آمریکا", "امريكا", "russia", "רוסיה", "روسيا",
].map(normName));
export const isWidePlace = (raw: unknown) => WIDE_NAMES.has(normName(raw));

/** placeKeys of the names that are not a whole country / region. */
export const narrowPlaceKeys = (...names: (string | null | undefined)[]) => placeKeys(...names.filter((n) => !isWidePlace(n)));

/** The same place within the hour: another channel reporting the same incident (towns only). */
export function samePlaceEvent(pool: any[], keys: Set<string>, sentAt: Date, excludeId?: string): any | null {
  if (!keys.size) return null;
  return pool.find((e) => e.id !== excludeId &&
    Math.abs(new Date(e.occurred_at).getTime() - sentAt.getTime()) <= 60 * 60000 &&
    [...narrowPlaceKeys(e.location_name, e.ai_suggestions?.place_en)].some((k) => keys.has(k))) ?? null;
}
