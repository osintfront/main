import { Lock } from 'lucide-react';
import type { EventTerm, Segment } from '@/lib/deepTerms';
import { hasFeature, usePlanVersion } from '@/lib/plans';
import { cn } from '@/utils/cn';

/**
 * Event text with its terms as links to their deep-analysis entry: a solid underline when the
 * entry exists, dotted when it is not written yet, a lock for readers without the feature.
 * Plain text only — never HTML. The parent works out `parts` (linkSegments / segmentsInOrder) in its own
 * render, so a term links once across the window's texts even when React renders twice.
 */
export function TermText({ parts, onTerm }: { parts: Segment[]; onTerm: (t: EventTerm) => void }) {
  usePlanVersion();
  const locked = !hasFeature(undefined, 'deep_analysis');
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          p
        ) : (
          <button
            key={`${p.term.key}-${i}`}
            type="button"
            data-term={p.term.key}
            data-ready={p.term.entry ? '1' : '0'}
            onClick={(e) => {
              e.stopPropagation();
              onTerm(p.term);
            }}
            className={cn(
              'relative inline cursor-pointer rounded-sm px-0 align-baseline font-[inherit] text-sky-700 underline underline-offset-2 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-sky-400 dark:hover:bg-sky-500/10',
              'after:absolute after:-inset-y-2 after:inset-x-0 after:content-[""]',
              p.term.entry ? 'decoration-solid' : 'decoration-dotted',
            )}
          >
            {p.text}
            {locked ? <Lock className="ms-0.5 inline size-3 align-[-1px] opacity-70" aria-hidden /> : null}
          </button>
        ),
      )}
    </>
  );
}
