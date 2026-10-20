import { useState } from 'react';
import { CheckCircle2, Copy } from 'lucide-react';
import { useToast } from '@/components/common/Toast';
import { useI18n } from '@/i18n';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / blocked clipboard API: fall back to a hidden textarea.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** The editor agent's WhatsApp-ready version of a report, with a copy button (staff only). */
export function WhatsAppTextCard({ text }: { text: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      toast.success(t('whatsapp.copied'));
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(t('whatsapp.copyFailed'));
    }
  };

  return (
    <section className="rounded-xl bg-emerald-50/70 p-4 ring-1 ring-emerald-600/20 dark:bg-emerald-500/10 dark:ring-emerald-400/20">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">{t('whatsapp.title')}</h2>
          <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80">{t('whatsapp.hint')}</p>
        </div>
        <button
          type="button"
          onClick={() => void onCopy()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
        >
          {copied ? <CheckCircle2 className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? t('whatsapp.copiedShort') : t('whatsapp.copy')}
        </button>
      </div>
      <pre dir="rtl" className="ofm-scroll max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-3 font-sans text-sm leading-relaxed text-slate-800 ring-1 ring-slate-900/5 dark:bg-slate-900 dark:text-slate-100 dark:ring-white/10">
        {text}
      </pre>
    </section>
  );
}
