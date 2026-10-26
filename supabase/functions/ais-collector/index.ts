// Ships for the map: listens to aisstream.io (free AIS feed, WebSocket) for ~50 seconds and
// stores the latest position and details of each ship in public.ais_vessels.
// Called every minute by pg_cron (header x-cron-secret). Answers at once and keeps listening
// in the background. Needs the secret AISSTREAM_API_KEY (free key from aisstream.io).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const KEY = Deno.env.get("AISSTREAM_API_KEY") ?? "";
const LISTEN_MS = 50_000;
const FLUSH_MS = 10_000;

// [[minLat, minLon], [maxLat, maxLon]]: eastern Mediterranean, Red Sea + Gulf of Aden, Persian Gulf + Gulf of Oman.
const BOXES = [
  [[29.5, 28.0], [37.5, 37.0]],
  [[11.0, 32.0], [30.5, 51.5]],
  [[22.0, 47.0], [31.0, 60.0]],
];

async function cronOk(req: Request): Promise<boolean> {
  const given = req.headers.get("x-cron-secret") ?? "";
  if (!given) return false;
  const { data } = await db.from("intel_config").select("value").eq("key", "cron_secret").maybeSingle();
  const secret = String(data?.value ?? "");
  return !!secret && given.length === secret.length && given === secret;
}

type Row = Record<string, unknown> & { mmsi: number };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, n = 60) => (typeof v === "string" ? v.replace(/@+$/g, "").trim().slice(0, n) : "");

function position(mmsi: number, p: any, at: string): Row | null {
  const lat = num(p?.Latitude), lng = num(p?.Longitude);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null; // 91 / 181 = not available
  const sog = num(p?.Sog), cog = num(p?.Cog), hdg = num(p?.TrueHeading);
  return {
    mmsi, lat, lng, at,
    sog: sog !== null && sog < 102.3 ? Math.round(sog * 10) / 10 : null,
    cog: cog !== null && cog < 360 ? Math.round(cog) : null,
    heading: hdg !== null && hdg < 360 ? hdg : null,
    nav_status: num(p?.NavigationalStatus),
  };
}

function details(mmsi: number, s: any): Row {
  const dim = s?.Dimension ?? {};
  const len = (num(dim?.A) ?? 0) + (num(dim?.B) ?? 0);
  const eta = s?.Eta && num(s.Eta.Month) ? `${String(s.Eta.Day).padStart(2, "0")}/${String(s.Eta.Month).padStart(2, "0")} ${String(s.Eta.Hour).padStart(2, "0")}:${String(s.Eta.Minute).padStart(2, "0")}` : "";
  const type = num(s?.Type) ?? num(s?.ShipType);
  return {
    mmsi,
    name: text(s?.Name, 40),
    callsign: text(s?.CallSign, 12),
    imo: num(s?.ImoNumber) && s.ImoNumber > 0 ? s.ImoNumber : null,
    ship_type: type !== null && type > 0 && type < 100 ? type : null,
    destination: text(s?.Destination, 40),
    eta,
    length_m: len > 0 && len < 600 ? len : null,
  };
}

async function listen(): Promise<{ messages: number; saved: number; error?: string }> {
  const positions = new Map<number, Row>();
  const statics = new Map<number, Row>();
  let messages = 0, saved = 0;
  let error: string | undefined;

  const flush = async () => {
    if (!positions.size && !statics.size) return;
    const rows: Row[] = [];
    for (const [mmsi, p] of positions) rows.push({ ...(statics.get(mmsi) ?? {}), ...p });
    for (const [mmsi, s] of statics) if (!positions.has(mmsi)) rows.push(s);
    positions.clear();
    statics.clear();
    for (let i = 0; i < rows.length; i += 800) {
      const { data, error: e } = await db.rpc("ais_upsert", { p_rows: rows.slice(i, i + 800) });
      if (e) { error = e.message; console.error("ais upsert failed", e.message); }
      else saved += Number(data ?? 0);
    }
  };

  await new Promise<void>((done) => {
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    const timer = setInterval(() => void flush(), FLUSH_MS);
    const stop = setTimeout(() => ws.close(), LISTEN_MS);
    ws.onopen = () => ws.send(JSON.stringify({
      APIKey: KEY,
      BoundingBoxes: BOXES,
      FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport", "ShipStaticData", "StaticDataReport"],
    }));
    ws.onmessage = async (ev) => {
      try {
        const raw = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data instanceof Blob ? await ev.data.arrayBuffer() : ev.data);
        const m = JSON.parse(raw);
        if (m?.error) { error = String(m.error).slice(0, 200); ws.close(); return; }
        messages++;
        const meta = m?.MetaData ?? {};
        const mmsi = Number(meta.MMSI);
        if (!Number.isFinite(mmsi) || mmsi <= 0) return;
        const at = (() => { const d = new Date(String(meta.time_utc ?? "").replace(" +0000 UTC", "Z").replace(/\.\d+/, "")); return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(); })();
        const body = m?.Message ?? {};
        const t = String(m?.MessageType ?? "");
        if (t === "PositionReport" || t === "StandardClassBPositionReport" || t === "ExtendedClassBPositionReport") {
          const p = position(mmsi, body[t], at);
          if (p) positions.set(mmsi, p);
          if (t === "ExtendedClassBPositionReport") statics.set(mmsi, { ...(statics.get(mmsi) ?? {}), ...details(mmsi, body[t]) });
          if (!statics.has(mmsi) && text(meta.ShipName)) statics.set(mmsi, { mmsi, name: text(meta.ShipName, 40) });
        } else if (t === "ShipStaticData") {
          statics.set(mmsi, { ...(statics.get(mmsi) ?? {}), ...details(mmsi, body[t]) });
        } else if (t === "StaticDataReport") {
          const r = body[t] ?? {};
          const a = r?.ReportA ?? {}, b = r?.ReportB ?? {};
          const prev = statics.get(mmsi) ?? { mmsi };
          statics.set(mmsi, {
            ...prev,
            ...(a?.Valid && text(a?.Name) ? { name: text(a.Name, 40) } : {}),
            ...(b?.Valid ? { ship_type: num(b?.ShipType) || null, callsign: text(b?.CallSign, 12) } : {}),
          });
        }
      } catch { /* a bad message: skip it */ }
    };
    ws.onerror = (e) => { error = `websocket: ${String((e as ErrorEvent)?.message ?? "error").slice(0, 160)}`; };
    ws.onclose = () => { clearInterval(timer); clearTimeout(stop); done(); };
  });
  await flush();
  return { messages, saved, ...(error ? { error } : {}) };
}

Deno.serve(async (req) => {
  if (!(await cronOk(req))) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  if (!KEY) return new Response(JSON.stringify({ ok: false, error: "AISSTREAM_API_KEY not set" }), { headers: { "content-type": "application/json" } });
  const body = await req.json().catch(() => ({}));
  if (body?.wait === true) {
    // Manual test: wait for the result.
    return new Response(JSON.stringify({ ok: true, ...(await listen()) }), { headers: { "content-type": "application/json" } });
  }
  EdgeRuntime.waitUntil(listen().then((r) => console.log("ais", JSON.stringify(r))));
  return new Response(JSON.stringify({ ok: true, listening: LISTEN_MS / 1000 }), { headers: { "content-type": "application/json" } });
});
