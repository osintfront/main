"""The worker loop: what gets recorded for each kind of failure, and that nothing kills the loop."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import worker  # noqa: E402
from satsr.engines.bicubic import Bicubic  # noqa: E402
from satsr.pipeline import Config  # noqa: E402
from satsr.source import NoScene, SourceError  # noqa: E402

CFG = Config(models_dir=HERE / "models", box_px=128)


class FakeDB:
    def __init__(self, job=None, claim_error=None, finish=None):
        self.job, self.claim_error, self.finish = job, claim_error, finish or {"updated": True, "merged": False}
        self.calls, self.uploads, self.deleted = [], [], []

    def rpc(self, fn, args):
        self.calls.append((fn, args))
        if fn == "satsr_claim":
            if self.claim_error:
                raise self.claim_error
            job, self.job = self.job, None
            return job
        if fn == "satsr_finish":
            return self.finish
        if fn == "satsr_expired":
            return self.expired.pop(0) if getattr(self, "expired", None) else []
        return None

    def upload(self, bucket, path, data, content_type="image/png"):
        self.uploads.append((bucket, path))

    def delete(self, bucket, paths):
        self.deleted.append((bucket, list(paths)))

    def finishes(self):
        return [a for f, a in self.calls if f == "satsr_finish"]


def job(attempt=1):
    return {"job_id": "j1", "engine": "bicubic_x4", "lat": 31.5, "lng": 34.45, "requested_date": None, "attempt": attempt}


def raising(e):
    def fn(*a, **k):
        raise e
    return fn


def engine_for(name):
    return Bicubic()


class LoopTest(unittest.TestCase):
    def test_no_scene_fails_at_once(self):
        db = FakeDB(job(1))
        self.assertTrue(worker.run_once(db, "me", {}, CFG, None, engine_for, raising(NoScene("none"))))
        f = db.finishes()
        self.assertEqual(len(f), 1)
        self.assertEqual((f[0]["p_status"], f[0]["p_result"]["error_code"]), ("failed", "no_scene"))

    def test_generic_error_requeued_then_failed(self):
        db = FakeDB(job(1))
        worker.run_once(db, "me", {}, CFG, None, engine_for, raising(RuntimeError("cuda oom")))
        self.assertEqual(db.finishes()[0]["p_status"], "queued")
        self.assertEqual(db.finishes()[0]["p_result"]["error_code"], "engine_error")
        db = FakeDB(job(3))
        worker.run_once(db, "me", {}, CFG, None, engine_for, raising(RuntimeError("cuda oom")))
        self.assertEqual((db.finishes()[0]["p_status"], db.finishes()[0]["p_result"]["error_code"]), ("failed", "engine_error"))

    def test_source_error_code(self):
        db = FakeDB(job(3))
        worker.run_once(db, "me", {}, CFG, None, engine_for, raising(SourceError("http 503")))
        self.assertEqual((db.finishes()[0]["p_status"], db.finishes()[0]["p_result"]["error_code"]), ("failed", "source_error"))

    def test_unknown_engine_is_engine_error(self):
        from satsr.engines import UnknownEngine

        db = FakeDB({**job(1), "engine": "nope"})
        worker.run_once(db, "me", {}, CFG, None, raising(UnknownEngine("nope")), raising(AssertionError("not reached")))
        self.assertEqual(db.finishes()[0]["p_result"]["error_code"], "engine_error")

    def test_claim_exception_does_not_kill_loop(self):
        db = FakeDB(claim_error=RuntimeError("network down"))
        self.assertFalse(worker.run_once(db, "me", {}, CFG, None, engine_for))
        db.claim_error = None
        self.assertFalse(worker.run_once(db, "me", {}, CFG, None, engine_for))  # empty queue

    def test_done_uploads_then_finishes(self):
        db = FakeDB(job(1))
        out = {"status": "done", "result": {"products": {}}, "files": {"j1/tci_sr.png": b"a", "j1/tci_lr.png": b"b"}}
        worker.run_once(db, "me", {}, CFG, None, engine_for, lambda *a: out)
        self.assertEqual(db.uploads, [("satsr-results", "j1/tci_sr.png"), ("satsr-results", "j1/tci_lr.png")])
        self.assertEqual(db.finishes()[0]["p_status"], "done")

    def test_merged_at_finish_deletes_orphans(self):
        db = FakeDB(job(1), finish={"merged": True, "into": "j0", "orphans": ["j1/tci_sr.png", "j1/tci_lr.png"]})
        out = {"status": "done", "result": {}, "files": {"j1/tci_sr.png": b"a", "j1/tci_lr.png": b"b"}}
        worker.run_once(db, "me", {}, CFG, None, engine_for, lambda *a: out)
        self.assertEqual(db.deleted, [("satsr-results", ["j1/tci_sr.png", "j1/tci_lr.png"])])

    def test_merged_early_records_nothing(self):
        db = FakeDB(job(1))
        worker.run_once(db, "me", {}, CFG, None, engine_for, lambda *a: {"status": "merged", "result": {"into": "x"}, "files": {}})
        self.assertEqual(db.finishes(), [])
        self.assertEqual(db.uploads, [])

    def test_housekeeping_deletes_expired_files(self):
        db = FakeDB()
        db.expired = [[f"j{i}/tci_sr.png" for i in range(50)], ["k/tci_lr.png"]]
        self.assertEqual(worker.housekeeping(db), 51)
        self.assertEqual(len(db.deleted), 2)


if __name__ == "__main__":
    unittest.main()
