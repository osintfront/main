"""Choosing the picture (offline): newest clear, least-cloudy fallback, skips, fixed dates, offsets."""
from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from satsr.source import BoxStats, NoScene, Scene, SourceError, boa_offset, box_stats, pick_scene, to_reflectance  # noqa: E402


def sc(i, d, baseline="05.10"):
    return Scene(id=f"S{i}", date=date.fromisoformat(d), cloud_scene=None, baseline=baseline)


class PickTest(unittest.TestCase):
    def run_pick(self, stats, **kw):
        scenes = [sc(i, f"2026-11-{12 - i:02d}") for i in range(len(stats))]  # newest first
        seen = []

        def read(s):
            seen.append(s.id)
            st = stats[int(s.id[1:])]
            if isinstance(st, Exception):
                raise st
            return st

        return pick_scene(scenes, read, **kw), seen

    def test_newest_clear_wins(self):
        (s, c), seen = self.run_pick([BoxStats(40, 0, True), BoxStats(3, 0, True), BoxStats(0, 0, True)], max_cloud=10)
        self.assertEqual((s.id, c), ("S1", 3))
        self.assertEqual(seen, ["S0", "S1"])  # stops at the first clear one

    def test_least_cloudy_fallback(self):
        (s, c), _ = self.run_pick([BoxStats(40, 0, True), BoxStats(25, 0, True), BoxStats(60, 0, True)], max_cloud=10)
        self.assertEqual((s.id, c), ("S1", 25))

    def test_nodata_and_outside_skipped(self):
        (s, _), _ = self.run_pick([BoxStats(0, 0.05, True), BoxStats(0, 0, False), SourceError("x"), BoxStats(1, 0.01, True)])
        self.assertEqual(s.id, "S3")

    def test_fixed_date_ignores_cloud_limit(self):
        (s, c), seen = self.run_pick([BoxStats(70, 0, True), BoxStats(55, 0, True)], max_cloud=10, fixed_date=True)
        self.assertEqual((s.id, c), ("S1", 55))
        self.assertEqual(len(seen), 2)

    def test_check_limit(self):
        (s, c), seen = self.run_pick([BoxStats(50 - i, 0, True) for i in range(6)], max_cloud=10, max_checks=3)
        self.assertEqual(seen, ["S0", "S1", "S2"])
        self.assertEqual((s.id, c), ("S2", 48))

    def test_empty_is_no_scene(self):
        with self.assertRaises(NoScene):
            pick_scene([], lambda s: BoxStats(0, 0, True))
        with self.assertRaises(NoScene):
            self.run_pick([BoxStats(0, 0.5, True), BoxStats(0, 0, False)])

    def test_harmonize_only_new_baselines(self):
        self.assertEqual(boa_offset("05.10"), 1000)
        self.assertEqual(boa_offset("04.00"), 1000)
        self.assertEqual(boa_offset("03.01"), 0)
        self.assertEqual(boa_offset(None), 0)
        self.assertEqual(boa_offset("n/a"), 0)
        dn = np.array([[500, 1500, 3000]], np.uint16)
        np.testing.assert_allclose(to_reflectance(dn, "05.10", True), [[0.0, 0.05, 0.2]], atol=1e-6)
        np.testing.assert_allclose(to_reflectance(dn, "05.10", False), [[0.05, 0.15, 0.3]], atol=1e-6)
        np.testing.assert_allclose(to_reflectance(dn, "03.01", True), [[0.05, 0.15, 0.3]], atol=1e-6)

    def test_box_stats(self):
        scl = np.array([[4, 4, 8, 9], [3, 10, 0, 4]])
        b04 = np.array([[1, 1, 1, 1], [1, 1, 1, 0]])
        st = box_stats(scl, b04)
        self.assertAlmostEqual(st.nodata, 2 / 8)
        self.assertAlmostEqual(st.cloud_pct, 100 * 4 / 6)


if __name__ == "__main__":
    unittest.main()
