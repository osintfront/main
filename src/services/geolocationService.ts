import { supabase } from '@/integrations/supabase/client';
import { ServiceError } from './serviceError';

/**
 * Terrain geolocation of an event's photo (Max / Intel). Jobs are run by the
 * local geolocation worker; the database decides what each caller may see
 * (geoloc_for_event): subscribers get finished high/medium results, staff
 * everything. Camera points stay null until staff release them.
 */
export type GeolocStatus = 'queued' | 'running' | 'done' | 'needs_review' | 'failed' | 'skipped';

export interface GeolocResult {
  id: string;
  status: GeolocStatus;
  confidence: 'high' | 'medium' | 'low' | null;
  targetLat: number | null;
  targetLng: number | null;
  targetLabel: string | null;
  cameraLat: number | null;
  cameraLng: number | null;
  cameraHeading: number | null;
  hfov: number | null;
  fitRmsPx: number | null;
  holdoutRmsPx: number | null;
  notes: string[];
  proofTarget: string | null;
  proofFull: string | null;
  cameraReleased: boolean;
  finishedAt: string | null;
}

function db() {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  return supabase;
}

interface Row {
  id: string; status: GeolocStatus; confidence: GeolocResult['confidence'];
  target_lat: number | null; target_lng: number | null; target_label: string | null;
  camera_lat: number | null; camera_lng: number | null; camera_heading: number | null; hfov: number | null;
  fit_rms_px: number | null; holdout_rms_px: number | null; notes: unknown;
  proof_target: string | null; proof_full: string | null; camera_released: boolean; finished_at: string | null;
}

export async function fetchGeolocation(eventId: string): Promise<GeolocResult[]> {
  const { data, error } = await db().rpc('geoloc_for_event', { p_event: eventId });
  if (error) throw new ServiceError('unknown', error.message, error);
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id, status: r.status, confidence: r.confidence,
    targetLat: r.target_lat, targetLng: r.target_lng, targetLabel: r.target_label,
    cameraLat: r.camera_lat, cameraLng: r.camera_lng, cameraHeading: r.camera_heading, hfov: r.hfov,
    fitRmsPx: r.fit_rms_px, holdoutRmsPx: r.holdout_rms_px,
    notes: Array.isArray(r.notes) ? (r.notes as unknown[]).filter((n): n is string => typeof n === 'string') : [],
    proofTarget: r.proof_target, proofFull: r.proof_full, cameraReleased: r.camera_released, finishedAt: r.finished_at,
  }));
}

/** 'plan' = not on Max; 'limit' = daily requests used up; 'no_media' = nothing to geolocate. */
export class GeolocRequestError extends Error {
  constructor(public reason: 'plan' | 'limit' | 'no_media' | 'other', message: string) { super(message); }
}

export async function requestGeolocation(eventId: string): Promise<string> {
  const { data, error } = await db().rpc('request_geolocation', { p_event: eventId });
  if (error) {
    const m = error.message || '';
    if (m.includes('daily geolocation limit')) throw new GeolocRequestError('limit', m);
    if (m.startsWith('plan:')) throw new GeolocRequestError('plan', m);
    if (m.includes('no photo or video')) throw new GeolocRequestError('no_media', m);
    throw new GeolocRequestError('other', m);
  }
  return data as string;
}

/** Staff: release the camera point to subscribers and/or set the status (approve / reject / re-run). */
export async function reviewGeolocation(id: string, opts: { releaseCamera?: boolean; status?: GeolocStatus }) {
  const { error } = await db().rpc('geoloc_review', {
    p_id: id, p_release_camera: opts.releaseCamera ?? null, p_status: opts.status ?? null,
  });
  if (error) throw new ServiceError('permission_denied', error.message, error);
}

/** Short-lived link to a proof board (private bucket; the storage policy checks access). */
export async function proofUrl(path: string): Promise<string | null> {
  const { data } = await db().storage.from('geoloc-proofs').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
