interface Doc {
  hidden: boolean;
  addEventListener(type: 'visibilitychange', f: () => void): void;
  removeEventListener(type: 'visibilitychange', f: () => void): void;
}
interface Win {
  setInterval(f: () => void, ms: number): number;
  clearInterval(id: number): void;
}

/** Run `fn` every `ms` while the tab is shown; a hidden tab skips, and coming back runs it at once. Returns stop. */
export function pollWhileVisible(fn: () => void, ms: number, doc: Doc = document, win: Win = window): () => void {
  const id = win.setInterval(() => {
    if (!doc.hidden) fn();
  }, ms);
  const onVis = () => {
    if (!doc.hidden) fn();
  };
  doc.addEventListener('visibilitychange', onVis);
  return () => {
    win.clearInterval(id);
    doc.removeEventListener('visibilitychange', onVis);
  };
}
