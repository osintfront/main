import { useI18n } from '@/i18n';
import { cn } from '@/utils/cn';

type AdVariant = 'banner' | 'square' | 'skyscraper';

const SIZES: Record<AdVariant, { box: string; size: string }> = {
  // 728×90 leaderboard on desktop, 320×50 mobile banner on phones.
  banner: { box: 'h-[50px] w-full max-w-[320px] sm:h-[90px] sm:max-w-[728px]', size: '728 × 90 · 320 × 50' },
  // 300×250 medium rectangle.
  square: { box: 'h-[250px] w-[300px] max-w-full', size: '300 × 250' },
  // 160×600 wide skyscraper.
  skyscraper: { box: 'h-[600px] w-[160px]', size: '160 × 600' },
};

interface AdSlotProps {
  variant: AdVariant;
  /** Stable identifier for the ad network integration (e.g. GPT slot path). */
  slotId: string;
  className?: string;
}

/**
 * Reserved advertising space. Dimensions are fixed so the layout never
 * shifts when a real ad network fills the slot later. Public pages only.
 */
export function AdSlot({ variant, slotId, className }: AdSlotProps) {
  const { t } = useI18n();
  const { box, size } = SIZES[variant];
  return (
    <aside
      aria-label={t('ad.label')}
      data-ad-slot={slotId}
      data-ad-variant={variant}
      className={cn('flex shrink-0 items-center justify-center', className)}
    >
      <div
        className={cn(
          box,
          'flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center dark:border-slate-700 dark:bg-slate-900/60',
        )}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t('ad.label')}
        </span>
        <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500" dir="ltr">
          {size}
        </span>
      </div>
    </aside>
  );
}
