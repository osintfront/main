import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, Loader2, Radar, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/i18n';
import { effectivePlan } from '@/lib/plans';
import type { LatLng } from '@/lib/eventFilters';
import { pollSocialSearch, startSocialSearch, type SocialPlatform, type SocialSearch as Search } from '@/services/socialSearchService';

const NETS: SocialPlatform[] = ['x', 'facebook', 'instagram', 'tiktok'];
const NET_LABEL: Record<SocialPlatform, string> = { x: 'X', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };

/** "Intel" plan + staff: search social networks for the area drawn on the map. */
export function SocialSearchButton({ polygon }: { polygon: LatLng[] | null }) {
  const { profile } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const allowed = !!profile && profile.status === 'active' && (profile.role !== 'viewer' || effectivePlan(profile) === 'intel');
  if (!allowed || !polygon) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute bottom-[4.25rem] end-3 z-[600] inline-flex h-9 items-center gap-1.5 rounded-full bg-violet-600 px-3.5 text-sm font-semibold text-white shadow-lg ring-1 ring-violet-700/30 hover:bg-violet-500 focus-visible:ring-2 focus-visible:ring-violet-300"
      >
        <Radar className="size-4" aria-hidden />
        {t('social.button')}
      </button>
      {open ? <SocialPanel polygon={polygon} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SocialPanel({ polygon, onClose }: { polygon: LatLng[]; onClose: () => void }) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const [hours, setHours] = useState(24);
  const [words, setWords] = useState('');
  const [search, setSearch] = useState<Search | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const polls = useRef(0);

  const running = !!search && NETS.some((n) => search.runs[n]?.status === 'running');
  useEffect(() => {
    if (!search || !running || polls.current > 50) return;
    const id = window.setTimeout(() => {
      polls.current += 1;
      pollSocialSearch(search.id).then(setSearch).catch(() => undefined);
    }, 6000);
    return () => window.clearTimeout(id);
  }, [search, running]);

  const go = async () => {
    setBusy(true);
    setError(null);
    polls.current = 0;
    try {
      const terms = words.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
      setSearch(await startSocialSearch(polygon, hours, terms.length ? terms : null));
    } catch (e) {
      const code = (e as Error).message;
      setError(t(code === 'no_places' ? 'social.noPlaces' : code === 'daily_limit' ? 'social.limit' : code === 'not_allowed' ? 'social.notAllowed' : 'social.failed'));
    } finally {
      setBusy(false);
    }
  };

  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '');
  const runLabel = (n: SocialPlatform) => {
    const r = search?.runs[n];
    if (!r) return '';
    return t(r.status === 'running' ? 'social.running' : r.status === 'done' ? 'social.done' : r.status === 'off' ? 'social.off' : 'social.error');
  };

  return (
    <div className="fixed inset-0 z-[3000] flex justify-end" role="presentation">
      <div className="absolute inset-0 bg-slate-950/40" onClick={onClose} aria-hidden />
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-slate-900">
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white"><Radar className="size-4 text-violet-600" aria-hidden />{t('social.title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="size-4" aria-hidden /></button>
        </header>
        <div className="space-y-3 border-b border-slate-200 p-4 text-sm dark:border-slate-800">
          <p className="text-slate-600 dark:text-slate-300">{t('social.body')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
              {t('social.hours')}
              <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                <option value={6}>6</option><option value={24}>24</option><option value={72}>72</option><option value={168}>168</option>
              </select>
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
              {t('social.words')}
              <input value={words} onChange={(e) => setWords(e.target.value)} name="social-words" autoComplete="off" placeholder={t('social.wordsPlaceholder')} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </label>
            <button type="button" onClick={() => void go()} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-violet-600 px-4 font-semibold text-white hover:bg-violet-500 disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}{busy ? t('social.searching') : t('social.search')}
            </button>
          </div>
          {error ? <p className="text-red-600 dark:text-red-400" aria-live="polite">{error}</p> : null}
          {search ? (
            <div className="space-y-1">
              {search.places.length ? <p className="text-xs text-slate-500 dark:text-slate-400">{t('social.places', { places: search.places.slice(0, 6).join(', ') })}</p> : null}
              <div className="flex flex-wrap gap-1.5" aria-live="polite">
                {NETS.map((n) => (
                  <span key={n} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">{NET_LABEL[n]}: {runLabel(n)}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <ul className="ofm-scroll min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto overscroll-contain dark:divide-slate-800">
          {search && !search.results.length && !running ? <li className="p-4 text-sm text-slate-500">{t('social.empty')}</li> : null}
          {search?.results.map((r) => (
            <li key={`${r.platform}-${r.post_id}`} className="space-y-1.5 p-4 text-sm">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-violet-700 dark:text-violet-300">{NET_LABEL[r.platform]}</span>
                <span className="tabular-nums">{fmt(r.posted_at)}</span>
              </div>
              {r.author ? <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{r.author}</p> : null}
              {r.text ? <p dir="auto" className="line-clamp-4 break-words text-slate-800 dark:text-slate-100">{r.text}</p> : null}
              {r.media[0]?.preview ? (
                <img src={r.media[0].preview} alt="" width={320} height={180} loading="lazy" referrerPolicy="no-referrer" className="h-40 w-full rounded-lg bg-slate-100 object-cover dark:bg-slate-800" />
              ) : null}
              {r.url ? (
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline dark:text-sky-400">
                  <ExternalLink className="size-3.5" aria-hidden />{t('social.open')}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">{t('social.note')}</p>
      </section>
    </div>
  );
}
