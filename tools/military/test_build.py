# Run: python3 -m unittest tools/military/test_build.py -v
import json
import os
import sys
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
import build_military  # noqa: E402
from build_military import area_km2, classify, dedupe, israeli, operator_cc, overpass_query, parse_overpass  # noqa: E402


def fixture(name):
    with open(os.path.join(HERE, 'fixtures', name), encoding='utf-8') as f:
        return json.load(f)


class Classify(unittest.TestCase):
    def test_bases(self):
        self.assertEqual(classify({'military': 'barracks'}), 'base')
        self.assertEqual(classify({'military': 'storage'}), 'base')
        self.assertEqual(classify({'landuse': 'military', 'name': 'X'}), 'base')

    def test_naval_by_tag_and_by_name_in_four_languages(self):
        self.assertEqual(classify({'military': 'naval_base'}), 'naval')
        self.assertEqual(classify({'landuse': 'military', 'name': 'Coast Guard Station'}), 'naval')
        for name in ('قاعدة بحرية', 'Deniz Kuvvetleri Üssü', 'نیروی دریایی'):
            self.assertEqual(classify({'landuse': 'military', 'name': name}), 'naval', name)

    def test_ranges_and_unnamed_zones(self):
        self.assertEqual(classify({'military': 'range'}), 'range')
        self.assertEqual(classify({'military': 'training_area'}), 'range')
        self.assertEqual(classify({'landuse': 'military'}), 'range')

    def test_minor(self):
        self.assertEqual(classify({'military': 'checkpoint'}), 'minor')
        self.assertEqual(classify({'military': 'bunker'}), 'minor')

    def test_skipped(self):
        for tags in ({'military': 'airfield'}, {'military': 'base', 'aeroway': 'aerodrome'}, {'military': 'base', 'disused': 'yes'},
                     {'military': 'base', 'abandoned': 'yes'}, {'military': 'trench'}, {'military': 'obstacle_course'}):
            self.assertIsNone(classify(tags), tags)


class Operator(unittest.TestCase):
    def test_keywords(self):
        self.assertEqual(operator_cc('United States Air Force'), 'US')
        self.assertEqual(operator_cc('Royal Navy'), 'GB')
        self.assertEqual(operator_cc('IRGC'), 'IR')
        self.assertEqual(operator_cc('צה"ל'), 'IL')
        self.assertEqual(operator_cc('IDF'), 'IL')
        self.assertEqual(operator_cc('Russian Aerospace Forces'), 'RU')
        self.assertIsNone(operator_cc(None))
        self.assertIsNone(operator_cc('Municipality'))


class Israel(unittest.TestCase):
    def test_israeli_operator(self):
        self.assertTrue(israeli({'military': 'base', 'operator': 'IDF'}, 'PS', 'IL', 'base'))

    def test_hebrew_script_name(self):
        self.assertTrue(israeli({'military': 'base', 'name': 'בסיס'}, 'PS', None, 'base'))

    def test_checkpoint_only_in_ps(self):
        self.assertTrue(israeli({'military': 'checkpoint'}, 'PS', None, 'minor'))
        self.assertFalse(israeli({'military': 'checkpoint'}, 'SY', None, 'minor'))

    def test_hebrew_display_name_alone_is_kept(self):
        self.assertFalse(israeli({'military': 'base', 'name': 'Camp X', 'name:he': 'מחנה'}, 'JO', None, 'base'))


