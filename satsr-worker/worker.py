"""
Osintfront satellite enhance worker — runs on your own computer.

Takes queued "Enhance ×4" jobs from the site, reads a 2.56 km box of Sentinel-2
(red, green, blue, near infrared at 10 m) from Microsoft Planetary Computer,
super-resolves it ×4 to 2.5 m with SEN2SR, and uploads a before and an after
picture for each product (true colour, infrared, NDVI) to the private bucket.

Run:  start.bat   (or: python worker.py)      One job only:  python worker.py --once
"""
from __future__ import annotations

import argparse
import logging
import os
import socket
import sys
import threading
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from satsr import __version__  # noqa: E402
from satsr.db import Supabase  # noqa: E402
from satsr.engines import get_engine  # noqa: E402
from satsr.pipeline import Config, process  # noqa: E402
from satsr.source import NoScene, SourceError  # noqa: E402

log = logging.getLogger("worker")
BUCKET = "satsr-results"
DEFAULT_ENGINE = "sen2sr_lite_rgbn_x4"
MAX_ATTEMPTS = 3


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(HERE / "worker.log", encoding="utf-8")],
    )


def load_env() -> dict[str, str]:
    path = HERE / ".env"
    if not path.exists():
        sys.exit("Missing .env — copy .env.example to .env and fill it in.")
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
        if not env.get(k):
            sys.exit(f".env: {k} is empty")
    return env


def classify(e: BaseException) -> str:
    if isinstance(e, NoScene):
        return "no_scene"
    if isinstance(e, SourceError):
        return "source_error"
    return "engine_error"


def run_job(job: dict, sb, cfg: Config, source, engine_for, process_fn=process) -> str:
    """Process one claimed job and record the outcome. Never raises. Returns the recorded status."""
    jid = job["job_id"]
    t0 = time.time()
    try:
        engine = engine_for(job.get("engine") or DEFAULT_ENGINE)
        out = process_fn(job, cfg, source, engine, sb)
        if out["status"] in ("merged", "gone"):
            log.info("job %s → %s %s", jid, out["status"], out["result"].get("into") or "")
            return out["status"]
        for path, png in out["files"].items():
            sb.upload(BUCKET, path, png)
        fin = sb.rpc("satsr_finish", {"p_id": jid, "p_status": "done", "p_result": out["result"]}) or {}
        if fin.get("merged") and fin.get("orphans"):
            # Someone else finished the same picture a moment earlier: our copies are not needed.
            try:
                sb.delete(BUCKET, list(fin["orphans"]))
            except Exception as e2:  # noqa: BLE001
                log.warning("could not delete orphans of %s: %s", jid, e2)
        log.info("job %s → done%s in %.0fs", jid, " (merged)" if fin.get("merged") else "", time.time() - t0)
        return "done"
    except Exception as e:  # noqa: BLE001 - record the failure on the job, keep the worker alive
        code = classify(e)
        attempt = int(job.get("attempt") or 1)
        status = "failed" if code == "no_scene" or attempt >= MAX_ATTEMPTS else "queued"
        if code == "no_scene":
            log.info("job %s: no picture (%s)", jid, e)
        else:
            log.error("job %s failed (%s, attempt %s): %s\n%s", jid, code, attempt, e, traceback.format_exc())
        try:
            sb.rpc("satsr_finish", {"p_id": jid, "p_status": status, "p_result": {"error_code": code, "error": str(e)[:1900]}})
        except Exception as e2:  # noqa: BLE001
            log.error("could not record failure: %s", e2)
        return status


def run_once(sb, me: str, info: dict, cfg: Config, source, engine_for, process_fn=process) -> bool:
    """Claim and process one job. False when the queue is empty or the claim failed."""
    try:
        job = sb.rpc("satsr_claim", {"p_worker": me, "p_info": info})
    except Exception as e:  # noqa: BLE001 - network blips: wait and retry
        log.warning("claim failed: %s", e)
        return False
    if not job:
        return False
    log.info("job %s: %.4f, %.4f %s (attempt %s)", job["job_id"], float(job["lat"]), float(job["lng"]),
             job.get("requested_date") or "newest", job.get("attempt"))
    run_job(job, sb, cfg, source, engine_for, process_fn)
    return True


def housekeeping(sb) -> int:
    """Delete results older than the retention period (database rows, then the files)."""
    n = 0
    while True:
        paths = sb.rpc("satsr_expired", {"p_limit": 50}) or []
        if not paths:
            return n
        sb.delete(BUCKET, list(paths))
        n += len(paths)
        if len(paths) < 50:
            return n


def heartbeat_loop(sb, me: str, info: dict, stop: threading.Event, every: float = 30.0):
    """Tells the site the worker is on, also during a long job (online = seen in the last 3 minutes)."""
    while not stop.wait(every):
        try:
            sb.rpc("satsr_heartbeat", {"p_worker": me, "p_info": info})
        except Exception as e:  # noqa: BLE001
            log.warning("heartbeat failed: %s", e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="process one job and exit")
    args = ap.parse_args()
    setup_logging()

    env = load_env()
    sb = Supabase(env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"])
    box = int(env.get("BOX_PX") or 256)
    if box < 128:
        sys.exit(".env: BOX_PX must be at least 128")
    cfg = Config(models_dir=HERE / "models", box_px=box, max_cloud=float(env.get("MAX_CLOUD") or 10),
                 harmonize=(env.get("HARMONIZE") or "1").strip().lower() not in ("0", "false", "no"))
    poll = float(env.get("POLL_SECONDS") or 15)
    threads = int(env["TORCH_THREADS"]) if env.get("TORCH_THREADS") else None

    from satsr.source import PlanetaryComputerSource

    source = PlanetaryComputerSource(harmonize=cfg.harmonize)
    engine_for = lambda name: get_engine(name, cfg.models_dir, threads)  # noqa: E731
    preload = env.get("ENGINE") or DEFAULT_ENGINE
    engine = engine_for(preload)  # load (and on the first run download) the model before taking jobs
    me = f"{socket.gethostname()}:{os.getpid()}"
    info = {"engine": engine.name, "device": getattr(engine, "device", "?"), "version": __version__, "box_px": cfg.box_px}
    log.info("satellite enhance worker %s started (%s on %s, box %d px)", me, engine.name, info["device"], cfg.box_px)

    stop = threading.Event()
    threading.Thread(target=heartbeat_loop, args=(sb, me, info, stop), daemon=True).start()
    last_clean = 0.0
    try:
        while True:
            worked = run_once(sb, me, info, cfg, source, engine_for)
            if args.once:
                if not worked:
                    log.info("queue empty")
                return
            if worked:
                continue
            if time.time() - last_clean > 3600:
                last_clean = time.time()
                try:
                    n = housekeeping(sb)
                    if n:
                        log.info("removed %d expired files", n)
                except Exception as e:  # noqa: BLE001
                    log.warning("housekeeping failed: %s", e)
            time.sleep(poll)
    finally:
        stop.set()


if __name__ == "__main__":
    main()
