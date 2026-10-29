import { useEffect, useState, type ReactNode } from 'react';
import { Bot, Database, KeyRound, Map as MapIcon, Send, ShieldCheck, Siren } from 'lucide-react';
import { ToggleField } from '@/components/common/Form';
import { useToast } from '@/components/common/Toast';
import { usePermissions } from '@/hooks/usePermissions';
import { friendlyError } from '@/services/serviceError';
import {
  getAiLimits,
  getAutoPublish,
  getReaderAiSpendToday,
  setAiSetting,
  type AiLimits,
  getHfcIngestStatus,
  getHfcSettings,
  setAutoPublish,
  setHfcEnabled,
  type AutoPublishSetting,
  type HfcIngestStatus,
  type HfcSettings,
} from '@/services/settingsService';
import { formatDateTime } from '@/utils/time';
import { authConfig } from '@/config/auth';
import { mapConfig } from '@/config/map';
import { supabaseHost } from '@/integrations/supabase/client';
import { useI18n } from '@/i18n';

function Row({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-slate-100 py-4 last:border-0 dark:border-slate-800">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>
        <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{children}</div>
      </div>
    </div>
  );
}

function AutoPublishRow() {
  const { t } = useI18n();
  const toast = useToast();
  const { can } = usePermissions();
  const [setting, setSetting] = useState<AutoPublishSetting | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getAutoPublish()
      .then((s) => alive && setSetting(s))
      .catch((err) => alive && setLoadError(friendlyError(err, t)));
    return () => {
      alive = false;
    };
  }, [t]);

  const toggle = async (enabled: boolean) => {
    if (!setting) return;
    const next = { ...setting, enabled };
    setSaving(true);
    try {
      await setAutoPublish(next);
      setSetting(next);
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Row icon={<Send className="size-[18px]" aria-hidden />} title={t('settings.autoPublish')}>
      <p>{t('settings.autoPublishBody')}</p>
      {loadError ? <p className="mt-2 text-red-600 dark:text-red-400">{loadError}</p> : null}
      {setting ? (
        <div className="mt-3">
          <ToggleField
            label={t('settings.autoPublishToggle')}
            description={t('settings.autoPublishSources', {
              sources: setting.sourcePrefixes.join(', ') || t('settings.none'),
            })}
            checked={setting.enabled}
            onChange={(v) => void toggle(v)}
            disabled={saving || !can('settings.manage')}
          />
        </div>
      ) : null}
    </Row>
  );
}

