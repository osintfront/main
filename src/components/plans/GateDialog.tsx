import { useEffect, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { track } from '@vercel/analytics';
import { useI18n } from '@/i18n';
import type { UseReason } from '@/lib/featureUse';

/**
 * One window for every locked feature: guests are invited to sign up; signed-in users whose
 * daily uses ran out (or whose plan lacks the feature) are invited to a paid plan.
 * Open it from anywhere with openGate(); <GateHost /> is mounted once in App.
 */
export type GateKind = 'signup' | 'upgrade';
let current: GateKind | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openGate(kind: GateKind) {
  current = kind;
  emit();
}
/** The window for a refused use; false when the reason is not a plan matter (e.g. a network error). */
export function openGateFor(reason: UseReason | string | undefined): boolean {
  if (reason === 'signup_required') return openGate('signup'), true;
  if (reason === 'quota_exceeded' || reason === 'not_in_plan' || reason === 'quota' || reason === 'upgrade') return openGate('upgrade'), true;
  return false;
}
const close = () => {
  current = null;
  emit();
};

export function GateHost() {
  const kind = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => current, () => null);
  const { t } = useI18n();
  useEffect(() => {
    if (!kind) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [kind]);
  if (!kind) return null;
  const primary = 'inline-flex h-10 items-center justify-center rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700';
  const secondary = 'inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';
  return (
    <div className="fixed inset-0 z-[3000] flex items-end justify-center p-4 sm:items-center">
      <button type="button" tabIndex={-1} aria-hidden className="absolute inset-0 bg-slate-950/50" onClick={close} />
      <div role="dialog" aria-modal="true" aria-labelledby="gate-title" data-gate={kind} className="relative w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-slate-900">
        <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
          <Lock className="size-5" aria-hidden />
        </span>
        <h2 id="gate-title" className="text-lg font-bold text-slate-900 dark:text-white">{t(kind === 'signup' ? 'gate.signupTitle' : 'gate.upgradeTitle')}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{t(kind === 'signup' ? 'gate.signupBody' : 'gate.upgradeBody')}</p>
        <div className="mt-5 flex flex-col gap-2">
          {kind === 'signup' ? (
            <>
              <Link to="/login?mode=signup" onClick={close} className={primary}>{t('gate.signup')}</Link>
              <Link to="/login" onClick={close} className={secondary}>{t('gate.login')}</Link>
            </>
          ) : (
            <>
              <Link to="/packages" onClick={() => { try { track('upgrade_modal_converted'); } catch { /* blocked */ } close(); }} className={primary}>{t('gate.plans')}</Link>
              <button type="button" onClick={close} className={secondary}>{t('common.close')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
