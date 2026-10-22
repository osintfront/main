import { Fragment, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { LanguageToggle, ThemeToggle } from '@/components/common/Toggles';
import { SiteLinks } from '@/components/layout/SiteLinks';
import { useI18n } from '@/i18n';
import { PAGES, UPDATED, type PageId } from '@/content/sitePages';

/** "[text](url)" → link; internal paths use the router, others open safely. No HTML is parsed. */
function rich(text: string): ReactNode {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, label, href] = m;
    const cls = 'font-medium text-sky-700 underline decoration-sky-700/30 underline-offset-2 hover:decoration-sky-700 dark:text-sky-400';
    out.push(
      href.startsWith('/') ? (
        <Link key={m.index} to={href} className={cls}>
          {label}
        </Link>
      ) : (
        <a key={m.index} href={href} className={cls} dir="ltr" {...(href.startsWith('mailto:') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
          {label}
        </a>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.map((n, i) => <Fragment key={i}>{n}</Fragment>);
}

/** About / Privacy policy / Contact. No ads on these pages. */
export function SitePage({ page }: { page: PageId }) {
  const { t, lang, locale } = useI18n();
  const content = PAGES[lang === 'he' ? 'he' : 'en'][page];

  useEffect(() => {
    const prev = document.title;
    document.title = `${content.title} · Osintfront`;
    return () => {
      document.title = prev;
    };
  }, [content.title]);

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-4 dark:border-slate-800 dark:bg-slate-950">
        <Logo />
        <div className="ms-auto flex items-center gap-1">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:underline dark:text-sky-400"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {t('site.backToMap')}
        </Link>
        <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:p-8 dark:bg-slate-900 dark:ring-white/10">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{content.title}</h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('site.updated', { date: new Date(`${UPDATED}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) })}
          </p>
          <p className="mt-5 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">{rich(content.intro)}</p>
          {content.sections.map((s, i) => (
            <section key={i} className="mt-7">
              {s.h ? <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{s.h}</h2> : null}
              {s.p?.map((para, j) => (
                <p key={j} className="mt-2 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
                  {rich(para)}
                </p>
              ))}
              {s.ul ? (
                <ul className="mt-2 list-disc space-y-1.5 ps-5 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
                  {s.ul.map((li, j) => (
                    <li key={j}>{rich(li)}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </article>
        <SiteLinks className="mt-6 justify-center" />
      </main>
    </div>
  );
}
