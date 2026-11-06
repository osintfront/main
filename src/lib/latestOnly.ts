// For answers that may arrive out of order (two quick right-clicks): only the newest request's answer counts.
export const STALE: unique symbol = Symbol('stale');

export function latestOnly<T>(): (p: Promise<T>) => Promise<T | typeof STALE> {
  let latest = 0;
  return async (p) => {
    const mine = ++latest;
    try {
      const v = await p;
      return mine === latest ? v : STALE;
    } catch (e) {
      if (mine !== latest) return STALE;
      throw e;
    }
  };
}
