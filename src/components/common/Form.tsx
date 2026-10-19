import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  hint?: string;
  trailing?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, trailing, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = [error ? `${inputId}-error` : null, hint ? `${inputId}-hint` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-slate-800 dark:text-slate-200">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'block h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 shadow-xs transition-colors placeholder:text-slate-400',
            'focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30',
            'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500',
            'dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500 dark:disabled:bg-slate-800/60 dark:disabled:text-slate-400',
            error ? 'border-red-500 dark:border-red-400' : 'border-slate-300 dark:border-slate-700',
            trailing ? 'pe-10' : '',
          )}
          {...rest}
        />
        {trailing ? <div className="absolute inset-y-0 end-0 flex items-center pe-1">{trailing}</div> : null}
      </div>
      {hint && !error ? (
        <p id={`${inputId}-hint`} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${inputId}-error`} className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
});

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  size?: 'sm' | 'md';
}

const BUTTON_VARIANTS = {
  primary: 'bg-sky-600 text-white shadow-sm hover:bg-sky-500 disabled:bg-sky-600/60',
  secondary:
    'bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-700',
  ghost: 'text-slate-700 hover:bg-slate-900/5 dark:text-slate-200 dark:hover:bg-white/10',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-500 disabled:bg-red-600/60',
} as const;

/** Disables itself while `loading` so a request can't be submitted twice. */
export function Button({
  variant = 'primary',
  loading = false,
  size = 'md',
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

const FIELD_BASE =
  'block w-full rounded-lg border bg-white px-3 text-sm text-slate-900 shadow-xs transition-colors placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500 dark:disabled:bg-slate-800/60';

function FieldShell({
  id,
  label,
  error,
  hint,
  required,
  children,
  className,
  badge,
}: {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  badge?: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-200">
        {label}
        {required ? (
          <span className="text-red-600 dark:text-red-400" aria-hidden>
            *
          </span>
        ) : null}
        {badge}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string | null;
  hint?: string;
  badge?: ReactNode;
}

export function TextAreaField({ label, error, hint, className, id, required, badge, ...rest }: TextAreaFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} required={required} className={className} badge={badge}>
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        aria-required={required || undefined}
        className={cn(FIELD_BASE, 'min-h-24 py-2 leading-relaxed', error ? 'border-red-500 dark:border-red-400' : 'border-slate-300 dark:border-slate-700')}
        {...rest}
      />
    </FieldShell>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string | null;
  hint?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  badge?: ReactNode;
}

export function SelectField({ label, error, hint, options, placeholder, className, id, required, badge, ...rest }: SelectFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} required={required} className={className} badge={badge}>
      <select
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        aria-required={required || undefined}
        className={cn(FIELD_BASE, 'h-10', error ? 'border-red-500 dark:border-red-400' : 'border-slate-300 dark:border-slate-700')}
        {...rest}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function ToggleField({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed opacity-60')}>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="h-5 w-9 rounded-full bg-slate-300 transition-colors peer-checked:bg-sky-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-sky-500 dark:bg-slate-700" />
        <span className="absolute start-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4" />
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>
        {description ? <span className="text-xs text-slate-500 dark:text-slate-400">{description}</span> : null}
      </span>
    </label>
  );
}
