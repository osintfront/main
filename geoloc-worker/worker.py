"""
Osintfront geolocation worker — runs on your own computer.

Takes queued geolocation jobs from the site (photos and video thumbnails of
events that have a place), matches the photo's skyline to Copernicus 30 m
elevation data around that place, and writes back the camera point, the target
point, a confidence grade and two proof boards (one without the camera).

Run:  start.bat   (or: python worker.py)      One job only:  python worker.py --once
"""
from __future__ import annotations

import argparse
import logging
import os
import socket
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from geoloc.db import Supabase  # noqa: E402
from geoloc.llm import Vision  # noqa: E402
from geoloc.pipeline import Config, process  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(HERE / "worker.log", encoding="utf-8")],
)
log = logging.getLogger("worker")


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
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ANTHROPIC_API_KEY"):
        if not env.get(k):
            sys.exit(f".env: {k} is empty")
    return env


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="process one job and exit")
    args = ap.parse_args()

    env = load_env()
    sb = Supabase(env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"])
    vision = Vision(env["ANTHROPIC_API_KEY"], env.get("SCENE_MODEL") or "claude-opus-5-5",
                    env.get("TRIAGE_MODEL", "claude-haiku-5-5") or None)
    cfg = Config(cache_dir=HERE / "cache", radius_km=float(env.get("SEARCH_RADIUS_KM") or 12),
                 workers=int(env["CPU_WORKERS"]) if env.get("CPU_WORKERS") else None)
    poll = float(env.get("POLL_SECONDS") or 20)
    me = f"{socket.gethostname()}:{os.getpid()}"
    log.info("geolocation worker %s started (scene model %s)", me, vision.scene_model)

    while True:
        try:
            job = sb.rpc("geoloc_claim", {"p_worker": me})
        except Exception as e:  # noqa: BLE001 - network blips: wait and retry
            log.warning("claim failed: %s", e)
            time.sleep(poll)
            continue
        if not job:
            if args.once:
                log.info("queue empty")
                return
            time.sleep(poll)
            continue

        jid = job["job_id"]
        log.info("job %s: event %s — %s", jid, job["event"]["id"], (job["event"].get("title") or "")[:80])
        t0 = time.time()
        try:
            out = process(job, cfg, vision)
            res = out["result"]
            for kind, png in (out.get("boards") or {}).items():
                res[f"proof_{kind}"] = sb.upload("geoloc-proofs", f"{jid}/{kind}.png", png)
            sb.rpc("geoloc_finish", {"p_id": jid, "p_status": out["status"], "p_result": res})
            log.info("job %s → %s (%s) in %.0fs %s", jid, out["status"], res.get("confidence") or "-",
                     time.time() - t0, res.get("error") or "")
        except Exception as e:  # noqa: BLE001 - record the failure on the job, keep the worker alive
            log.error("job %s failed: %s\n%s", jid, e, traceback.format_exc())
            try:
                status = "queued" if job.get("attempt", 1) < 3 else "failed"
                sb.rpc("geoloc_finish", {"p_id": jid, "p_status": status, "p_result": {"error": str(e)[:1900]}})
            except Exception as e2:  # noqa: BLE001
                log.error("could not record failure: %s", e2)
        if args.once:
            return


if __name__ == "__main__":
    main()
