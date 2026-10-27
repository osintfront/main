import { useEffect, useRef, useState } from 'react';
import { GraduationCap, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/common/Form';
import { useToast } from '@/components/common/Toast';
import { changedPhrase } from '@/lib/phraseDiff';
import { editEventText } from '@/services/eventAdminService';
import { learnTerm } from '@/services/learningService';
import { friendlyError } from '@/services/serviceError';
import type { PublicEvent } from '@/types/event';
import { eventTexts } from './EventText';

interface Lesson {
  key: string;
  lang: 'he' | 'en';
  from: string;
  to: string;
  term: string;
  on: boolean;
}

const FIELDS = [
  ['titleHe', 'he', 'textEdit.titleHe', 200],
  ['summaryHe', 'he', 'textEdit.summaryHe', 400],
  ['titleEn', 'en', 'textEdit.titleEn', 200],
  ['summaryEn', 'en', 'textEdit.summaryEn', 400],
] as const;
type Field = (typeof FIELDS)[number][0];

/**
 * Staff: correct an event's headline and summary (Hebrew and English). After saving, the
 * words that changed are offered as learned terms, so the AI and the translations use the
 * right word from the next report on.
 */
export function EventTextDialog({ event, onClose, onSaved }: { event: PublicEvent; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const he = eventTexts(event, 'he');
  const en = event.translations.en ?? {};
  const [initial] = useState<Record<Field, string>>(() => ({
    titleHe: he.title ?? '',
    summaryHe: event.translations.he?.summary ?? '',
    titleEn: en.title ?? '',
    summaryEn: en.summary ?? en.description ?? '',
  }));
  const [text, setText] = useState(initial);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  // Reload the map only when the window closes (a reload can close the event window).
  const finish = () => {
    if (saved) onSaved();
    onClose();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finishRef.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const changed = FIELDS.some(([k]) => text[k].trim() !== initial[k].trim());

  const save = async () => {
    if (!text.titleHe.trim()) return;
    setBusy(true);
    try {
      await editEventText(event.id, text);
      setSaved(true);
      const found = new Map<string, Lesson>();
      for (const [k, lang] of FIELDS) {
        const d = changedPhrase(initial[k], text[k]);
        if (!d) continue;
        const key = `${lang}|${d.from.toLowerCase()}|${d.to.toLowerCase()}`;
        if (!found.has(key)) found.set(key, { key, lang, from: d.from, to: d.to, term: d.from, on: true });
      }
      if (found.size) setLessons([...found.values()]);
      else {
        toast.success(t('textEdit.saved'));
        onSaved();
        onClose();
      }
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const learn = async () => {
    const chosen = (lessons ?? []).filter((l) => l.on && l.term.trim() && l.to.trim() && l.from.trim().length >= 3);
    setBusy(true);
    try {
      for (const l of chosen) {
        await learnTerm({ term: l.term, he: l.lang === 'he' ? l.to : '', en: l.lang === 'en' ? l.to : '', avoid: [l.from] }, event.id);
      }
      toast.success(chosen.length ? t('textEdit.learned', { count: String(chosen.length) }) : t('textEdit.saved'));
      finish();
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const input =
    'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white';

  return (
    <div className="fixed inset-0 z-[3000] flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-slate-950/60" onClick={finish} aria-hidden />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="text-edit-title"
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:max-w-xl sm:rounded-2xl dark:bg-slate-900 dark:ring-white/10"
      >
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 id="text-edit-title" className="min-w-0 flex-1 text-base font-bold text-slate-900 dark:text-white">
            {lessons ? t('textEdit.learnTitle') : t('textEdit.title')}
          </h2>
          <button type="button" onClick={finish} aria-label={t('common.close')} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {lessons ? (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-300">{t('textEdit.learnHint')}</p>
              <ul className="mt-3 space-y-3">
                {lessons.map((l, i) => (
                  <li key={l.key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={l.on}
                        onChange={(e) => setLessons((ls) => ls!.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
                      />
                      <span className="text-slate-700 dark:text-slate-200">{t('textEdit.lesson')}</span>
                      <span className="ms-auto text-xs uppercase text-slate-400">{l.lang}</span>
                    </label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {(['from', 'to'] as const).map((f) => (
                        <label key={f} className="block text-xs text-slate-600 dark:text-slate-400">
                          {t(f === 'from' ? 'textEdit.wrong' : 'textEdit.right')}
                          <input
                            value={l[f]}
                            dir="auto"
                            maxLength={120}
                            onChange={(e) => setLessons((ls) => ls!.map((x, j) => (j === i ? { ...x, [f]: e.target.value } : x)))}
                            className={`${input} ${f === 'from' ? 'line-through decoration-red-400' : 'font-semibold text-emerald-700 dark:text-emerald-400'}`}
                          />
                        </label>
                      ))}
                    </div>
                    <label className="mt-2 block text-xs text-slate-600 dark:text-slate-400">
                      {t('textEdit.termSource')}
                      <input
                        value={l.term}
                        dir="auto"
                        maxLength={120}
                        onChange={(e) => setLessons((ls) => ls!.map((x, j) => (j === i ? { ...x, term: e.target.value } : x)))}
                        className={input}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="grid gap-3">
              {FIELDS.map(([k, lang, label, max]) => (
                <label key={k} className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t(label)}
                  <textarea
                    value={text[k]}
                    dir={lang === 'he' ? 'rtl' : 'ltr'}
                    lang={lang}
                    maxLength={max}
                    rows={k.startsWith('title') ? 2 : 3}
                    onChange={(e) => setText((x) => ({ ...x, [k]: e.target.value }))}
                    className={input}
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          {lessons ? (
            <>
              <Button variant="secondary" onClick={finish} disabled={busy}>
                {t('textEdit.skip')}
              </Button>
              <Button onClick={() => void learn()} disabled={busy}>
                <GraduationCap className="size-4" aria-hidden />
                {t('textEdit.learn')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={finish} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void save()} disabled={busy || !changed || !text.titleHe.trim()}>
                {t('textEdit.save')}
              </Button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
