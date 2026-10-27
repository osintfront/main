import { supabase } from '@/integrations/supabase/client';
import { ServiceError, toServiceError } from './serviceError';

/** What the system learned from editors' corrections (places, categories and terms). */
export interface LearnedPlace {
  id: string;
  name: string;
  locationName: string;
  country: string;
  latitude: number;
  longitude: number;
  timesCorrected: number;
  timesUsed: number;
  updatedAt: string;
}

export interface CategoryCorrection {
  id: number;
  text: string;
  fromSlug: string;
  toSlug: string;
  createdAt: string;
}

function client() {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  return supabase;
}

function assertChanged(data: unknown) {
  if (!Array.isArray(data) || data.length === 0) throw new ServiceError('permission_denied', 'Not allowed.');
}

export async function fetchLearnedPlaces(): Promise<LearnedPlace[]> {
  const { data, error } = await client()
    .from('learned_places')
    .select('id,name,location_name,country,latitude,longitude,times_corrected,times_used,updated_at')
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) throw toServiceError(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    locationName: String(r.location_name ?? ''),
    country: String(r.country ?? ''),
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    timesCorrected: Number(r.times_corrected ?? 0),
    timesUsed: Number(r.times_used ?? 0),
    updatedAt: String(r.updated_at),
  }));
}

export async function fetchCategoryCorrections(): Promise<CategoryCorrection[]> {
  const { data, error } = await client()
    .from('category_corrections')
    .select('id,text,from_slug,to_slug,created_at')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw toServiceError(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    text: String(r.text ?? ''),
    fromSlug: String(r.from_slug),
    toSlug: String(r.to_slug),
    createdAt: String(r.created_at),
  }));
}

export interface LearnedTerm {
  id: number;
  term: string;
  he: string;
  en: string;
  avoid: string[];
  note: string;
  createdAt: string;
}

export interface NewTerm { term: string; he: string; en: string; avoid: string[]; note: string }

export async function fetchLearnedTerms(): Promise<LearnedTerm[]> {
  const { data, error } = await client()
    .from('learned_terms')
    .select('id,term,he,en,avoid,note,created_at')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw toServiceError(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    term: String(r.term ?? ''),
    he: String(r.he ?? ''),
    en: String(r.en ?? ''),
    avoid: Array.isArray(r.avoid) ? (r.avoid as unknown[]).map(String) : [],
    note: String(r.note ?? ''),
    createdAt: String(r.created_at),
  }));
}

export async function addLearnedTerm(t: NewTerm): Promise<void> {
  const clean = (s: string) => s.trim() || null;
  const { data, error } = await client()
    .from('learned_terms')
    .insert({ term: t.term.trim(), he: clean(t.he), en: clean(t.en), avoid: t.avoid.map((a) => a.trim()).filter(Boolean), note: clean(t.note) })
    .select('id');
  if (error) throw toServiceError(error);
  assertChanged(data);
}

export async function deleteLearnedTerm(id: number): Promise<void> {
  const { data, error } = await client().from('learned_terms').delete().eq('id', id).select('id');
  if (error) throw toServiceError(error);
  assertChanged(data);
}

export async function deleteLearnedPlace(id: string): Promise<void> {
  const { data, error } = await client().from('learned_places').delete().eq('id', id).select('id');
  if (error) throw toServiceError(error);
  assertChanged(data);
}

export async function deleteCategoryCorrection(id: number): Promise<void> {
  const { data, error } = await client().from('category_corrections').delete().eq('id', id).select('id');
  if (error) throw toServiceError(error);
  assertChanged(data);
}
