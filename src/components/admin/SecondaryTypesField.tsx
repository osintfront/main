import type { CSSProperties } from 'react';
import { X } from 'lucide-react';
import { getCategoryIcon } from '@/data/categoryRegistry';
import { useI18n } from '@/i18n';
import type { EventCategory } from '@/types/category';

const NEVER_SECONDARY = ['home-front-alerts', 'other', 'uncategorized'];
const MAX = 2;

interface SecondaryTypesFieldProps {
  /** Chosen slugs (at most two). */
  value: string[];
  /** The main type: never offered as a secondary one. */
  mainSlug: string | null;
  categories: EventCategory[];
  onChange: (slugs: string[]) => void;
  disabled?: boolean;
}

/** Staff: up to two more types of the same incident — removable chips and an "add" list. */
export function SecondaryTypesField({ value, mainSlug, categories, onChange, disabled = false }: SecondaryTypesFieldProps) {
  const { t, categoryLabel } = useI18n();
  const chosen = value.filter((s) => s !== mainSlug).slice(0, MAX);
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  const offer = categories.filter((c) => c.isActive && c.slug !== mainSlug && !chosen.includes(c.slug) && !NEVER_SECONDARY.includes(c.slug));
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-secondary-field>
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t('form.secondaryTypes')}</span>
      {chosen.map((slug) => {
        const c = bySlug.get(slug);
        const Icon = getCategoryIcon(c?.icon);
        const label = categoryLabel(slug, c?.name ?? slug);
        return (
          <span
            key={slug}
            data-secondary-type={slug}
            className="ofm-category-chip ofm-category-chip--secondary inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset"
            style={{ '--chip-color': c?.color ?? '#78716c' } as CSSProperties}
          >
            <Icon className="size-3" aria-hidden />
            {label}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(chosen.filter((s) => s !== slug))}
              className="rounded hover:bg-black/10 disabled:opacity-50 dark:hover:bg-white/10"
              aria-label={t('form.removeSecondaryType', { type: label })}
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        );
      })}
      {chosen.length < MAX ? (
        <select
          value=""
          disabled={disabled || !offer.length}
          onChange={(e) => e.target.value && onChange([...chosen, e.target.value])}
          className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
          aria-label={t('form.addSecondaryType')}
        >
          <option value="">{t('form.addSecondaryType')}</option>
          {offer.map((c) => (
            <option key={c.slug} value={c.slug}>{categoryLabel(c.slug, c.name)}</option>
          ))}
        </select>
      ) : (
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{t('form.secondaryLimit')}</span>
      )}
    </div>
  );
}
