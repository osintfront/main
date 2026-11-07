import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Lock, Mountain, RefreshCw, ScanSearch, Video } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { hasFeature, usePlanVersion } from '@/lib/plans';
import { openGate } from '@/components/plans/GateDialog';
import { useToast } from '@/components/common/Toast';
import {
  fetchGeolocation, GeolocRequestError, proofUrl, requestGeolocation, reviewGeolocation, type GeolocResult,
} from '@/services/geolocationService';
import { loadEventMedia } from '@/services/eventMediaService';

const POLL_MS = 15_000;
const fmt = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

/**
 * Terrain geolocation in the event window (Max / Intel). Shows the located
 * target with its proof board, lets a subscriber ask for a run, and gives staff
 * the review controls. The camera point is shown only to staff, or to
 * subscribers after staff release it — it is where a person stood filming.
 */
export function EventGeolocation({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const { profile } = useAuth();
  const { can } = usePermissions();
  const toast = useToast();
  usePlanVersion();
  const staff = can('event.edit.any');
  const allowed = !!profile && hasFeature(profile, 'geolocation');
  const [rows, setRows] = useState<GeolocResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [board, setBoard] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Only events with a photo or video thumbnail can be geolocated (same cached load as EventMedia).
  const [hasMedia, setHasMedia] = useState(false);
  useEffect(() => {
    let live = true;
    loadEventMedia(eventId)
      .then((items) => live && setHasMedia(items.some((m) => m.kind === 'image' || m.kind === 'video_thumb')))
      .catch(() => undefined);
    return () => { live = false; };
  }, [eventId]);

  const load = useCallback(async () => {
    try {
      setRows(await fetchGeolocation(eventId));
    } catch {
      setRows([]);
    }
  }, [eventId]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const job = rows?.[0] ?? null;
  const pending = job && (job.status === 'queued' || job.status === 'running');

  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
  }, [pending, load]);

  // Proof board: the full one (with camera) when this viewer may see it, otherwise the one without.
  useEffect(() => {
    setBoard(null);
    const path = job?.proofFull ?? job?.proofTarget;
    if (path) proofUrl(path).then(setBoard).catch(() => setBoard(null));
  }, [job?.proofFull, job?.proofTarget]);

  if (!hasMedia) return null;

  if (!allowed) {
    return (
      <button
        type="button"
        onClick={() => openGate(profile ? 'upgrade' : 'signup')}
        className="mt-4 flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-start text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/50"
      >
        <Lock className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{t('geoloc.locked')}</span>
        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">MAX</span>
      </button>
    );
  }

  const ask = async () => {
    setBusy(true);
    try {
      await requestGeolocation(eventId);
      toast.success(t('geoloc.queued'));
      await load();
    } catch (err) {
      const r = err instanceof GeolocRequestError ? err.reason : 'other';
      if (r === 'plan') openGate('upgrade');
      else toast.error(t(r === 'limit' ? 'geoloc.limit' : r === 'no_media' ? 'geoloc.noMedia' : 'geoloc.error'));
    } finally {
      setBusy(false);
    }
  };

  const review = async (opts: Parameters<typeof reviewGeolocation>[1]) => {
    if (!job) return;
    setBusy(true);
    try {
      await reviewGeolocation(job.id, opts);
      await load();
    } catch {
      toast.error(t('geoloc.error'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked: the text is on screen anyway */
    }
  };

  const confTone = job?.confidence === 'high'
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'
    : job?.confidence === 'medium'
      ? 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300'
      : 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300';

  const coordRow = (key: string, label: string, lat: number, lng: number, extra?: string) => (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <bdi className="font-mono text-sm tabular-nums text-slate-800 dark:text-slate-100" dir="ltr">{fmt(lat, lng)}</bdi>
      <button type="button" onClick={() => copy(key, fmt(lat, lng))} aria-label={t('geoloc.copy')}
        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
        {copied === key ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </button>
      {extra ? <span className="min-w-0 truncate text-xs text-slate-500 dark:text-slate-400">{extra}</span> : null}
    </div>
  );

  return (
    <section aria-labelledby="event-geoloc-title" className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
      <div className="mb-2 flex items-center gap-2">
        <Mountain className="size-4 text-slate-500" aria-hidden />
        <h3 id="event-geoloc-title" className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t('geoloc.title')}
        </h3>
        {job?.confidence && (job.status === 'done' || staff) ? (
          <span className={`rounded px-1.5 py-px text-[10px] font-bold uppercase ${confTone}`}>{t(`geoloc.conf.${job.confidence}`)}</span>
        ) : null}
        {staff && job ? <span className="ms-auto text-[11px] text-slate-400">{t(`geoloc.status.${job.status}`)}</span> : null}
      </div>

      {rows === null ? (
        <p className="text-sm text-slate-500">{t('geoloc.loading')}</p>
      ) : pending ? (
        <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <RefreshCw className="size-4 animate-spin" aria-hidden />
          {t('geoloc.running')}
        </p>
      ) : job && (staff || job.status === 'done') ? (
        <div className="space-y-2">
          {job.targetLat != null && job.targetLng != null
            ? coordRow('t', t('geoloc.target'), job.targetLat, job.targetLng, job.targetLabel ?? undefined)
            : job.status === 'done' ? <p className="text-sm text-slate-600 dark:text-slate-300">{t('geoloc.noTarget')}</p> : null}
          {job.cameraLat != null && job.cameraLng != null ? (
            coordRow('c', t('geoloc.camera'), job.cameraLat, job.cameraLng,
              job.cameraHeading != null ? t('geoloc.heading', { deg: job.cameraHeading.toFixed(1) }) : undefined)
          ) : job.status === 'done' ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><Video className="size-3.5" aria-hidden />{t('geoloc.cameraWithheld')}</p>
          ) : null}
          {job.fitRmsPx != null ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('geoloc.fit', { fit: job.fitRmsPx.toFixed(1), hold: (job.holdoutRmsPx ?? 0).toFixed(1) })}
            </p>
          ) : null}
          {job.notes.length ? (
            <ul className="list-inside list-disc text-xs text-amber-700 dark:text-amber-300">
              {job.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          ) : null}
          {board ? (
            <a href={board} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
              <img src={board} alt={t('geoloc.board')} className="max-h-72 w-full object-cover object-top" loading="lazy" />
            </a>
          ) : null}
          <p className="text-[11px] leading-snug text-slate-400">{t('geoloc.caveat')}</p>
          {staff ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {job.status !== 'done' && job.status !== 'skipped' && job.status !== 'failed' ? (
                <button type="button" disabled={busy} onClick={() => review({ status: 'done' })} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {t('geoloc.approve')}
                </button>
              ) : null}
              {job.cameraLat != null && !job.cameraReleased ? (
                <button type="button" disabled={busy} onClick={() => review({ releaseCamera: true })} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  {t('geoloc.release')}
                </button>
              ) : null}
              {job.status !== 'skipped' ? (
                <button type="button" disabled={busy} onClick={() => review({ status: 'skipped' })} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  {t('geoloc.reject')}
                </button>
              ) : null}
              <button type="button" disabled={busy} onClick={() => review({ status: 'queued' })} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                {t('geoloc.rerun')}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-slate-600 dark:text-slate-300">{t('geoloc.none')}</p>
          <button type="button" disabled={busy} onClick={ask}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
            <ScanSearch className="size-3.5" aria-hidden />
            {t('geoloc.request')}
          </button>
        </div>
      )}
    </section>
  );
}
