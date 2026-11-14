import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n, type TranslationKey } from '@/i18n';
import { toVtt } from '@/lib/mediaOverlay';
import type { Segment } from '@/lib/mediaReading';

/**
 * The event's video as today, plus — when the saved reading has timed lines — translated subtitles
 * (a WebVTT track built in the browser from the saved lines) and an on / off switch. The video file
 * is never changed.
 */
export function SubtitledVideo({ src, poster, autoPlay, preload, aspect, maxHeight, segments }: {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  preload?: 'none' | 'metadata';
  aspect: string;
  maxHeight: number;
  segments: Segment[];
}) {
  const { t, lang } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(true);
  const vtt = useMemo(() => toVtt(segments, lang), [segments, lang]);
  // Made and revoked in one effect (StrictMode-safe: a revoked address is never left on the track).
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!vtt) return setUrl(null);
    const u = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [vtt]);
  // The browser draws the cues; the switch only changes the track's mode.
  useEffect(() => {
    const tt = video.current?.textTracks?.[0];
    if (tt) tt.mode = on ? 'showing' : 'disabled';
  }, [on, url]);
  return (
    <div>
      <video
        ref={video}
        src={src}
        poster={poster}
        controls
        autoPlay={autoPlay}
        preload={preload}
        playsInline
        className="w-full rounded-lg bg-black"
        style={{ aspectRatio: aspect, maxHeight }}
      >
        {url ? <track key={url} kind="subtitles" src={url} srcLang={lang} label={t(`mt.subsLabel.${lang === 'he' ? 'he' : 'en'}` as TranslationKey)} default /> : null}
      </video>
      {url ? (
        <button
          type="button"
          data-sub-toggle
          aria-pressed={on}
          onClick={() => setOn((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
        >
          {t('mt.subs')}: {on ? '✓' : '—'}
        </button>
      ) : null}
    </div>
  );
}
