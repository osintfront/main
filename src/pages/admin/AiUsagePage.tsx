import { Fragment, useEffect, useMemo, useState } from 'react';
import { Alert, Spinner } from '@/components/common/Feedback';
import { useI18n } from '@/i18n';
import { fetchAiUsage, fetchClaudeUsage, type AiUsageRow, type ClaudeDay } from '@/services/aiUsageService';
import { friendlyError } from '@/services/serviceError';

const fmt = (n: number) => n.toLocaleString('en-US');
const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;

/** Tokens and cost of every AI call the site makes, summed per day. */
export function AiUsagePage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<AiUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [claude, setClaude] = useState<{ configured: boolean; days: ClaudeDay[]; error?: string } | null>(null);
  const [claudeOpen, setClaudeOpen] = useState<string | null>(null);

  useEffect(() => {
    fetchClaudeUsage()
      .then(setClaude)
      .catch(() => setClaude({ configured: true, days: [], error: 'x' }));
  }, []);

  useEffect(() => {
    fetchAiUsage(30)
      .then(setRows)
      .catch((err) => setError(friendlyError(err, t)))
      .finally(() => setLoading(false));
  }, [t]);

  const days = useMemo(() => {
    const m = new Map<string, { day: string; calls: number; input: number; output: number; searches: number; cost: number; rows: AiUsageRow[] }>();
    for (const r of rows) {
      const d = m.get(r.day) ?? { day: r.day, calls: 0, input: 0, output: 0, searches: 0, cost: 0, rows: [] };
      d.calls += r.calls;
      d.input += r.inputTokens + r.cacheRead + r.cacheWrite;
      d.output += r.outputTokens;
      d.searches += r.webSearches;
      d.cost += r.costUsd;
      d.rows.push(r);
      m.set(r.day, d);
    }
    return [...m.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  }, [rows]);
  const month = days.reduce((s, d) => s + d.cost, 0);

  if (loading) return <Spinner label={t('common.loading')} />;
  const th = 'px-3 py-2 text-start text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';
  const td = 'px-3 py-2 tabular-nums';

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('admin.nav.aiUsage')}</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">{t('usage.intro')}</p>
      {error ? <Alert tone="error" className="mt-4">{error}</Alert> : null}
      <section className="mt-5">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('usage.claudeTitle')}</h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('usage.claudeHint')}</p>
        {!claude ? (
          <Spinner label={t('common.loading')} />
        ) : !claude.configured ? (
          <Alert tone="info" className="mt-2">{t('usage.claudeNoKey')}</Alert>
        ) : claude.error ? (
          <Alert tone="error" className="mt-2">{t('usage.claudeError')}</Alert>
        ) : (
          <>
            <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              {t('usage.total30', { cost: usd(claude.days.reduce((n, d) => n + d.costUsd, 0)) })}
            </p>
            <div className="mt-2 overflow-x-auto rounded-xl bg-white ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
              <table className="w-full text-sm" dir="ltr">
                <thead className="border-b border-slate-100 dark:border-slate-800">
                  <tr>
                    <th className={th}>{t('usage.day')}</th>
                    <th className={th}>{t('usage.input')}</th>
                    <th className={th}>{t('usage.output')}</th>
                    <th className={th}>{t('usage.searches')}</th>
                    <th className={th}>{t('usage.cost')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {claude.days.map((d) => (
                    <Fragment key={d.day}>
                      <tr className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setClaudeOpen(claudeOpen === d.day ? null : d.day)}>
                        <td className={`${td} font-semibold`}>{d.day}</td>
                        <td className={td}>{fmt(d.input + d.cacheRead + d.cacheWrite)}</td>
                        <td className={td}>{fmt(d.output)}</td>
                        <td className={td}>{fmt(d.webSearches)}</td>
                        <td className={`${td} font-semibold`}>{usd(d.costUsd)}</td>
                      </tr>
                      {claudeOpen === d.day
                        ? Object.entries(d.models)
                            .sort((a, b) => b[1].costUsd - a[1].costUsd)
                            .map(([m, v]) => (
                              <tr key={m} className="bg-slate-50/60 text-xs text-slate-600 dark:bg-slate-800/30 dark:text-slate-300">
                                <td className={`${td} ps-6 text-slate-500`}>{m}</td>
                                <td className={td}>{fmt(v.input)}</td>
                                <td className={td}>{fmt(v.output)}</td>
                                <td className={td} />
                                <td className={td}>{usd(v.costUsd)}</td>
                              </tr>
                            ))
                        : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <h2 className="mt-6 text-base font-semibold text-slate-900 dark:text-white">{t('usage.siteTitle')}</h2>
      <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{t('usage.total30', { cost: usd(month) })}</p>
      <div className="mt-3 overflow-x-auto rounded-xl bg-white ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
        <table className="w-full text-sm" dir="ltr">
          <thead className="border-b border-slate-100 dark:border-slate-800">
            <tr>
              <th className={th}>{t('usage.day')}</th>
              <th className={th}>{t('usage.calls')}</th>
              <th className={th}>{t('usage.input')}</th>
              <th className={th}>{t('usage.output')}</th>
              <th className={th}>{t('usage.searches')}</th>
              <th className={th}>{t('usage.cost')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {days.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-5 text-slate-500">
                  {t('usage.empty')}
                </td>
              </tr>
            ) : null}
            {days.map((d) => (
              <Fragment key={d.day}>
                <tr className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setOpen(open === d.day ? null : d.day)}>
                  <td className={`${td} font-semibold`}>{d.day}</td>
                  <td className={td}>{fmt(d.calls)}</td>
                  <td className={td}>{fmt(d.input)}</td>
                  <td className={td}>{fmt(d.output)}</td>
                  <td className={td}>{fmt(d.searches)}</td>
                  <td className={`${td} font-semibold`}>{usd(d.cost)}</td>
                </tr>
                {open === d.day
                  ? d.rows
                      .sort((a, b) => b.costUsd - a.costUsd)
                      .map((r) => (
                        <tr key={`${d.day}-${r.fn}-${r.purpose}-${r.model}`} className="bg-slate-50/60 text-xs text-slate-600 dark:bg-slate-800/30 dark:text-slate-300">
                          <td className={`${td} ps-6`}>
                            {r.fn} · {r.purpose} · <span className="text-slate-400">{r.model}</span>
                          </td>
                          <td className={td}>{fmt(r.calls)}</td>
                          <td className={td}>{fmt(r.inputTokens + r.cacheRead + r.cacheWrite)}</td>
                          <td className={td}>{fmt(r.outputTokens)}</td>
                          <td className={td}>{fmt(r.webSearches)}</td>
                          <td className={td}>{usd(r.costUsd)}</td>
                        </tr>
                      ))
                  : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
