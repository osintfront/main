import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { AD_CLIENT, FEED_AD } from '@/lib/ads';

/**
 * One AdSense in-feed unit between feed cards. Clearly labelled "Advertisement" and framed
 * differently from an event card (Google: ads must not look like site content).
 * The ad is requested only when the slot comes near the screen (the feed has hundreds of cards).
 */
export function FeedAd() {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const pushed = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near || pushed.current) return;
    pushed.current = true;
    try {
      ((window as unknown as { adsbygoogle?: unknown[] }).adsbygoogle ??= []).push({});
    } catch {
      /* blocked by an ad blocker: the frame stays empty */
    }
  }, [near]);

  return (
    <aside ref={box} aria-label={t('ad.label')} data-feed-ad className="mx-3 my-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/60">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('ad.label')}</span>
      {near ? (
        <ins
          className="adsbygoogle block bg-white"
          style={{ display: 'block' }}
          data-ad-format="fluid"
          data-ad-layout-key={FEED_AD.layoutKey}
          data-ad-client={AD_CLIENT}
          data-ad-slot={FEED_AD.slot}
        />
      ) : (
        <div className="h-24" />
      )}
    </aside>
  );
}