class Parse(unittest.TestCase):
    def setUp(self):
        self.sites = parse_overpass(fixture('overpass_qa.json'), 'QA')
        self.by = {s['osm']: s for s in self.sites}

    def test_query_names_the_country(self):
        q = overpass_query('TR')
        self.assertIn('"ISO3166-1"="TR"', q)
        self.assertIn('nwr["landuse"="military"]', q)

    def test_five_sites_airfield_dropped(self):
        self.assertEqual(len(self.sites), 5)
        self.assertNotIn('w2004', self.by)
        self.assertEqual({s['cc'] for s in self.sites}, {'QA'})

    def test_kinds(self):
        self.assertEqual(self.by['n1001']['k'], 'minor')
        self.assertEqual(self.by['w2001']['k'], 'base')
        self.assertEqual(self.by['w2002']['k'], 'naval')
        self.assertEqual(self.by['w2003']['k'], 'range')
        self.assertEqual(self.by['r3001']['k'], 'range')

    def test_way_position_is_the_bounds_midpoint(self):
        self.assertEqual((self.by['w2001']['lat'], self.by['w2001']['lng']), (25.17, 51.315))
        self.assertEqual((self.by['n1001']['lat'], self.by['n1001']['lng']), (25.2001, 51.4002))

    def test_area_only_with_bounds(self):
        self.assertIsNone(self.by['n1001']['km2'])
        self.assertEqual(self.by['w2001']['km2'], area_km2({'minlat': 25.16, 'minlon': 51.30, 'maxlat': 25.18, 'maxlon': 51.33}))
        self.assertAlmostEqual(self.by['w2001']['km2'], 6.7, delta=0.05)

    def test_centre_is_accepted_too(self):
        data = {'elements': [{'type': 'way', 'id': 5, 'center': {'lat': 30.123456, 'lon': 31.654321}, 'tags': {'military': 'barracks'}}]}
        s = parse_overpass(data, 'EG')[0]
        self.assertEqual((s['lat'], s['lng']), (30.12346, 31.65432))

    def test_timeout_remark_is_a_failure(self):
        with self.assertRaises(ValueError):
            parse_overpass({'elements': [], 'remark': 'runtime error: Query timed out in "query" at line 1 after 301 seconds.'}, 'IR')

    def test_missing_elements_is_a_failure(self):
        with self.assertRaises(ValueError):
            parse_overpass({}, 'IR')

    def test_israeli_sites_are_dropped(self):
        data = {'elements': [
            {'type': 'node', 'id': 1, 'lat': 31.9, 'lon': 35.2, 'tags': {'military': 'checkpoint'}},
            {'type': 'node', 'id': 2, 'lat': 31.9, 'lon': 35.3, 'tags': {'military': 'base', 'operator': 'IDF'}},
            {'type': 'node', 'id': 3, 'lat': 31.5, 'lon': 34.4, 'tags': {'military': 'base', 'name': 'Palestinian Security HQ'}},
        ]}
        self.assertEqual([s['osm'] for s in parse_overpass(data, 'PS')], ['n3'])


def site(osm, k, lat, lng, name=None, km2=None):
    return {'k': k, 'lat': lat, 'lng': lng, 'cc': 'QA', 'tags': {'name': name} if name else {}, 'osm': osm, 'km2': km2}


class Dedupe(unittest.TestCase):
    def test_same_name_nearby_keeps_the_larger(self):
        out = dedupe([site('n1', 'base', 25.0, 51.0, 'Camp X'), site('w1', 'base', 25.005, 51.0, 'Camp X', 4.0)])
        self.assertEqual([s['osm'] for s in out], ['w1'])

    def test_different_names_are_kept(self):
        self.assertEqual(len(dedupe([site('n1', 'base', 25.0, 51.0, 'Camp X'), site('n2', 'base', 25.0018, 51.0, 'Camp Y')])), 2)

    def test_unnamed_neighbours_are_kept(self):
        self.assertEqual(len(dedupe([site('w1', 'range', 25.0, 51.0), site('w2', 'range', 25.0018, 51.0)])), 2)

    def test_same_name_far_apart_is_kept(self):
        self.assertEqual(len(dedupe([site('n1', 'base', 25.0, 51.0, 'Camp X'), site('n2', 'base', 25.05, 51.0, 'Camp X')])), 2)


if __name__ == '__main__':
    unittest.main()
