# Run: python3 -m unittest tools/gfs/test_render.py -v
import os
import sys
import unittest
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from render_frames import cloud_rgba, manifest, merc_rows, rain_rgba, resample  # noqa: E402


def hex_rgb(h: str):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


class MercRows(unittest.TestCase):
    def test_rows_span_the_box_top_to_bottom(self):
        rows = merc_rows(45, 10, 100)
        self.assertEqual(len(rows), 100)
        self.assertAlmostEqual(rows[0], 44.8, delta=0.1)
        self.assertAlmostEqual(rows[-1], 10.2, delta=0.1)
        self.assertTrue(np.all(np.diff(rows) < 0))

    def test_rows_are_even_in_mercator_not_in_latitude(self):
        rows = merc_rows(45, 10, 100)
        step_north = rows[0] - rows[1]
        step_south = rows[-2] - rows[-1]
        self.assertGreater(step_south, step_north)


class Colours(unittest.TestCase):
    def test_cloud_alpha(self):
        out = cloud_rgba(np.array([0.0, 10.0, 100.0]))
        self.assertEqual(out[:, 3].tolist(), [0, 0, 216])
        self.assertEqual(out[2, :3].tolist(), hex_rgb('#f1f5f9'))

    def test_rain_bands(self):
        out = rain_rgba(np.array([0.05, 0.3, 12.0]))
        self.assertEqual(out[0, 3], 0)
        self.assertEqual(out[1, :3].tolist(), hex_rgb('#93c5fd'))
        self.assertEqual(out[2, :3].tolist(), hex_rgb('#dc2626'))
        self.assertEqual(out[1, 3], 210)


class Resample(unittest.TestCase):
    def test_constant_grid_stays_constant(self):
        lats = np.arange(45, 9.99, -0.25)
        lons = np.arange(25, 65.01, 0.25)
        grid = np.full((len(lats), len(lons)), 7.0)
        out = resample(grid, lats, lons, 80)
        self.assertEqual(out.shape[1], 80)
        self.assertTrue(np.allclose(out, 7.0))

    def test_gradient_follows_latitude(self):
        lats = np.arange(45, 9.99, -0.25)
        lons = np.arange(25, 65.01, 0.25)
        grid = np.repeat(lats[:, None], len(lons), axis=1)
        out = resample(grid, lats, lons, 80)
        self.assertAlmostEqual(out[0, 0], merc_rows(45, 10, out.shape[0])[0], delta=0.01)


class Manifest(unittest.TestCase):
    def test_frames_and_paths(self):
        m = manifest(datetime(2026, 11, 6, 6, tzinfo=timezone.utc), [1, 2])
        self.assertEqual(m['run'], '2026-11-06T06:00:00Z')
        self.assertEqual(m['bounds'], [[10, 25], [45, 65]])
        self.assertEqual([f['time'] for f in m['frames']], ['2026-11-06T07:00:00Z', '2026-11-06T08:00:00Z'])
        self.assertEqual(m['frames'][0]['cloud'], 'gfs/2026110606/cloud/001.png')
        self.assertEqual(m['frames'][1]['rain'], 'gfs/2026110606/rain/002.png')


try:
    import eccodes
except ImportError:  # the workflow installs it; plain test runs may not have it
    eccodes = None


def _grib(short: str, value: float, step_type: str = 'instant') -> bytes:
    gid = eccodes.codes_grib_new_from_samples('regular_ll_sfc_grib2')
    for k, v in [('Ni', 161), ('Nj', 141), ('latitudeOfFirstGridPointInDegrees', 45.0), ('latitudeOfLastGridPointInDegrees', 10.0),
                 ('longitudeOfFirstGridPointInDegrees', 25.0), ('longitudeOfLastGridPointInDegrees', 65.0),
                 ('iDirectionIncrementInDegrees', 0.25), ('jDirectionIncrementInDegrees', 0.25), ('jScansPositively', 0)]:
        eccodes.codes_set(gid, k, v)
    eccodes.codes_set(gid, 'shortName', short)
    if step_type != 'instant':
        eccodes.codes_set(gid, 'stepType', step_type)
    eccodes.codes_set_values(gid, np.full(161 * 141, value))
    out = eccodes.codes_get_message(gid)
    eccodes.codes_release(gid)
    return out


@unittest.skipIf(eccodes is None, 'eccodes not installed')
class Decode(unittest.TestCase):
    def test_reads_cloud_percent_and_rain_mm_per_hour(self):
        from render_frames import decode
        lats, lons, tcc, rain = decode(_grib('tcc', 55.0) + _grib('prate', 0.001))
        self.assertEqual(tcc.shape, (141, 161))
        self.assertAlmostEqual(lats[0], 45.0)
        self.assertAlmostEqual(lons[-1], 65.0)
        self.assertTrue(np.allclose(tcc, 55.0, atol=0.5))
        self.assertTrue(np.allclose(rain, 3.6, atol=0.05))  # 0.001 kg m-2 s-1 = 3.6 mm/h

    def test_missing_field_is_an_error(self):
        from render_frames import decode
        with self.assertRaises(RuntimeError):
            decode(_grib('tcc', 55.0))


if __name__ == '__main__':
    unittest.main()
