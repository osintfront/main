import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pollWhileVisible } from '@/lib/visiblePoll';
import { EMPTY_VIEW, lastAt, mergeTags, sanitizeEeiView, theatresOn, type EeiList, type EeiTags, type EeiView } from '@/lib/eeiLens';
import { clearEei, fetchMyList, fetchMyTags, saveEei } from '@/services/eeiService';

/**
 * The signed-in user's EEI list (צי"ח) and the AI's marks for it. The list lives on the server; which
 * theatres / topics are switched off is kept in this browser (ofm.eeiView.v1). Marks are fetched at
 * start, when refreshKey changes (live events reloaded) and every 60 s while a theatre is on — only
 * rows newer than the last one seen.
 */
const VIEW_KEY = 'ofm.eeiView.v1';
const NO_TAGS: EeiTags = new Map();

function loadView(): EeiView {
  try {
    return sanitizeEeiView(JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? 'null'));
  } catch {
    return EMPTY_VIEW;
  }
}

export function useEeiList(enabled: boolean, refreshKey: unknown) {
  const [list, setList] = useState<EeiList | null>(null);
  const [rawText, setRawText] = useState('');
  const [prev, setPrev] = useState<{ rawText: string; list: EeiList } | null>(null);
  const [tags, setTags] = useState<EeiTags>(NO_TAGS);
  const [degraded, setDegraded] = useState(false);
  const [view, setViewState] = useState<EeiView>(loadView);
  const afterRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  /** Bumped when the list changes: an answer for the old list is dropped, and a pull is allowed again. */
  const genRef = useRef(0);

  const setView = useCallback((v: EeiView) => {
    setViewState(v);
    try {
      window.localStorage.setItem(VIEW_KEY, JSON.stringify(v));
    } catch {
      /* storage blocked */
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setList(null);
      return;
    }
    let alive = true;
    void fetchMyList().then((r) => {
      if (!alive || !r) return;
      setList(r.list);
      setRawText(r.rawText);
      setPrev(r.prevList ? { rawText: r.prevRawText, list: r.prevList } : null);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  const hashes = useMemo(() => (list?.theatres ?? []).map((t) => t.hash).filter(Boolean).join(','), [list]);
  const pull = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const gen = genRef.current;
    try {
      // The server answers at most 5,000 rows a time: keep reading while a page comes back full.
      for (let page = 0; page < 10; page++) {
        const r = await fetchMyTags(afterRef.current);
        if (gen !== genRef.current) return;
        const before = afterRef.current;
        afterRef.current = lastAt(r.tags, afterRef.current);
        setDegraded(r.degraded);
        if (r.tags.length) setTags((old) => mergeTags(old, r.tags));
        if (r.tags.length < 5000 || afterRef.current === before) break;
      }
    } finally {
      if (gen === genRef.current) busyRef.current = false;
    }
  }, []);

  // A different list starts the marks from scratch.
  useEffect(() => {
    genRef.current++;
    busyRef.current = false;
    afterRef.current = null;
    setTags(NO_TAGS);
  }, [hashes]);

  const anyOn = enabled && theatresOn(list, view).length > 0;
  useEffect(() => {
    if (!anyOn) return;
    void pull();
  }, [anyOn, pull, refreshKey, hashes]);
  useEffect(() => {
    if (!anyOn) return;
    // Not while the tab is hidden; coming back reads at once.
    return pollWhileVisible(() => void pull(), 60_000);
  }, [anyOn, pull]);

  const save = useCallback(async (text: string, next: EeiList) => {
    const saved = await saveEei(text, next);
    setPrev((p) => (list && JSON.stringify(list) !== JSON.stringify(saved) ? { rawText, list } : p));
    setList(saved);
    setRawText(text);
    setViewState((v) => {
      const next = { ...v, off: [] };
      try {
        window.localStorage.setItem(VIEW_KEY, JSON.stringify(next));
      } catch {
        /* storage blocked */
      }
      return next;
    });
  }, [list, rawText]);

  const clear = useCallback(async () => {
    await clearEei();
    if (list) setPrev({ rawText, list });
    setList(null);
    setRawText('');
  }, [list, rawText]);

  const restore = useCallback(async () => {
    if (prev) await save(prev.rawText, prev.list);
  }, [prev, save]);

  return { list, rawText, prev, tags, degraded, view, setView, save, clear, restore };
}
