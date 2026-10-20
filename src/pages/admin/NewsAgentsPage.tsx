import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ExternalLink, Plus, RefreshCw, Rss, Trash2 } from 'lucide-react';
import { Alert, Spinner } from '@/components/common/Feedback';
import { Button, SelectField, TextField, ToggleField } from '@/components/common/Form';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import { usePermissions } from '@/hooks/usePermissions';
import { useI18n, type TranslationKey } from '@/i18n';
import { friendlyError } from '@/services/serviceError';
import {
  INTEL_AGENTS,
  addSource,
  deleteSource,
  fetchIntelAgents,
  fetchIntelItems,
  fetchIntelSources,
  getCrawlerSettings,
  setCrawlerEnabled,
  setSourceActive,
  type CrawlerSettings,
  type IntelAgent,
  type IntelAgentId,
  type IntelItem,
  type IntelSource,
} from '@/services/intelService';
import { formatDateTime } from '@/utils/time';
import { safeExternalUrl } from '@/utils/url';
import { cn } from '@/utils/cn';

const AGENT_KEYS: Record<IntelAgentId, TranslationKey> = {
  lebanon: 'agents.agent.lebanon',
  yemen: 'agents.agent.yemen',
  syria: 'agents.agent.syria',
  iran: 'agents.agent.iran',
  international: 'agents.agent.international',
  research: 'agents.agent.research',
};

const ITEM_STATUS: Record<string, TranslationKey> = {
  published: 'agents.item.published',
  duplicate: 'agents.item.duplicate',
  error: 'agents.item.error',
};

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function SourceState({ s }: { s: IntelSource }) {
  const { t } = useI18n();
  if (!s.active) return <span className="text-xs text-slate-400">{t('agents.state.off')}</span>;
  if (!s.lastRunAt) return <span className="text-xs text-slate-500">{t('agents.state.pending')}</span>;
  if (s.lastError)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400" title={s.lastError}>
        <AlertTriangle className="size-3.5" aria-hidden />
        {t('agents.state.blocked')}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 className="size-3.5" aria-hidden />
      {s.feedUrl ? t('agents.state.feed') : t('agents.state.page')}
    </span>
  );
}

