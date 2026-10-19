import { supabase } from '@/integrations/supabase/client';
import { safeColor } from '@/data/categoryRegistry';
import type { EventCategory } from '@/types/category';
import { ServiceError, toServiceError } from './serviceError';

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string;
  marker_color: string | null;
  is_active: boolean;
  sort_order: number | null;
}

export function mapCategoryRow(row: CategoryRow): EventCategory {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? '',
    icon: row.icon ?? 'CircleDot',
    color: safeColor(row.color),
    markerColor: safeColor(row.marker_color ?? row.color),
    isActive: row.is_active,
    sortOrder: row.sort_order ?? 100,
  };
}

/** Public users only ever receive active categories (enforced by RLS). */
export async function fetchCategories(): Promise<EventCategory[]> {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  const { data, error } = await supabase
    .from('event_categories')
    .select('id,name,slug,description,icon,color,marker_color,is_active,sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw toServiceError(error);
  return ((data ?? []) as CategoryRow[]).map(mapCategoryRow);
}
