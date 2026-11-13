// Deep analysis: store the editor's term marks for one event. The AI rows are replaced, rows a staff
// member added ("Analyze") stay. Never throws: a failure must not stop the ingest pipeline.
import type { TermMark } from "./terms.ts";

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any };

export async function saveEventTerms(db: Db, eventId: string, marks: TermMark[]): Promise<void> {
  try {
    const { error } = await db.from("event_terms").delete().eq("event_id", eventId).eq("source", "ai");
    if (error) throw new Error(error.message);
    if (!marks.length) return;
    const rows = marks.map((m) => ({ event_id: eventId, key: m.key, keys: m.keys, kind: m.kind, he: m.he, en: m.en, name: m.name, source: "ai" }));
    const { error: upErr } = await db.from("event_terms").upsert(rows, { onConflict: "event_id,key", ignoreDuplicates: true });
    if (upErr) throw new Error(upErr.message);
  } catch (e) {
    console.warn("event terms not saved", eventId, String((e as Error)?.message ?? e).slice(0, 200));
  }
}
