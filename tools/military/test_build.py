# Run: python3 -m unittest tools/military/test_build.py -v
import json
import os
import sys
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
import build_military  # noqa: E402
from build_military import (  # noqa: E402
    area_km2, classify, dedupe, israeli, merge, operator_cc, operator_facts, overpass_query, parse_overpass, parse_wikidata, site_facts,
    site_feature,
)


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



def wd_item(qid, lat, lng, cc, en='X', naval=False, air=False, historic=False, he=None):
    return {'qid': qid, 'lat': lat, 'lng': lng, 'cc': cc, 'en': en, 'he': he, 'naval': naval, 'air': air, 'historic': historic}


class Wikidata(unittest.TestCase):
    def setUp(self):
        self.items = parse_wikidata(fixture('wikidata_sparql.json'))
        self.ents = fixture('wikidata_entities.json')['entities']
        self.facts = site_facts(self.ents)
        self.ops = operator_facts(self.ents)
        self.by = {i['qid']: i for i in self.items}

    def test_parse(self):
        self.assertEqual(len(self.items), 9)
        k = self.by['Q21582584']
        self.assertEqual((k['lat'], k['lng'], k['cc'], k['he']), (35.4125, 35.94167, 'SY', 'חמיימים'))
        self.assertTrue(self.by['Q542588']['air'])
        self.assertTrue(self.by['Q16687270']['naval'])
        self.assertFalse(self.by['Q1627463']['historic'])  # "former hospital" is not a ruin

    def test_label_equal_to_qid_is_no_name(self):
        self.assertIsNone(self.by['Q16687270']['en'])

    def test_historic_classes(self):
        data = {'results': {'bindings': [{'item': {'value': 'http://www.wikidata.org/entity/Q1'}, 'itemLabel': {'value': 'Old Fort'},
                                          'coord': {'value': 'Point(35 33)'}, 'cc': {'value': 'LB'}, 'classes': {'value': 'barracks|ruins'}}]}}
        self.assertTrue(parse_wikidata(data)[0]['historic'])

    def test_bad_answer(self):
        with self.assertRaises(ValueError):
            parse_wikidata({'error': 'timeout'})

    def test_site_facts(self):
        self.assertTrue(self.facts['Q7275300']['closed'])
        self.assertFalse(self.facts['Q542588']['closed'])
        self.assertEqual(self.facts['Q542588']['ops'], ['Q17485530', 'Q11223', 'Q165862'])
        self.assertEqual(self.facts['Q900001']['ops'], [])  # ended and deprecated operators ignored

    def test_operator_country(self):
        cc = {q: o['cc'] for q, o in self.ops.items()}
        self.assertEqual(cc['Q520693'], 'US')   # USAFE: P17 says Germany, the name says United States
        self.assertEqual(cc['Q820827'], 'FR')   # "dissolved" 2020 = renamed; still French
        self.assertEqual(cc['Q17485530'], 'QA')  # from P17
        self.assertEqual(cc['Q2556685'], 'AE')
        self.assertEqual(cc['Q1065'], 'UN')
        self.assertIsNone(cc['Q7915590'])       # Soviet: a dissolved state

    def merged(self, sites=None, items=None):
        return merge(sites if sites is not None else parse_overpass(fixture('overpass_qa.json'), 'QA'),
                     items if items is not None else self.items, self.facts, self.ops)

    def test_foreign_air_bases_are_added(self):
        by = {s.get('wd'): s for s in self.merged()}
        u = by['Q542588']
        self.assertEqual((u['k'], u['air'], u['f'], u['op'], u['cc']), ('base', True, True, 'US', 'QA'))
        self.assertEqual(u['opn'], 'Qatar Emiri Air Force · United States Air Force · Royal Air Force')
        self.assertEqual(by['Q1083424']['op'], 'US')
        self.assertEqual(by['Q21582584']['op'], 'RU')
        self.assertEqual(by['Q2886453']['op'], 'FR')

    def test_closed_and_host_air_bases_are_not_added(self):
        wds = {s.get('wd') for s in self.merged()}
        self.assertNotIn('Q7275300', wds)
        host = wd_item('Q5', 24.0, 47.0, 'SA', air=True)
        facts = dict(self.facts, Q5={'closed': False, 'ops': ['Q17485530'], 'en': None, 'he': None})
        self.assertEqual(merge([], [host], facts, dict(self.ops, Q17485530={'name': 'Royal Saudi Air Force', 'cc': 'SA'})), [])

    def test_other_wikidata_sites(self):
        by = {s.get('wd'): s for s in self.merged()}
        self.assertEqual(by['Q4327132']['k'], 'base')
        self.assertNotIn('op', {k for k, v in by['Q4327132'].items() if v})      # Soviet operator ignored
        self.assertEqual((by['Q123128037']['op'], by['Q123128037']['f']), ('UN', True))
        self.assertEqual(by['Q16687270']['k'], 'naval')
        self.assertEqual(by['Q1627463']['k'], 'base')

    def test_osm_tag_match_and_ended_operator(self):
        s = next(s for s in self.merged() if s['osm'] == 'w2001')
        self.assertEqual(s['wd'], 'Q900001')
        self.assertFalse(s.get('f'))
        self.assertIsNone(s.get('op'))

    def test_distance_match(self):
        nokra = self.by['Q4327132']
        near = site('n9', 'base', nokra['lat'] + 2.9 / 111.2, nokra['lng'], 'Dahlak Base')
        far = site('n8', 'base', nokra['lat'] + 3.1 / 111.2, nokra['lng'], 'Dahlak Base')
        self.assertEqual([s.get('wd') for s in merge([near], [nokra], self.facts, self.ops)], ['Q4327132'])
        self.assertEqual(sorted(str(s.get('wd')) for s in merge([far], [nokra], self.facts, self.ops)), ['None', 'Q4327132'])

    def test_ranges_are_not_matched(self):
        nokra = self.by['Q4327132']
        r = site('w7', 'range', nokra['lat'], nokra['lng'])
        self.assertEqual(len(merge([r], [nokra], self.facts, self.ops)), 2)

    def test_israeli_operated_is_dropped(self):
        it = wd_item('Q6', 31.9, 35.2, 'PS')
        facts = dict(self.facts, Q6={'closed': False, 'ops': ['Q50'], 'en': None, 'he': None})
        ops = dict(self.ops, Q50={'name': 'Israel Defense Forces', 'cc': 'IL'})
        osm = site('n5', 'base', 31.9, 35.2, 'Some Camp')
        osm['cc'] = 'PS'
        self.assertEqual(merge([osm], [it], facts, ops), [])

    def test_osm_operator_text(self):
        s = site('n4', 'naval', 11.55, 43.15, 'Camp Lemonnier')
        s['cc'] = 'DJ'
        s['tags']['operator'] = 'United States Navy'
        out = merge([s], [], self.facts, self.ops)[0]
        self.assertEqual((out['op'], out['f'], out['opn']), ('US', True, 'United States Navy'))

    def test_wikidata_operator_wins(self):
        k = self.by['Q21582584']
        s = site('w6', 'base', k['lat'], k['lng'], 'Hmeimim')
        s['cc'] = 'SY'
        s['tags']['operator'] = 'Turkish Army'
        out = merge([s], [k], self.facts, self.ops)
        self.assertEqual([(o['op'], o['wd']) for o in out], [('RU', 'Q21582584')])

    def test_feature_keys(self):
        f = site_feature({'k': 'range', 'lat': 25.0, 'lng': 51.0, 'cc': 'QA', 'tags': {}, 'osm': 'w1', 'km2': None})
        self.assertEqual(f['geometry'], {'type': 'Point', 'coordinates': [51.0, 25.0]})
        self.assertEqual(set(f['properties']), {'k', 'cc', 'osm'})
        g = site_feature({'k': 'base', 'lat': 25.0, 'lng': 51.0, 'cc': 'QA', 'tags': {'name': 'معسكر', 'name:en': 'Camp', 'name:he': 'מחנה'},
                          'osm': 'w1', 'km2': 2.5, 'wd': 'Q1', 'op': 'US', 'opn': 'USAF', 'f': True})
        self.assertEqual(g['properties'], {'k': 'base', 'cc': 'QA', 'osm': 'w1', 'n': 'معسكر', 'en': 'Camp', 'he': 'מחנה', 'km2': 2.5,
                                           'wd': 'Q1', 'op': 'US', 'opn': 'USAF', 'f': True})


if __name__ == '__main__':
    unittest.main()
