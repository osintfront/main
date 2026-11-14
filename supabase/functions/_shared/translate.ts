// Headline + short summary in Hebrew and English for an event that is still in a foreign
// language. Goes through the site's translation chain (POST /api/translate on Vercel: free
// providers first, Claude only as the last, paid fallback, and a cache so a text is never
// translated twice). Needs the secrets TRANSLATE_API_URL and TRANSLATE_SECRET; without them,
// or if the site cannot be reached, it falls back to the old direct Claude call (logged).
import { fixTerms, foreignLetters, learnedTerms, translateBrief, translateFull } from "./editor.ts";
import { fullTextPieces } from "./fullText.ts";

// Tolerant of a pasted Markdown link ("[https://…](https://…)"): the first plain URL is used.
export const TRANSLATE_API_URL = (Deno.env.get("TRANSLATE_API_URL") ?? "").match(/https?:\/\/[^\s\]\)\[(]+/)?.[0] ?? "";
const API_URL = TRANSLATE_API_URL;
const SECRET = Deno.env.get("TRANSLATE_SECRET") ?? "";

export interface Brief { title_he: string; summary_he: string; title_en: string; summary_en: string; model: string }

/** The first sentence of the text (the summary's source), at most ~220 characters. */
function lead(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  const m = t.match(/^(.{20,220}?[.!?؟。])(\s|$)/);
  return (m ? m[1] : t.slice(0, 220)).trim();
}

/** Cut a translated sentence to about n characters at a word. */
function cut(s: string, n = 110): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n + 10) return t;
  const c = t.slice(0, n);
  return `${c.slice(0, Math.max(c.lastIndexOf(" "), n - 20)).trimEnd()}…`;
}

async function chain(texts: string[], target: "he" | "en"): Promise<{ texts: string[]; provider: string; translated: boolean } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 65_000);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-translate-secret": SECRET },
      body: JSON.stringify({ texts, target }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const out = await res.json();
    const list: any[] = Array.isArray(out?.translations) ? out.translations : [];
    return { texts: list.map((x) => String(x?.text ?? "")), provider: String(out?.provider ?? "?"), translated: list.some((x) => x?.translated) };
  } catch (e) {
    console.warn("translate chain unreachable:", String((e as Error)?.message ?? e).slice(0, 160));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** null = nothing could translate it (keep the original). */
export async function translateBriefChain(title: string, text: string): Promise<Brief | null> {
  if (API_URL && SECRET) {
    const src = [title.slice(0, 500), lead(text || title)];
    const [he, en] = await Promise.all([chain(src, "he"), chain(src, "en")]);
    if (he && en) {
      if (!he.translated && !en.translated) return null; // every provider failed: the original stays
      console.log(`translate chain: he via ${he.provider}, en via ${en.provider}`);
      await learnedTerms(); // staff corrections ("sweep fire" → "automatic fire") over the machine translation
      return {
        title_he: fixTerms(he.texts[0] || title), summary_he: fixTerms(cut(he.texts[1] ?? "")),
        title_en: fixTerms(en.texts[0] || ""), summary_en: fixTerms(cut(en.texts[1] ?? "")), model: `chain:${he.provider}/${en.provider}`,
      };
    }
  }
  console.warn("⚠️ translate chain not configured or unreachable — PAID direct Claude translation used");
  return await translateBrief(title, text);
}

/**
 * The whole text in Hebrew and English (analyses & summaries are shown in full to Pro / Max):
 * paragraph by paragraph through the same chain (free providers first, cache). At most 20
 * pieces of ≤5000 characters per request, so short paragraphs are joined. null = not translated.
 */
/** Words in a Hebrew text written in a script other than Hebrew / Latin (Arabic left behind). */
function foreignWords(he: string): string[] {
  return [...new Set(he.match(/[^\s\p{Script=Hebrew}\p{Script=Latin}\P{L}]+[^\s]*/gu) ?? [])].slice(0, 30);
}

export async function translateFullChain(text: string): Promise<{ he: string; en: string; model: string } | null> {
  // Claude first (the free providers mangle long Arabic); the chain only if Claude fails.
  try {
    let r = await translateFull(text);
    let left = foreignWords(r.he);
    if (left.length) {
      console.warn("full translation left foreign words, asking again:", left.join(", ").slice(0, 200));
      r = await translateFull(text, left);
      left = foreignWords(r.he);
    }
    if (!left.length) return r;
    console.warn("full translation still has foreign words; trying the chain:", left.join(", ").slice(0, 200));
  } catch (e) {
    console.warn("full translation (Claude) failed:", String((e as Error)?.message ?? e).slice(0, 160));
  }
  if (!API_URL || !SECRET) return null;
  const pieces = fullTextPieces(text);
  if (!pieces.length) return null;
  const [he, en] = await Promise.all([chain(pieces, "he"), chain(pieces, "en")]);
  if (!he?.translated || !en?.translated) return null;
  await learnedTerms();
  const join = (xs: string[]) => fixTerms(xs.map((x) => x.trim()).filter(Boolean).join("\n\n")).slice(0, 20000);
  const out = { he: join(he.texts), en: join(en.texts), model: `chain:${he.provider}/${en.provider}` };
  // Untranslated paragraphs left in Arabic: better no full text than a half-translated one.
  return foreignLetters(out.he.replace(/[A-Za-z0-9-]+/g, " ")) ? null : out;
}
