import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { Button, TextAreaField } from './Form';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  /** When set, the user must enter a reason (e.g. rejection). */
  reasonLabel?: string;
  reasonRequiredMessage?: string;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/** Accessible modal confirmation, used only for important or destructive actions. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = 'primary',
  reasonLabel,
  reasonRequiredMessage,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    setReason('');
    setError(null);
    const panel = panelRef.current;
    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>('textarea,button:not([disabled])') ?? []);
    window.setTimeout(() => focusables()[0]?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
      if (e.key === 'Tab') {
        const list = focusables();
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      restoreFocus.current?.focus?.();
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  const submit = () => {
    if (reasonLabel && !reason.trim()) {
      setError(reasonRequiredMessage ?? '');
      return;
    }
    onConfirm(reason.trim());
  };

  return (
    <div className="fixed inset-0 z-[1900] flex items-end justify-center p-4 sm:items-center">
      <button type="button" tabIndex={-1} aria-hidden className="absolute inset-0 bg-slate-950/50" onClick={() => !busy && onCancel()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-white">
          {title}
        </h2>
        {body ? <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{body}</p> : null}
        {reasonLabel ? (
          <TextAreaField
            className="mt-4"
            label={reasonLabel}
            required
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
            error={error}
            dir="auto"
          />
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={submit} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
