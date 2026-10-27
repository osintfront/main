/**
 * The words that changed between two versions of a sentence: the span left after removing
 * the common words at the start and the end. Used to offer "learn this term" after a fix
 * ("sweep fire at Zawtar" → "automatic fire at Zawtar" gives "sweep fire" → "automatic fire").
 * null when nothing changed, or when the change is too long to be one term.
 */
export function changedPhrase(before: string, after: string, maxWords = 5): { from: string; to: string } | null {
  const words = (s: string) => s.replace(/[.,;:!?"'()«»“”]/g, ' ').split(/\s+/).filter(Boolean);
  const a = words(before);
  const b = words(after);
  const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
  let start = 0;
  while (start < a.length && start < b.length && same(a[start], b[start])) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && same(a[endA - 1], b[endB - 1])) {
    endA--;
    endB--;
  }
  // One changed word ("sweep" → "automatic") is usually part of a term ("sweep fire"):
  // take the next word along (else the previous one) so the lesson is not a bare word.
  if (endA - start === 1 && endB - start === 1) {
    if (endA < a.length) {
      endA++;
      endB++;
    } else if (start > 0) start--;
  }
  const from = a.slice(start, endA);
  const to = b.slice(start, endB);
  if (!from.length || !to.length || from.length > maxWords || to.length > maxWords) return null;
  return { from: from.join(' '), to: to.join(' ') };
}
