// Phone push notifications: severity order and the Hebrew notification text.
// Fixed Hebrew names + emoji per event category (no AI). Missing category → "📍 אירוע" (reported back).

export const SEVERITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export const CATEGORY_HE: Record<string, [string, string]> = {
  airstrike: ['✈️', 'תקיפה אווירית'],
  'artillery-shelling': ['💥', 'ירי ארטילרי'],
  assassination: ['🎯', 'חיסול'],
  'cyber-incident': ['💻', 'אירוע סייבר'],
  drone: ['🛸', 'רחפן'],
  explosion: ['💥', 'פיצוץ'],
  fire: ['🔥', 'שריפה'],
  'force-sighting': ['👁️', 'זיהוי כוחות'],
  'home-front-alerts': ['🚨', 'התרעת פיקוד העורף'],
  'humanitarian-event': ['🏥', 'אירוע הומניטרי'],
  infiltration: ['🚷', 'חדירה'],
  'infrastructure-incident': ['⚡', 'פגיעה בתשתית'],
  'military-activity': ['🪖', 'פעילות צבאית'],
  'missile-rocket-attack': ['🚀', 'ירי טילים ורקטות'],
  'natural-disaster': ['🌪️', 'אסון טבע'],
  other: ['📍', 'אירוע'],
  'political-event': ['🏛️', 'אירוע מדיני'],
  'protest-civil-unrest': ['📢', 'הפגנה'],
  'shooting-gunfire': ['🔫', 'ירי נשק קל'],
  statements: ['🗣️', 'הצהרה'],
  'terror-security-incident': ['⚠️', 'אירוע ביטחוני'],
  'transportation-incident': ['🚗', 'תאונה'],
  uav: ['🛩️', 'כטב"ם'],
  uncategorized: ['📍', 'אירוע'],
};

const COUNTRY_HE: Record<string, string> = {
  israel: 'ישראל', lebanon: 'לבנון', syria: 'סוריה', iran: 'איראן', iraq: 'עיראק', yemen: 'תימן', gaza: 'עזה',
  'gaza strip': 'רצועת עזה', 'west bank': 'יהודה ושומרון', palestine: 'השטחים', jordan: 'ירדן', egypt: 'מצרים',
  'saudi arabia': 'סעודיה', 'united arab emirates': 'איחוד האמירויות', uae: 'איחוד האמירויות', qatar: 'קטאר',
  bahrain: 'בחריין', kuwait: 'כווית', oman: 'עומאן', turkey: 'טורקיה', russia: 'רוסיה', ukraine: 'אוקראינה',
  'united states': 'ארה"ב', usa: 'ארה"ב', cyprus: 'קפריסין',
};

const RLM = '‏';
const hebrew = (s: string) => /[֐-׿]/.test(s);
const latin = (s: string) => /[A-Za-z]/.test(s);

/** Cut at a word boundary, with "…". */
export function cut(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const c = t.slice(0, n - 1);
  const i = c.lastIndexOf(' ');
  return `${(i > n * 0.5 ? c.slice(0, i) : c).replace(/[\s,.;:–-]+$/, '')}…`;
}

/** Hebrew place: the Hebrew place name, else the country in Hebrew, else nothing. */
function placeHe(r: any): string {
  for (const v of [r.location_name_he, r.location_name]) if (v && hebrew(v) && !latin(v)) return String(v).trim();
  const first = String(r.country ?? '').split(/\s*[/,;|]\s*/)[0].trim().toLowerCase();
  return COUNTRY_HE[first] ?? '';
}

/** Hebrew headline from the translation cache; never English. */
function headlineHe(r: any): string {
  const cands = [r.translations?.he?.title, r.title, r.translations?.he?.summary];
  for (const c of cands) {
    if (typeof c !== 'string' || !hebrew(c)) continue;
    // Strip leftover Latin words (names in parentheses, etc.).
    const clean = c.replace(/\([^)]*[A-Za-z][^)]*\)/g, '').replace(/[A-Za-z][A-Za-z.\-']*/g, '').replace(/\s{2,}/g, ' ').trim();
    if (clean) return clean;
  }
  return '';
}

export interface PushMessage { title: string; body: string; url: string; tag: string }
export interface FormatIssues { missingCategory?: string; noSeverity?: boolean }

export function formatPush(r: any, issues: FormatIssues = {}): PushMessage {
  const cat = CATEGORY_HE[r.category_slug];
  if (!cat) issues.missingCategory = String(r.category_slug ?? '');
  const [emoji, name] = cat ?? ['📍', 'אירוע'];
  const place = placeHe(r);
  const head = `${r.severity === 'critical' ? '🔴 ' : ''}${emoji} ${name}`;
  const title = place ? `${head} · ${place}` : head;
  const body = cut(headlineHe(r) || 'פרטים נוספים באתר', 150);
  return { title: RLM + cut(title, 38), body: RLM + body, url: `/?event=${encodeURIComponent(r.id)}`, tag: `ev-${r.id}` };
}

/** Event severity (missing → medium) and whether it was missing. */
export function severityOf(r: any): { rank: number; missing: boolean } {
  const rank = SEVERITY_RANK[r.severity];
  return rank ? { rank, missing: false } : { rank: SEVERITY_RANK.medium, missing: true };
}
