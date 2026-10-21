import { useCallback, useState } from 'react';
import type { Eei } from '@/lib/eei';

/**
 * The visitor's saved צי"ח (EEI) queries. Kept in this browser (localStorage);
 * if storage is blocked they last for the page only. Which ones are switched
 * on lives in the filters (EventFilters.eeis), like any other filter.
 */
const KEY = 'ofm.eeis.v1';

function load(): Eei[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw
          .filter((x) => x && typeof x.id === 'string' && typeof x.query === 'string')
          .map((x) => ({ id: x.id, name: String(x.name ?? ''), query: x.query }))
          .slice(0, 50)
      : [];
  } catch {
    return [];
  }
}

function save(list: Eei[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: keep in memory */
  }
}

export function useEeis() {
  const [eeis, setEeis] = useState<Eei[]>(load);

  const update = useCallback((fn: (list: Eei[]) => Eei[]) => {
    setEeis((prev) => {
      const next = fn(prev);
      save(next);
      return next;
    });
  }, []);

  const add = useCallback(
    (name: string, query: string): string => {
      const id = `eei-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      update((list) => [...list, { id, name: name.trim().slice(0, 60), query: query.trim().slice(0, 500) }]);
      return id;
    },
    [update],
  );
  const edit = useCallback(
    (id: string, name: string, query: string) =>
      update((list) => list.map((e) => (e.id === id ? { ...e, name: name.trim().slice(0, 60), query: query.trim().slice(0, 500) } : e))),
    [update],
  );
  const remove = useCallback((id: string) => update((list) => list.filter((e) => e.id !== id)), [update]);

  return { eeis, add, edit, remove };
}
