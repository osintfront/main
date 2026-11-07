import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Lock, Minus } from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { LanguageToggle, ThemeToggle } from '@/components/common/Toggles';
import { SiteLinks } from '@/components/layout/SiteLinks';
import { UserMenu } from '@/components/layout/UserMenu';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/i18n';
import { OFI_TEXT } from '@/content/ofi';
import { supabase } from '@/integrations/supabase/client';
import { listInsights, type OfiCard } from '@/services/ofiService';
import { formatDateTime } from '@/utils/time';
import { cn } from '@/utils/cn';
import { BetaBadge, Gauge, MOOD_COLOR, moodOf, OfiAvatar, OfiDisclaimer, OfiDisclaimerShort, OfiHorizons, Sparkline, TimesUsual } from '@/components/ofi/OfiParts';

/** Frame shared by the OFI pages: site header, back link, OFI title, intro and the disclaimer on top. */
export function OfiFrame({ children, back, mood = 'calm' }: { children: ReactNode; back?: { to: string; label: string }; mood?: ReturnType<typeof moodOf> }) {
  const { t, lang } = useI18n();
  const tx = OFI_TEXT[lang === 'he' ? 'he' : 'en'];
  useEffect(() => {
    const prev = document.title;
    document.title = `${t('ofi.title')} · Osintfront`;
    return () => {
      document.title = prev;
    };
  }, [t]);
  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-4 dark:border-slate-800 dark:bg-slate-950">
        <Logo />
        <div className="ms-auto flex items-center gap-1">
          <LanguageToggle />
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
        <Link to={back?.to ?? '/'} className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:underline dark:text-sky-400">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {back?.label ?? t('site.backToMap')}
        </Link>
        <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-lime-50 to-emerald-100 p-3 ring-1 ring-emerald-700/15 dark:from-emerald-950 dark:to-slate-900 dark:ring-emerald-400/20">
          <OfiAvatar mood={mood} size={80} className="shrink-0 drop-shadow motion-safe:animate-[ofi-bob_3s_ease-in-out_infinite]" />
          <style>{'@keyframes ofi-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}'}</style>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('ofi.title')}</h1>
              <BetaBadge />
            </div>
          </div>
        </div>
        <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">{tx.intro}</p>
        <div className="mt-4">
          <OfiDisclaimer />
        </div>
        <div className="mt-8">{children}</div>
        <SiteLinks className="mt-10 justify-center" />
      </main>
    </div>
  );
}

/** Change since the previous estimate, in percentage points. */
export function Trend({ p, prev }: { p: number | null; prev: number | null }) {
  const { t } = useI18n();
  if (p == null || prev == null) return null;
  const d = (p - prev) * 100;
  const flat = Math.abs(d) < 0.05;
  const Icon = flat ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm font-semibold tabular-nums',
      flat ? 'text-slate-500' : d > 0 ? 'text-red-600 dark:text-red-400' : 'text-teal-700 dark:text-teal-400')}>
      <Icon className="size-4" aria-hidden />
      {flat ? t('ofi.unchanged') : t(d > 0 ? 'ofi.up' : 'ofi.down', { pts: Math.abs(d).toFixed(1) })}
    </span>
  );
}

/** "Updated …, next update …" — always shown with the number. */
export function UpdateTimes({ last, next }: { last: string | null; next: string | null }) {
  const { t, locale } = useI18n();
  const ageH = last ? (Date.now() - new Date(last).getTime()) / 3_600_000 : null;
  const fresh = ageH !== null && ageH < 26;
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      <span className={cn('me-1.5 inline-block size-2 rounded-full align-middle', fresh ? 'bg-teal-500' : 'bg-amber-500')} aria-hidden />
      {last ? t('ofi.updated', { time: formatDateTime(last, locale) }) : t('ofi.noEstimate')}
      {next ? <> {t('ofi.next', { time: formatDateTime(next, locale) })}</> : null}
    </p>
  );
}

