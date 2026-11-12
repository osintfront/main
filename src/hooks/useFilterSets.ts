import { useCallback, useState } from 'react';
import { sanitizeSets, type FilterSet } from '@/lib/filterSets';

/**
 * The visitor's filter sets, kept in this browser (localStorage). Whatever is stored is cleaned
 * (sanitizeSets); if storage is blocked the sets last for the page only.
 */
const KEY = 'ofm.filterSets.v1';

function load(): FilterSet[] {
  try {
    return sanitizeSets(JSON.parse(window.localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return [];
  }
}

function save(list: FilterSet[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: keep in memory */
  }
}

export function useFilterSets() {
  const [sets, setState] = useState<FilterSet[]>(load);
  const setSets = useCallback((next: FilterSet[] | ((prev: FilterSet[]) => FilterSet[])) => {
    setState((prev) => {
      const out = typeof next === 'function' ? next(prev) : next;
      if (out !== prev) save(out);
      return out;
    });
  }, []);
  return { sets, setSets };
}
