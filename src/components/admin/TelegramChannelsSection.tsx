import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Plus, Send, Trash2 } from 'lucide-react';
import { Button, TextField, ToggleField } from '@/components/common/Form';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import { usePermissions } from '@/hooks/usePermissions';
import { useI18n, type TranslationKey } from '@/i18n';
import { friendlyError } from '@/services/serviceError';
import {
  addTelegramChannel,
  deleteTelegramChannel,
  fetchTelegramChannels,
  setTelegramChannelActive,
  telegramUsername,
  type TelegramChannel,
} from '@/services/intelService';
import { formatDateTime } from '@/utils/time';
import { cn } from '@/utils/cn';

const REGION_ORDER = ['israel', 'palestine', 'lebanon', 'syria', 'iraq', 'iran', 'yemen', 'jordan', 'egypt', 'gulf', 'regional', 'international', 'unknown'];

/** Public Telegram channels read every minute into the same pipeline as the WhatsApp feed, grouped by region. */
export function TelegramChannelsSection() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { can } = usePermissions();
  const canManage = can('settings.manage');
  const [channels, setChannels] = useState<TelegramChannel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<TelegramChannel | null>(null);

  const load = useCallback(async () => {
    try {
      setChannels(await fetchTelegramChannels());
      setError(null);
    } catch (err) {
      setError(friendlyError(err, t));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!telegramUsername(input)) {
      toast.error(t('telegram.invalid'));
      return;
    }
    setBusy('add');
    try {
      await addTelegramChannel(input);
      setInput('');
      toast.success(t('telegram.added'));
      await load();
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (c: TelegramChannel, active: boolean) => {
    setBusy(c.username);
    try {
      await setTelegramChannelActive(c.username, active);
      setChannels((list) => list.map((x) => (x.username === c.username ? { ...x, active } : x)));
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    if (!toDelete) return;
    setBusy('delete');
    try {
      await deleteTelegramChannel(toDelete.username);
      setChannels((list) => list.filter((x) => x.username !== toDelete.username));
      toast.success(t('agents.deleted'));
      setToDelete(null);
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-5 overflow-hidden rounded-xl bg-white ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
      <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
          <Send className="size-4 text-sky-500" aria-hidden />
          {t('telegram.title')}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('telegram.body')}</p>
      </div>
      {error ? <p className="px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {channels.length === 0 && !error ? <p className="px-4 py-4 text-sm text-slate-500">{t('telegram.empty')}</p> : null}
      {REGION_ORDER.map((region) => {
        const list = channels.filter((c) => (c.region ?? 'unknown') === region);
        if (!list.length) return null;
        const on = list.filter((c) => c.active).length;
        return (
          <details key={region} className="group border-b border-slate-100 dark:border-slate-800" open={on > 0}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800/50">
              <span className="inline-block transition-transform group-open:rotate-90 rtl:-scale-x-100" aria-hidden>
                ›
              </span>
              {t(`telegram.region.${region}` as TranslationKey)}
              <span className="text-xs font-normal text-slate-500">
                {t('telegram.regionCount', { count: list.length, on })}
              </span>
            </summary>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {list.map((c) => (
                <li key={c.username} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5', !c.active && 'opacity-60')}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100" dir="auto">
                          {c.title || c.username}
                        </span>
                        <a
                          href={`https://t.me/${c.username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-400 hover:text-sky-600"
                          aria-label={t('agents.openSite')}
                        >
                          <ExternalLink className="size-3.5" aria-hidden />
                        </a>
                      </div>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                        @{c.username}
                        {c.lastError ? ` · ${c.lastError}` : ''}
                      </p>
                    </div>
                    {!c.active ? (
                      <span className="text-xs text-slate-400">{t('agents.state.off')}</span>
                    ) : c.lastError ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400" title={c.lastError}>
                        <AlertTriangle className="size-3.5" aria-hidden />
                        {t('agents.state.blocked')}
                      </span>
                    ) : c.lastOkAt ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="size-3.5" aria-hidden />
                        {t('telegram.lastRead', { time: formatDateTime(c.lastOkAt, locale) })}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">{t('agents.state.pending')}</span>
                    )}
                    <span className="w-24 text-end text-xs tabular-nums text-slate-500">{t('telegram.postsSeen', { count: String(c.postsSeen) })}</span>
                    {canManage ? (
                      <div className="flex items-center gap-2">
                        <ToggleField label={t('agents.active')} checked={c.active} disabled={busy === c.username} onChange={(v) => void toggle(c, v)} />
                        <button
                          type="button"
                          onClick={() => setToDelete(c)}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                          aria-label={t('agents.delete')}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    ) : null}
                  </li>
              ))}
            </ul>
          </details>
        );
      })}
      {canManage ? (
        <form onSubmit={onAdd} className="flex flex-wrap items-end gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <TextField
              label={t('telegram.addLabel')}
              dir="ltr"
              placeholder="https://t.me/…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
          <Button type="submit" loading={busy === 'add'} disabled={!input.trim()}>
            <Plus className="size-4" aria-hidden />
            {t('agents.add')}
          </Button>
        </form>
      ) : null}
      <ConfirmDialog
        open={!!toDelete}
        title={t('agents.deleteTitle')}
        body={t('agents.deleteBody', { name: toDelete?.title || toDelete?.username || '' })}
        confirmLabel={t('agents.delete')}
        tone="danger"
        busy={busy === 'delete'}
        onConfirm={() => void onDelete()}
        onCancel={() => setToDelete(null)}
      />
    </section>
  );
}
