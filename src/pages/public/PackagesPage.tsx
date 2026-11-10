import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Mail, Minus, Tag } from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { LanguageToggle, ThemeToggle } from '@/components/common/Toggles';
import { UserMenu } from '@/components/layout/UserMenu';
import { SiteLinks } from '@/components/layout/SiteLinks';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/i18n';
import type { TranslationKey } from '@/i18n/en';
import { effectivePlan, loadPlanConfig, PLAN_LABEL, planFeature, usePlanVersion, type EffectivePlan, type FeatureKey } from '@/lib/plans';
import { INTRO_PRICES, shekels } from '@/content/packages';
import { SITE_EMAIL } from '@/content/sitePages';
import { cn } from '@/utils/cn';

type Sold = 'free' | 'pro' | 'max';

/**
 * Plans & pricing. Reached from the user menu, the plan line in it, and the "uses ran out" window.
 * Prices are introductory; buying is manual for now (contact us), so every paid button goes to /contact.
 * Daily limits are read from plan_features, so the page follows the admin's settings.
 */
export function PackagesPage() {
  const { t, locale } = useI18n();
  const { status, profile } = useAuth();
  usePlanVersion();
  useEffect(() => void loadPlanConfig(), []);
  const [yearly, setYearly] = useState(false);

  useEffect(() => {
    const prev = document.title;
    document.title = `${t('pk.title')} · Osintfront`;
    return () => {
      document.title = prev;
    };
  }, [t]);

  const mine: EffectivePlan | null = status === 'signed_in' && profile?.role === 'viewer' ? effectivePlan(profile) : null;

  /** "{n} a day" / "unlimited" lines from the database limits (null limit = unlimited). */
  const daily = (plan: EffectivePlan, key: FeatureKey, some: TranslationKey, all: TranslationKey): string | null => {
    const f = planFeature(plan, key);
    if (!f?.enabled) return null;
    if (key === 'expand_daily' && f.limit === 1) return t('pk.f.expandOne');
    return f.limit == null ? t(all) : t(some, { n: f.limit });
  };
  const archive = (plan: Sold): string | null => {
    const f = planFeature(plan, 'archive_days');
    if (!f?.enabled) return null;
    if (f.limit == null) return t('pk.f.archiveAll');
    if (f.limit <= 1) return t('pk.f.archiveDay');
    return t('pk.f.archiveDays', { n: f.limit });
  };
  const ask = (plan: Sold): string | null => {
    const f = planFeature(plan, 'ai_expand_ask');
    return plan !== 'free' && f?.enabled && f.limit ? t('pk.f.ask', { n: f.limit }) : null;
  };
  const list = (...items: (string | null)[]) => items.filter((x): x is string => !!x);

  const on = (plan: EffectivePlan, key: FeatureKey) => !!planFeature(plan, key)?.enabled;
  const lim = (plan: EffectivePlan, key: FeatureKey) => planFeature(plan, key)?.limit ?? null;
  const delayLine = (plan: Sold) => {
    const n = lim(plan, 'feed_delay_min');
    return n ? t('pk.f.delay', { n }) : t('pk.f.realtime');
  };
  const opensLine = (plan: Sold) => {
    const n = lim(plan, 'event_open');
    return n == null ? t('pk.f.opensAll') : t('pk.f.opens', { n });
  };

  const freeItems = list(
    t('pk.f.map'),
    delayLine('free'),
    opensLine('free'),
    on('free', 'event_summary') ? t('pk.f.summary') : null,
    t('pk.f.hfc'),
    on('free', 'push') ? (lim('free', 'push') === 4 ? t('pk.f.pushCritical') : t('pk.f.push')) : null,
    daily('free', 'expand_daily', 'pk.f.expand', 'pk.f.expandAll'),
    daily('free', 'satellite', 'pk.f.sat', 'pk.f.satAll'),
    archive('free'),
    daily('free', 'share_daily', 'pk.f.shares', 'pk.f.sharesAll'),
    t('pk.f.ads'),
  );
  const proItems = list(
    t('pk.f.noAds'),
    delayLine('pro'),
    opensLine('pro'),
    on('pro', 'source_link') ? t('pk.f.sourceLinks') : null,
    on('pro', 'media') && lim('pro', 'media') == null ? t('pk.f.mediaAll') : null,
    on('pro', 'feed_search') ? t('pk.f.search') : null,
    daily('pro', 'share_daily', 'pk.f.shares', 'pk.f.sharesAll'),
    daily('pro', 'expand_daily', 'pk.f.expand', 'pk.f.expandAll'),
    daily('pro', 'satellite', 'pk.f.sat', 'pk.f.satAll'),
    archive('pro'),
    ask('pro'),
    lim('pro', 'devices') ? t('pk.f.devices', { n: lim('pro', 'devices') ?? 1 }) : null,
  );
  const maxItems = list(
    daily('max', 'expand_daily', 'pk.f.expand', 'pk.f.expandAll'),
    archive('max'),
    ask('max'),
    lim('max', 'sources_detail') == null && on('max', 'sources_detail') ? t('pk.f.sourcesLinks') : null,
    on('max', 'media_download') ? t('pk.f.download') : null,
    on('max', 'military_assets') ? t('pk.f.military') : null,
    lim('max', 'devices') ? t('pk.f.devices', { n: lim('max', 'devices') ?? 1 }) : null,
    on('max', 'idle_logout_min') && lim('max', 'idle_logout_min') == null ? t('pk.f.noIdle') : null,
  );

  // The full comparison, read from plan_features (what the server enforces).
  const COLS: EffectivePlan[] = ['guest', 'free', 'pro', 'max'];
  type Cell = string | boolean;
  const perDay = (key: FeatureKey) => (p: EffectivePlan): Cell => {
    if (!on(p, key)) return false;
    const n = lim(p, key);
    return n == null ? t('pk.c.unlimited') : t('pk.c.perDay', { n });
  };
  const rows: { label: string; cell: (p: EffectivePlan) => Cell }[] = [
    { label: t('pk.c.delay'), cell: (p) => { const n = lim(p, 'feed_delay_min'); return n ? t('pk.c.minutes', { n }) : t('pk.c.live'); } },
    { label: t('pk.c.opens'), cell: perDay('event_open') },
    { label: t('pk.c.detail'), cell: (p) => (on(p, 'source_link') ? t('pk.c.full') : on(p, 'event_summary') ? t('pk.c.summary') : t('pk.c.headline')) },
    { label: t('pk.c.media'), cell: (p) => (!on(p, 'media') ? t('pk.c.blurred') : lim(p, 'media') != null ? t('pk.c.firstPic') : on(p, 'media_download') ? t('pk.c.allDownload') : t('pk.c.all')) },
    { label: t('pk.c.sourceLink'), cell: (p) => on(p, 'source_link') },
    { label: t('pk.c.sources'), cell: (p) => (!on(p, 'sources_detail') ? t('pk.c.countOnly') : lim(p, 'sources_detail') === 1 ? t('pk.c.names') : t('pk.c.namesLinks')) },
    { label: t('pk.c.share'), cell: (p) => (p === 'guest' ? t('pk.c.shareBlur') : p === 'free' ? t('pk.c.shareMark') : t('pk.c.unlimited')) },
    { label: t('pk.c.search'), cell: (p) => (on(p, 'feed_search') ? true : p === 'guest' ? false : t('pk.c.categories')) },
    { label: t('pk.c.archive'), cell: (p) => { const f = planFeature(p, 'archive_days'); if (!f?.enabled || f.limit === 0) return false; return f.limit == null ? t('pk.c.unlimited') : f.limit === 1 ? t('pk.c.oneDay') : t('pk.c.days', { n: f.limit }); } },
    { label: t('pk.c.push'), cell: (p) => (!on(p, 'push') ? false : lim(p, 'push') === 4 ? t('pk.c.criticalOnly') : lim(p, 'push') === 3 ? t('pk.c.highUp') : t('pk.c.allLevels')) },
    { label: t('pk.c.ships'), cell: (p) => on(p, 'ships_aircraft') },
    { label: t('pk.c.weather'), cell: (p) => on(p, 'weather') },
    { label: t('pk.c.satellite'), cell: perDay('satellite') },
    { label: t('pk.c.military'), cell: (p) => on(p, 'military_assets') },
    { label: t('pk.c.expand'), cell: perDay('expand_daily') },
    { label: t('pk.c.ask'), cell: perDay('ai_expand_ask') },
    { label: t('pk.c.devices'), cell: (p) => (p === 'guest' ? '—' : String(lim(p, 'devices') ?? 1)) },
    { label: t('pk.c.idle'), cell: (p) => { if (p === 'guest') return '—'; const n = lim(p, 'idle_logout_min'); return n == null ? t('pk.c.never') : n >= 60 ? t('pk.c.hours', { n: Math.round(n / 60) }) : t('pk.c.minutes', { n }); } },
    { label: t('pk.c.ads'), cell: (p) => (p === 'guest' || p === 'free' ? t('pk.c.withAds') : t('pk.c.noAds')) },
  ];

  const price = (plan: 'pro' | 'max') => {
    const p = INTRO_PRICES[plan];
    return {
      main: shekels(yearly ? Math.round(p.yearly / 12) : p.monthly, locale),
      note: yearly ? t('pk.yearlyBilled', { price: shekels(p.yearly, locale) }) : t('pk.yearlyNote', { price: shekels(p.yearly, locale) }),
    };
  };

  const toggle = (on: boolean) =>
    cn(
      'min-h-10 rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-sky-500',
      on ? 'bg-sky-600 text-white' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white',
    );
  const ctaPrimary = 'flex min-h-11 items-center justify-center rounded-xl bg-sky-600 px-4 text-sm font-bold text-white hover:bg-sky-700';
  const ctaSecondary =
    'flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 dark:text-white dark:ring-slate-700 dark:hover:bg-slate-800';

  const freeCta =
    mine === 'free' ? null : status === 'signed_in' ? (
      <Link to="/" className={ctaSecondary}>{t('pk.toMap')}</Link>
    ) : (
      <Link to="/login?mode=signup" className={ctaSecondary}>{t('pk.freeCta')}</Link>
    );

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

      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:underline dark:text-sky-400">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {t('site.backToMap')}
        </Link>

        <section className="flex flex-col items-center gap-3 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
            <Tag className="size-3.5" aria-hidden />
            {t('pk.introBadge')}
          </span>
          <h1 className="max-w-3xl text-3xl font-extrabold text-balance text-slate-900 sm:text-4xl dark:text-white">{t('pk.heading')}</h1>
          <p className="max-w-xl text-base text-slate-600 dark:text-slate-300">{t('pk.lead')}</p>
          <div role="group" aria-label={t('pk.billing')} className="mt-2 inline-flex gap-1 rounded-full bg-white p-1 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)} className={toggle(!yearly)}>
              {t('pk.monthly')}
            </button>
            <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)} className={toggle(yearly)}>
              {t('pk.yearly')}
            </button>
          </div>
        </section>

        <ManualNotice />

        <section className="mt-8 grid gap-5 md:grid-cols-3">
          <PlanCard name={t('pk.freeName')} tag={t('pk.freeTag')} price={shekels(0, locale)} unit={t('pk.forever')} current={mine === 'free'} items={freeItems} cta={freeCta} />
          <PlanCard
            name="Pro"
            tag={t('pk.proTag')}
            price={price('pro').main}
            unit={t('pk.perMonth')}
            note={price('pro').note}
            intro
            highlight
            current={mine === 'pro'}
            lead={t('pk.plusFree')}
            items={proItems}
            cta={mine === 'pro' ? null : <Link to="/contact" className={ctaPrimary}>{t('pk.buy')}</Link>}
          />
          <PlanCard
            name="Max"
            tag={t('pk.maxTag')}
            price={price('max').main}
            unit={t('pk.perMonth')}
            note={price('max').note}
            intro
            current={mine === 'max'}
            lead={t('pk.plusPro')}
            items={maxItems}
            cta={mine === 'max' ? null : <Link to="/contact" className={ctaSecondary}>{t('pk.buy')}</Link>}
          />
        </section>
        <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">{t('pk.introNote')}</p>

        <section className="mt-12" aria-labelledby="pk-compare">
          <h2 id="pk-compare" className="text-center text-2xl font-bold text-slate-900 dark:text-white">{t('pk.c.title')}</h2>
          <div className="mt-5 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th scope="col" className="px-4 py-3 text-start font-semibold text-slate-500 dark:text-slate-400">{t('pk.c.feature')}</th>
                  {COLS.map((c) => (
                    <th key={c} scope="col" className={cn('px-3 py-3 text-center font-bold text-slate-900 dark:text-white', c === 'pro' && 'bg-sky-50 dark:bg-sky-500/10', mine === c && 'text-emerald-700 dark:text-emerald-400')} translate="no">
                      {c === 'guest' ? t('pk.c.guest') : c === 'free' ? t('pk.freeName') : PLAN_LABEL[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                    <th scope="row" className="px-4 py-2.5 text-start font-medium text-slate-700 dark:text-slate-200">{r.label}</th>
                    {COLS.map((c) => {
                      const v = r.cell(c);
                      return (
                        <td key={c} className={cn('px-3 py-2.5 text-center text-slate-700 dark:text-slate-300', c === 'pro' && 'bg-sky-50/60 dark:bg-sky-500/5')}>
                          {v === true ? (
                            <Check className="mx-auto size-4 text-sky-600 dark:text-sky-400" aria-label={t('pk.c.yes')} />
                          ) : v === false ? (
                            <Minus className="mx-auto size-4 text-slate-300 dark:text-slate-600" aria-label={t('pk.c.no')} />
                          ) : (
                            v
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">{t('pk.c.note')}</p>
        </section>

        <section className="mt-12">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{t('pk.apiTitle')}</h2>
            <p className="mx-auto mt-1 max-w-xl text-sm text-slate-600 dark:text-slate-300">{t('pk.apiLead')}</p>
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <ApiCard name="API Starter" price={shekels(INTRO_PRICES.apiStarter.monthly, locale)} text={t('pk.apiStarter')} />
            <ApiCard name="API Business" price={shekels(INTRO_PRICES.apiBusiness.monthly, locale)} text={t('pk.apiBusiness')} />
          </div>
          <p className="mt-4 text-center text-sm text-slate-600 dark:text-slate-300">{t('pk.intel')}</p>
        </section>

        <div className="mt-12 flex flex-col items-center gap-3 text-center">
          <Link to="/contact" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-sky-600 px-6 text-base font-bold text-white hover:bg-sky-700">
            <Mail className="size-5" aria-hidden />
            {t('pk.contactCta')}
          </Link>
          <a href={`mailto:${SITE_EMAIL}`} dir="ltr" className="text-sm font-medium text-sky-700 hover:underline dark:text-sky-400">
            {SITE_EMAIL}
          </a>
        </div>
        <SiteLinks className="mt-10 justify-center" />
      </main>
    </div>
  );

  function ManualNotice() {
    return (
      <section className="mx-auto mt-8 flex max-w-3xl flex-col items-start gap-3 rounded-2xl bg-sky-50 p-5 ring-1 ring-sky-200 sm:flex-row sm:items-center dark:bg-sky-500/10 dark:ring-sky-500/30">
        <div className="flex-1">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{t('pk.manualTitle')}</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{t('pk.manualBody')}</p>
        </div>
        <Link to="/contact" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white hover:bg-sky-700">
          <Mail className="size-4" aria-hidden />
          {t('pk.contactCta')}
        </Link>
      </section>
    );
  }

  function PlanCard(p: {
    name: string;
    tag: string;
    price: string;
    unit: string;
    note?: string;
    intro?: boolean;
    highlight?: boolean;
    current?: boolean;
    lead?: string;
    items: string[];
    cta: ReactNode;
  }) {
    return (
      <article
        className={cn(
          'relative flex flex-col gap-5 rounded-2xl bg-white p-6 shadow-sm dark:bg-slate-900',
          p.highlight ? 'ring-2 ring-sky-500' : 'ring-1 ring-slate-900/10 dark:ring-white/10',
        )}
      >
        {p.current ? (
          <span className="absolute -top-3 start-5 rounded-full bg-emerald-600 px-3 py-0.5 text-xs font-bold text-white">{t('pk.current')}</span>
        ) : p.highlight ? (
          <span className="absolute -top-3 start-5 rounded-full bg-sky-600 px-3 py-0.5 text-xs font-bold text-white">{t('pk.recommended')}</span>
        ) : null}
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white" translate="no">{p.name}</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{p.tag}</p>
        </div>
        <div>
          {p.intro ? (
            <span className="mb-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
              {t('pk.introBadge')}
            </span>
          ) : null}
          <div className="flex items-baseline gap-1.5">
            <span className="text-4xl font-extrabold tabular-nums text-slate-900 dark:text-white">{p.price}</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">{p.unit}</span>
          </div>
          <p className="mt-1 min-h-5 text-xs text-slate-500 dark:text-slate-400">{p.note ?? ''}</p>
        </div>
        {p.cta}
        <ul className="flex flex-col gap-2.5 text-sm text-slate-700 dark:text-slate-300">
          {p.lead ? <li className="font-semibold text-slate-900 dark:text-white">{p.lead}</li> : null}
          {p.items.map((x) => (
            <li key={x} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
              <span>{x}</span>
            </li>
          ))}
        </ul>
      </article>
    );
  }

  function ApiCard({ name, price: pr, text }: { name: string; price: string; text: string }) {
    return (
      <article className="flex flex-col gap-3 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white" translate="no">{name}</h3>
        <div>
          <span className="mb-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">{t('pk.introBadge')}</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-extrabold tabular-nums text-slate-900 dark:text-white">{pr}</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">{t('pk.perMonth')}</span>
          </div>
        </div>
        <p className="text-sm text-slate-700 dark:text-slate-300">{text}</p>
        <Link to="/contact" className={ctaSecondary}>{t('pk.buy')}</Link>
      </article>
    );
  }
}