/** Guests: no data at all, only the invitation to register. */
export function GuestGate() {
  const { t } = useI18n();
  return (
    <section className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-900/5 sm:p-8 dark:bg-slate-900 dark:ring-white/10">
      <Gauge value={null} blurred size={200} />
      <h2 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">{t('ofi.guestTitle')}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600 dark:text-slate-300">{t('ofi.guestBody')}</p>
      <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
        <Link to="/login?mode=signup" className="inline-flex h-10 items-center rounded-lg bg-sky-600 px-5 text-sm font-semibold text-white hover:bg-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500">
          {t('gate.signup')}
        </Link>
        <Link to="/login" className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
          {t('gate.login')}
        </Link>
      </div>
    </section>
  );
}

function InsightCard({ card }: { card: OfiCard }) {
  const { t, lang } = useI18n();
  const title = lang === 'he' ? card.title_he : card.title_en;
  return (
    <li className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
      <Link to={`/insights/${card.slug}`} className="group flex flex-col gap-4 focus-visible:outline-none sm:flex-row sm:items-center">
        <div className="shrink-0 self-center">
          <Gauge value={card.probability} blurred={card.locked} size={170} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-snug text-slate-900 group-hover:underline group-focus-visible:underline dark:text-white">{title}</h2>
          {card.locked ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
              <Lock className="size-4" aria-hidden />
              {t(card.min_tier >= 3 ? 'ofi.lockedMax' : 'ofi.lockedPro')}
            </p>
          ) : (
            <>
            <TimesUsual p={card.probability} base={card.base_rate} className="mt-2" />
            <OfiHorizons p={card.probability} compact className="mt-2" />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Trend p={card.probability} prev={card.previous_probability} />
              {card.spark && card.spark.length > 1 ? (
                <span style={{ color: MOOD_COLOR[moodOf(card.probability)] }}>
                  <Sparkline points={card.spark} />
                </span>
              ) : null}
            </div>
            </>
          )}
          <div className="mt-2">
            <UpdateTimes last={card.last_update} next={card.next_update} />
          </div>
          <OfiDisclaimerShort className="mt-3" />
        </div>
      </Link>
    </li>
  );
}

/** Unpublished events — listed for the super admin only (RLS returns nothing to anyone else). */
function AdminDrafts() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<{ slug: string; title_he: string; title_en: string; status: string }[]>([]);
  useEffect(() => {
    void supabase?.from('insight_events').select('slug,title_he,title_en,status').eq('is_published', false)
      .then(({ data }) => setRows(data ?? []));
  }, []);
  if (!rows.length) return null;
  return (
    <section className="mt-8 rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t('ofi.adminDrafts')}</h2>
      <ul className="mt-2 space-y-1">
        {rows.map((r) => (
          <li key={r.slug}>
            <Link to={`/insights/${r.slug}`} className="text-sm text-sky-700 hover:underline dark:text-sky-400">
              {lang === 'he' ? r.title_he : r.title_en} ({r.status})
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** /insights — one card per published insight. Guests see nothing but the invitation to register. */
export function InsightsPage() {
  const { t } = useI18n();
  const { status, profile } = useAuth();
  const [cards, setCards] = useState<OfiCard[] | null>(null);
  const [error, setError] = useState(false);
  const signedIn = status === 'signed_in';

  useEffect(() => {
    if (!signedIn) return;
    listInsights().then(setCards).catch(() => setError(true));
  }, [signedIn]);

  const top = cards?.find((c) => c.probability != null);
  return (
    <OfiFrame mood={moodOf(top?.probability)}>
      {status === 'loading' ? null : !signedIn ? (
        <GuestGate />
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{t('ofi.loadFailed')}</p>
      ) : cards === null ? (
        <div className="h-48 animate-pulse rounded-2xl bg-slate-200/60 dark:bg-slate-800/60" aria-hidden />
      ) : cards.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-sm ring-1 ring-slate-900/5 dark:bg-slate-900 dark:text-slate-300 dark:ring-white/10">
          {t('ofi.empty')}
        </p>
      ) : (
        <ul className="space-y-4">
          {cards.map((c) => (
            <InsightCard key={c.slug} card={c} />
          ))}
        </ul>
      )}
      {profile?.role === 'super_admin' ? <AdminDrafts /> : null}
    </OfiFrame>
  );
}
