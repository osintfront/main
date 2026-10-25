// One event per category for automatic ingest (Telegram/WhatsApp, crawler agents).
// The editor tags every place with what happened there (locations[].category_slug).
// When an event's places span several categories, the event keeps its own category's
// places and a sibling event is created for each other category.
// Siblings carry ai_suggestions.split_from = the original id (the dedupe agent skips them).

// deno-lint-ignore no-explicit-any
type Db = any;

const HE: Record<string, string> = {
  "shooting-gunfire": "ירי נשק קל", assassination: "חיסול", "artillery-shelling": "הפגזה ארטילרית",
  "force-sighting": "זיהוי כוחות", statements: "הצהרות", "missile-rocket-attack": "ירי רקטות וטילים",
  airstrike: "תקיפה אווירית", explosion: "פיצוץ", infiltration: "חדירה", drone: "רחפן", uav: 'כטב"מ',
  "terror-security-incident": "אירוע טרור או ביטחוני", "military-activity": "פעילות צבאית",
  "political-event": "אירוע מדיני", "protest-civil-unrest": "הפגנה או אי־סדר אזרחי",
  "natural-disaster": "אסון טבע", fire: "שריפה", "infrastructure-incident": "תקלת תשתית",
  "cyber-incident": "אירוע סייבר", "humanitarian-event": "אירוע הומניטרי", other: "אחר",
};
const EN: Record<string, string> = {
  "shooting-gunfire": "Small-arms fire", "artillery-shelling": "Artillery shelling", "force-sighting": "Forces sighting",
  "missile-rocket-attack": "Rocket and missile fire", uav: "UAV", "military-activity": "Military activity",
  "terror-security-incident": "Security incident", "infrastructure-incident": "Infrastructure incident",
};

const CLONE = [
  "description", "original_report_text", "status", "severity", "country", "region", "city",
  "source_name", "source_url", "source_type", "occurred_at", "published_at", "created_by", "approved_by",
  "is_breaking", "is_verified", "classification_confidence", "sources", "whatsapp_text", "translations",
];

// deno-lint-ignore no-explicit-any
type Place = { name?: string; name_en?: string; lat?: number | null; lng?: number | null; precision?: string; category_slug?: string; [k: string]: any };

function names(list: Place[], key: "name" | "name_en") {
  const n = list.map((p) => p[key] || p.name).filter(Boolean) as string[];
  return n.slice(0, 4).join(", ") + (n.length > 4 ? (key === "name" ? ` ועוד ${n.length - 4}` : ` +${n.length - 4}`) : "");
}

/** Split an event whose places have 2+ categories. Returns the new sibling ids. */
export async function splitEventByCategory(db: Db, eventId: string): Promise<string[]> {
  const { data: ev } = await db.from("events").select("*").eq("id", eventId).maybeSingle();
  if (!ev || ev.deleted_at || ev.ai_suggestions?.split_from || ev.ai_suggestions?.split_into) return [];
  const places: Place[] = Array.isArray(ev.locations) ? ev.locations : [];
  const groups = new Map<string, Place[]>();
  for (const p of places) if (p?.category_slug) groups.set(p.category_slug, [...(groups.get(p.category_slug) ?? []), p]);
  if (groups.size < 2) return [];

  const { data: cats } = await db.from("event_categories").select("id,slug,name").in("slug", [...groups.keys()]);
  const bySlug = new Map<string, { id: string; slug: string; name: string }>((cats ?? []).map((c: any) => [c.slug, c]));
  const own = (cats ?? []).find((c: any) => c.id === ev.category_id)?.slug;
  const keepSlug = own && groups.has(own) ? own : [...groups.keys()].find((s) => bySlug.has(s))!;
  // Places without a tag stay with the original event.
  const untagged = places.filter((p) => !p?.category_slug);
  const ids: string[] = [];

  for (const [slug, list] of groups) {
    if (slug === keepSlug) continue;
    const cat = bySlug.get(slug);
    if (!cat) continue;
    const first = list.find((p) => p.lat != null && p.lng != null);
    const he = `${HE[slug] ?? cat.name}: ${names(list, "name")}`.slice(0, 200);
    const en = `${EN[slug] ?? cat.name.replace(/\s*\(.*\)$/, "")}: ${names(list, "name_en")}`.slice(0, 200);
    const row: Record<string, unknown> = Object.fromEntries(CLONE.map((k) => [k, ev[k]]));
    const tr = (ev.translations ?? {}) as Record<string, any>;
    Object.assign(row, {
      title: he,
      category_id: cat.id,
      locations: list,
      location_name: (first?.name ?? list[0]?.name ?? "").slice(0, 200),
      latitude: first ? first.lat : null,
      longitude: first ? first.lng : null,
      location_precision: first ? (first.precision ?? "exact") : null,
      geocoding_confidence: first ? 0.7 : null,
      translations: { ...tr, he: { ...(tr.he ?? {}), title: he }, en: { ...(tr.en ?? {}), title: en } },
      ai_suggestions: { ...(ev.ai_suggestions ?? {}), split_from: ev.id },
    });
    let { data: ins, error } = await db.from("events").insert(row).select("id").single();
    // Published but the database could not place it: keep it as a draft for an analyst.
    if (error?.code === "23514" && row.status === "published") {
      ({ data: ins, error } = await db.from("events").insert({ ...row, status: "draft", published_at: null, approved_by: null }).select("id").single());
    }
    if (error) { console.error("split insert failed", error.message); continue; }
    ids.push(ins.id);
  }
  if (!ids.length) return [];

  // The original keeps its own category's places (+ untagged ones); move its pin if it pointed elsewhere.
  const keep = [...(groups.get(keepSlug) ?? []), ...untagged];
  const keepCat = bySlug.get(keepSlug);
  const heKeep = `${HE[keepSlug] ?? keepCat?.name ?? ""}: ${names(keep, "name")}`.slice(0, 200);
  const enKeep = `${EN[keepSlug] ?? (keepCat?.name ?? "").replace(/\s*\(.*\)$/, "")}: ${names(keep, "name_en")}`.slice(0, 200);
  const tr0 = (ev.translations ?? {}) as Record<string, any>;
  const update: Record<string, unknown> = {
    // The report's own headline covered every kind; now it is only one of them.
    title: heKeep,
    translations: { ...tr0, he: { ...(tr0.he ?? {}), title: heKeep }, en: { ...(tr0.en ?? {}), title: enKeep } },
    locations: keep,
    category_id: bySlug.get(keepSlug)?.id ?? ev.category_id,
    ai_suggestions: { ...(ev.ai_suggestions ?? {}), split_into: ids },
  };
  const onPin = keep.some((p) => p.lat != null && Math.abs(Number(p.lat) - Number(ev.latitude)) < 1e-4 && Math.abs(Number(p.lng) - Number(ev.longitude)) < 1e-4);
  const first = keep.find((p) => p.lat != null && p.lng != null);
  if (!onPin && first) Object.assign(update, { latitude: first.lat, longitude: first.lng, location_name: String(first.name ?? "").slice(0, 200), location_precision: first.precision ?? "exact" });
  const { error } = await db.from("events").update(update).eq("id", ev.id);
  if (error) console.error("split update failed", error.message);
  return ids;
}
