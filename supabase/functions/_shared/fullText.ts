// Pieces of a long text for the translation chain (no Deno APIs: unit-tested under Node).

/** At most `max` pieces of ≤maxChars: paragraphs (blank-line separated), short ones joined. */
export function fullTextPieces(text: string, max = 20, maxChars = 4500): string[] {
  const paras = text.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  const target = Math.max(1, Math.ceil(paras.length / max));
  for (let i = 0; i < paras.length; i += target) out.push(paras.slice(i, i + target).join("\n\n").slice(0, maxChars));
  return out.slice(0, max);
}