function HfcRow() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { can } = usePermissions();
  const [setting, setSetting] = useState<HfcSettings | null>(null);
  const [status, setStatus] = useState<HfcIngestStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      getHfcSettings()
        .then((s) => alive && setSetting(s))
        .catch((err) => alive && setLoadError(friendlyError(err, t)));
      getHfcIngestStatus()
        .then((s) => alive && setStatus(s))
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(() => getHfcIngestStatus().then((s) => alive && setStatus(s)).catch(() => undefined), 10_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [t]);

  const toggle = async (enabled: boolean) => {
    if (!setting) return;
    setSaving(true);
    try {
      await setHfcEnabled(setting, enabled);
      setSetting({ enabled, raw: { ...setting.raw, enabled } });
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const showError = status?.lastError && (!status.lastOkAt || (status.lastErrorAt ?? '') > status.lastOkAt);

  return (
    <Row icon={<Siren className="size-[18px]" aria-hidden />} title={t('settings.hfc')}>
      <p>{t('settings.hfcBody')}</p>
      {loadError ? <p className="mt-2 text-red-600 dark:text-red-400">{loadError}</p> : null}
      {setting ? (
        <div className="mt-3">
          <ToggleField
            label={t('settings.hfcToggle')}
            checked={setting.enabled}
            onChange={(v) => void toggle(v)}
            disabled={saving || !can('settings.manage')}
          />
        </div>
      ) : null}
      {status ? (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {status.lastOkAt ? t('settings.hfcStatus', { time: formatDateTime(status.lastOkAt, locale) }) : t('settings.hfcStatusNever')}
          {showError ? (
            <span className="ms-2 text-red-600 dark:text-red-400">{t('settings.hfcError', { error: status.lastError ?? '' })}</span>
          ) : null}
        </p>
      ) : null}
    </Row>
  );
}

function AiLimitsRow() {
  const { t } = useI18n();
  const toast = useToast();
  const { can } = usePermissions();
  const [limits, setLimits] = useState<AiLimits | null>(null);
  const [budget, setBudget] = useState('');
  const [spent, setSpent] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getAiLimits()
      .then((l) => {
        if (!alive) return;
        setLimits(l);
        setBudget(l.budgetUsd == null ? '' : String(l.budgetUsd));
      })
      .catch((err) => alive && setLoadError(friendlyError(err, t)));
    getReaderAiSpendToday()
      .then((s) => alive && setSpent(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [t]);

  const save = async (key: 'ai_limits_enabled' | 'ai_daily_budget_usd', value: boolean | number | null) => {
    setSaving(true);
    try {
      await setAiSetting(key, value);
      setLimits((l) => (l ? (key === 'ai_limits_enabled' ? { ...l, enabled: value === true } : { ...l, budgetUsd: value as number | null }) : l));
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const disabled = saving || !can('settings.manage');
  return (
    <Row icon={<Bot className="size-[18px]" aria-hidden />} title={t('settings.ai')}>
      <p>{t('settings.aiBody')}</p>
      {loadError ? <p className="mt-2 text-red-600 dark:text-red-400">{loadError}</p> : null}
      {limits ? (
        <div className="mt-3 space-y-3">
          <ToggleField label={t('settings.aiToggle')} checked={limits.enabled} onChange={(v) => void save('ai_limits_enabled', v)} disabled={disabled} />
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = budget.trim() === '' ? null : Number(budget);
              if (n !== null && (!Number.isFinite(n) || n < 0)) return;
              void save('ai_daily_budget_usd', n);
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
              {t('settings.aiBudget')}
              <input
                type="number"
                name="ai-budget"
                inputMode="decimal"
                min={0}
                step={1}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                disabled={disabled}
                autoComplete="off"
                className="h-9 w-32 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 tabular-nums focus-visible:ring-2 focus-visible:ring-sky-500/40 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>
            <button type="submit" disabled={disabled} className="h-9 rounded-lg bg-sky-600 px-3 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {t('settings.aiSave')}
            </button>
          </form>
          {spent != null ? <p className="text-xs text-slate-500 tabular-nums dark:text-slate-400">{t('settings.aiSpent', { spent: spent.toFixed(2) })}</p> : null}
        </div>
      ) : null}
    </Row>
  );
}

export function SettingsPage() {
  const { t } = useI18n();
  const roles = authConfig.requireMfaForRoles.map((r) => t(`role.${r}`)).join(', ') || t('settings.none');
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{t('settings.title')}</h1>
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white px-5 dark:border-slate-800 dark:bg-slate-900">
        <Row icon={<Database className="size-[18px]" aria-hidden />} title={t('settings.backend')}>
          {t('settings.connectedTo', { host: supabaseHost })}
        </Row>
        <HfcRow />
        <AutoPublishRow />
        <AiLimitsRow />
        <Row icon={<MapIcon className="size-[18px]" aria-hidden />} title={t('settings.mapProvider')}>
          {t('settings.mapProviderBody', { provider: mapConfig.provider })}
        </Row>
        <Row icon={<KeyRound className="size-[18px]" aria-hidden />} title={t('settings.mfa')}>
          {t('settings.mfaBody', { roles })}
        </Row>
        <Row icon={<ShieldCheck className="size-[18px]" aria-hidden />} title={t('settings.security')}>
          {t('settings.securityBody')}
        </Row>
      </div>
    </div>
  );
}