export function NewsAgentsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { can } = usePermissions();
  const canManage = can('settings.manage');

  const [agents, setAgents] = useState<IntelAgent[]>([]);
  const [sources, setSources] = useState<IntelSource[]>([]);
  const [items, setItems] = useState<IntelItem[]>([]);
  const [settings, setSettings] = useState<CrawlerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<IntelSource | null>(null);
  const [form, setForm] = useState<{ agent: IntelAgentId; url: string; name: string }>({ agent: 'lebanon', url: '', name: '' });

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [a, s, i, st] = await Promise.all([fetchIntelAgents(), fetchIntelSources(), fetchIntelItems(), getCrawlerSettings()]);
      setAgents(a);
      setSources(s);
      setItems(i);
      setSettings(st);
    } catch (err) {
      setLoadError(friendlyError(err, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const byAgent = useMemo(() => {
    const m = new Map<IntelAgentId, IntelSource[]>();
    INTEL_AGENTS.forEach((a) => m.set(a, []));
    sources.forEach((s) => m.get(s.agent)?.push(s));
    return m;
  }, [sources]);

  const toggleCrawler = async (enabled: boolean) => {
    if (!settings) return;
    setBusy('crawler');
    try {
      await setCrawlerEnabled(settings, enabled);
      setSettings({ enabled, raw: { ...settings.raw, enabled } });
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const toggleSource = async (s: IntelSource, active: boolean) => {
    setBusy(s.id);
    try {
      await setSourceActive(s.id, active);
      setSources((list) => list.map((x) => (x.id === s.id ? { ...x, active } : x)));
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const onAdd = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('add');
    try {
      await addSource(form.agent, form.url, form.name);
      toast.success(t('agents.added'));
      setForm((f) => ({ ...f, url: '', name: '' }));
      await load();
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
      await deleteSource(toDelete.id);
      setSources((list) => list.filter((x) => x.id !== toDelete.id));
      toast.success(t('agents.deleted'));
      setToDelete(null);
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Spinner label={t('common.loading')} />;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('admin.nav.newsAgents')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">{t('agents.intro')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          <RefreshCw className="size-3.5" aria-hidden />
          {t('agents.refresh')}
        </Button>
      </header>

      {loadError ? <Alert tone="error" className="mb-4">{loadError}</Alert> : null}

      {settings ? (
        <section className="mb-5 rounded-xl bg-white p-4 ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
          <ToggleField
            label={t('agents.enabled')}
            description={t('agents.schedule', {
              day: String(settings.raw.day_interval_min ?? 30),
              night: String(settings.raw.night_interval_min ?? 60),
              start: String(settings.raw.day_start_hour ?? 7),
              end: String(settings.raw.day_end_hour ?? 23),
            })}
            checked={settings.enabled}
            disabled={!canManage || busy === 'crawler'}
            onChange={(v) => void toggleCrawler(v)}
          />
        </section>
      ) : null}

      <div className="grid gap-5">
        {agents.map((a) => {
          const list = byAgent.get(a.agent) ?? [];
          const r = a.lastResult;
          return (
            <section key={a.agent} className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  {t(AGENT_KEYS[a.agent])}
                  <span className="ms-2 text-xs font-normal text-slate-500">{t('agents.sourcesCount', { count: String(list.length) })}</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {a.lastRunAt
                    ? t('agents.lastRun', {
                        time: formatDateTime(a.lastRunAt, locale),
                        published: String(r.published ?? 0),
                        duplicates: String(r.duplicates ?? 0),
                        fresh: String(r.new_items ?? 0),
                      })
                    : t('agents.neverRun')}
                </p>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {list.map((s) => {
                  const href = safeExternalUrl(s.url);
                  return (
                    <li key={s.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5', !s.active && 'opacity-60')}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {s.feedUrl ? <Rss className="size-3.5 shrink-0 text-orange-500" aria-label={t('agents.state.feed')} /> : null}
                          <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{s.name || host(s.url)}</span>
                          {href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-sky-600" aria-label={t('agents.openSite')}>
                              <ExternalLink className="size-3.5" aria-hidden />
                            </a>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                          {host(s.url)}
                          {s.lastError ? ` · ${s.lastError}` : ''}
                        </p>
                      </div>
                      <SourceState s={s} />
                      <span className="w-20 text-end text-xs tabular-nums text-slate-500" title={t('agents.eventsCreated')}>
                        {t('agents.eventsShort', { count: String(s.eventsCreated) })}
                      </span>
                      {canManage ? (
                        <div className="flex items-center gap-2">
                          <ToggleField
                            label={t('agents.active')}
                            checked={s.active}
                            disabled={busy === s.id}
                            onChange={(v) => void toggleSource(s, v)}
                          />
                          <button
                            type="button"
                            onClick={() => setToDelete(s)}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                            aria-label={t('agents.delete')}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {canManage ? (
        <form onSubmit={onAdd} className="mt-5 rounded-xl bg-white p-4 ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
          <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">{t('agents.addTitle')}</h2>
          <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,14rem)_auto] sm:items-end">
            <SelectField
              label={t('agents.agentLabel')}
              value={form.agent}
              onChange={(e) => setForm((f) => ({ ...f, agent: e.target.value as IntelAgentId }))}
              options={INTEL_AGENTS.map((a) => ({ value: a, label: t(AGENT_KEYS[a]) }))}
            />
            <TextField
              label={t('agents.urlLabel')}
              type="url"
              dir="ltr"
              required
              placeholder="https://"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            />
            <TextField
              label={t('agents.nameLabel')}
              value={form.name}
              maxLength={200}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <Button type="submit" loading={busy === 'add'} disabled={!form.url.trim()}>
              <Plus className="size-4" aria-hidden />
              {t('agents.add')}
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('agents.addHint')}</p>
        </form>
      ) : null}

      <section className="mt-5 overflow-hidden rounded-xl bg-white ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
        <h2 className="border-b border-slate-100 px-4 py-3 text-base font-semibold text-slate-900 dark:border-slate-800 dark:text-white">
          {t('agents.recent')}
        </h2>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">{t('agents.recentEmpty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((it) => {
              const href = safeExternalUrl(it.url);
              return (
                <li key={it.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                      it.status === 'published' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
                      it.status === 'duplicate' && 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
                      it.status === 'error' && 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
                    )}
                    title={it.reason ?? undefined}
                  >
                    {ITEM_STATUS[it.status] ? t(ITEM_STATUS[it.status]) : it.status}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-100" dir="auto">
                    {it.title}
                  </span>
                  <span className="text-xs text-slate-500">{formatDateTime(it.createdAt, locale)}</span>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-sky-700 hover:underline dark:text-sky-400">
                      {host(it.url)}
                    </a>
                  ) : null}
                  {it.eventId ? (
                    <Link to={`/admin/events/${it.eventId}`} className="text-xs font-semibold text-sky-700 hover:underline dark:text-sky-400">
                      {t('agents.openEvent')}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={!!toDelete}
        title={t('agents.deleteTitle')}
        body={t('agents.deleteBody', { name: toDelete?.name || host(toDelete?.url ?? '') })}
        confirmLabel={t('agents.delete')}
        tone="danger"
        busy={busy === 'delete'}
        onConfirm={() => void onDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
