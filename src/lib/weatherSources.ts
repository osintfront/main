// External weather sources, verified 2026-11-06 (see docs/superpowers/specs/2026-11-06-weather-layer-design.md).
//
// EUMETView WMS (EUMETSAT): Service AccessConstraints "none", Fees "none". Both layers have a TIME
// dimension every 15 minutes (ISO, e.g. 2026-11-06T07:00:00.000Z); we request whole hours.
// GFS forecast frames: rendered from NOAA GFS 0.25° (public domain) by tools/gfs/render_frames.py into
// the public Storage bucket below; the manifest lists one frame per forecast hour.

export const EUMET_WMS_URL = 'https://view.eumetsat.int/geoserver/wms';
/** Meteosat 0° SEVIRI IR 10.8 µm — clouds day and night. */
export const EUMET_LAYER_CLOUD = 'msg_fes:ir108';
/** Blended SEVIRI / LEO microwave precipitation (H SAF h60b) — observed rain. */
export const EUMET_LAYER_RAIN = 'msg_fes:h60b';

/** The box the GFS frames cover: [[south, west], [north, east]]. */
export const GFS_BOUNDS: [[number, number], [number, number]] = [[10, 25], [45, 65]];
export const WEATHER_BUCKET = 'weather';
export const GFS_MANIFEST_PATH = 'gfs/latest.json';
