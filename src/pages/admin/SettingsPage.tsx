import type { ReactNode } from 'react';
import { Database, KeyRound, Map as MapIcon, ShieldCheck } from 'lucide-react';
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
