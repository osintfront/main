// Headline + short summary in Hebrew and English for an event that is still in a foreign
// language. Goes through the site's translation chain (POST /api/translate on Vercel: free
// providers first, Claude only as the last, paid fallback, and a cache so a text is never
// translated twice). Needs the secrets TRANSLATE_API_URL and TRANSLATE_SECRET; without them,
// or if the site cannot be reached, it falls back to the old direct Claude call (logged).
import { fixTerms, learnedTerms, translateBrief } from "./editor.ts";

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
