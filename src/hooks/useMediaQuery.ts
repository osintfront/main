import { useEffect, useState } from 'react';

function matches(query: string): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.(query).matches ?? false);
}

/** True while the media query matches; follows rotation and window resizes. */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const onChange = () => setValue(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return value;
}

/** Phones and small tablets: one pane at a time (matches Tailwind's `lg` breakpoint). */
export const PHONE_QUERY = '(max-width: 1023.98px)';
