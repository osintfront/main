import { supabase } from '@/integrations/supabase/client';
import type { SatsrStatus } from '@/lib/satEnhance';
import { ServiceError } from './serviceError';

/**
 * Satellite enhance ×4 (migration 126). The database decides everything: who may ask, how many
 * new enhancements are left today (satsr_my_quota), and which result files each user may open
 * (storage policy on the private satsr-results bucket). Jobs are run by the local satsr-worker.
 */
export interface SatsrQuota {
  signedIn: boolean;
  enabled: boolean;
  staff: boolean;
  used: number;
  /** null = unlimited (staff) */
  limit: number | null;
  workerOnline: boolean;
  queued: number;
}

export type SatsrReason = null | 'signup_required' | 'not_in_plan' | 'quota_exceeded' | 'busy' | 'bad_input' | 'error';

export interface SatsrRequestResult {
  ok: boolean;
  reason: SatsrReason;
  requestId: string | null;
  jobId: string | null;
  status: SatsrStatus | null;
  cacheHit: boolean;
  used: number;
  limit: number | null;
  workerOnline: boolean;
}

export interface SatsrJob {
  requestId: string;
  jobId: string;
  status: SatsrStatus;
  errorCode: string | null;
  engine: string;
  lat: number;
  lng: number;
  requestedDate: string | null;
  sceneDate: string | null;
  cloudPct: number | null;
  /** [[south, west], [north, east]] of the PNGs (EPSG:3857-aligned), when done */
  bounds: [[number, number], [number, number]] | null;
  width: number | null;
  height: number | null;
  /** product → storage paths of the before (lr) and after (sr) pictures */
  products: Record<string, { sr?: string; lr?: string }> | null;
  cacheHit: boolean;
  queuePos: number | null;
  createdAt: string;
  finishedAt: string | null;
}

const BUCKET = 'satsr-results';

function db() {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  return supabase;
}

export async function fetchSatsrQuota(): Promise<SatsrQuota | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('satsr_my_quota');
  if (error || !data) return null;
  const q = data as Record<string, unknown>;
  return {
    signedIn: !!q.signed_in, enabled: !!q.enabled, staff: !!q.staff, used: Number(q.used ?? 0),
    limit: q.limit == null ? null : Number(q.limit), workerOnline: !!q.worker_online, queued: Number(q.queued ?? 0),
  };
}

/** Ask for an enhancement of the cell around (lat, lng); date = that day's picture, null = newest clear one. */
export async function requestEnhance(lat: number, lng: number, date: string | null): Promise<SatsrRequestResult> {
  const fail = (reason: SatsrReason): SatsrRequestResult => ({
    ok: false, reason, requestId: null, jobId: null, status: null, cacheHit: false, used: 0, limit: null, workerOnline: false,
  });
  if (!supabase) return fail('error');
  const { data: s } = await supabase.auth.getSession();
  if (!s.session) return fail('signup_required');
  const { data, error } = await supabase.rpc('satsr_request', { p_lat: lat, p_lng: lng, p_date: date });
  if (error || !data) return fail('error');
  const r = data as Record<string, unknown>;
  return {
    ok: !!r.ok, reason: (r.reason as SatsrReason) ?? null, requestId: (r.request_id as string) ?? null, jobId: (r.job_id as string) ?? null,
    status: (r.status as SatsrStatus) ?? null, cacheHit: !!r.cache_hit, used: Number(r.used ?? 0),
    limit: r.limit == null ? null : Number(r.limit), workerOnline: !!r.worker_online,
  };
}

interface Row {
  request_id: string; job_id: string; status: SatsrStatus; error_code: string | null; engine: string;
  lat: number; lng: number; requested_date: string | null; scene_date: string | null; cloud_pct: number | null;
  south: number | null; west: number | null; north: number | null; east: number | null;
  width: number | null; height: number | null; products: unknown; cache_hit: boolean; queue_pos: number | null;
  created_at: string; finished_at: string | null;
}

/** The signed-in user's enhancements of the last 7 days, newest first. */
export async function fetchMyEnhancements(limit = 20): Promise<SatsrJob[]> {
  const { data, error } = await db().rpc('satsr_my_jobs', { p_limit: limit });
  if (error) throw new ServiceError('unknown', error.message, error);
  return ((data ?? []) as Row[]).map((r) => ({
    requestId: r.request_id, jobId: r.job_id, status: r.status, errorCode: r.error_code, engine: r.engine,
    lat: r.lat, lng: r.lng, requestedDate: r.requested_date, sceneDate: r.scene_date, cloudPct: r.cloud_pct,
    bounds: r.south != null && r.west != null && r.north != null && r.east != null ? [[r.south, r.west], [r.north, r.east]] : null,
    width: r.width, height: r.height,
    products: r.products && typeof r.products === 'object' ? (r.products as SatsrJob['products']) : null,
    cacheHit: r.cache_hit, queuePos: r.queue_pos, createdAt: r.created_at, finishedAt: r.finished_at,
  }));
}

/** Short-lived link to a result picture (private bucket; the storage policy checks access). */
export async function resultUrl(path: string): Promise<string | null> {
  const { data } = await db().storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/** The same, served as a file download with this name. */
export async function resultDownloadUrl(path: string, name: string): Promise<string | null> {
  const { data } = await db().storage.from(BUCKET).createSignedUrl(path, 600, { download: name });
  return data?.signedUrl ?? null;
}
