import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/utils/cn';

type ToastTone = 'success' | 'error';
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const { t } = useI18n();

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((i) => i.id !== id)), []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push('success', m), error: (m) => push('error', m) }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Top of the screen: the event editor has a sticky action bar at the bottom. */}
      <div className="pointer-events-none fixed inset-x-0 top-16 z-[2000] flex flex-col items-center gap-2 px-4 sm:items-end sm:pe-6">
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl px-4 py-3 text-sm shadow-xl ring-1',
              item.tone === 'success'
                ? 'bg-emerald-50 text-emerald-900 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-400/25'
                : 'bg-red-50 text-red-900 ring-red-600/20 dark:bg-red-950 dark:text-red-100 dark:ring-red-400/25',
            )}
          >
            {item.tone === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            <p className="min-w-0 flex-1">{item.message}</p>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label={t('common.close')}
              className="-me-1 rounded p-0.5 opacity-60 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
