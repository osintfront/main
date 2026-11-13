// Which country an event belongs to — shared by triage (whatsapp-ingest) and the editor. No imports.

/** For the `country` field of the AI tools (English). */
export const COUNTRY_RULE =
  "The country or territory where it happened (where the pin goes), in English — not the attacker's, the reporter's or the source's country. " +
  "An Israeli strike in Gaza → Palestine; in Lebanon → Lebanon; a US strike in Yemen → Yemen. The Gaza Strip and the West Bank → Palestine. " +
  "A statement or announcement with no place of its own: the country of who made it (Hamas → Palestine, Hezbollah → Lebanon, the Israeli government → Israel). " +
  "Fill it whenever the country is clear, even when no specific place is named.";

/** The same rule for the editor's Hebrew instructions. */
export const COUNTRY_RULE_HE =
  "country (באנגלית): המדינה או השטח שבהם האירוע קרה (איפה שהנעץ) — לא המדינה של התוקף, של המדווח או של המקור. " +
  "תקיפה ישראלית בעזה → Palestine; בלבנון → Lebanon; תקיפה אמריקאית בתימן → Yemen. רצועת עזה והגדה המערבית → Palestine (פלסטין). " +
  "הצהרה או הודעה בלי מקום משלה: המדינה של מי שאמר (חמאס → Palestine, חיזבאללה → Lebanon, ממשלת ישראל → Israel). " +
  "תמיד מלא אותה, גם כשאין שום מקום ספציפי.";
