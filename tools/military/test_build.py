# Run: python3 -m unittest tools/military/test_build.py -v
import json
import os
import re
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(__file__)
re_qid = re.compile(r'^Q\d+$')
sys.path.insert(0, HERE)
import build_military  # noqa: E402
from build_military import (  # noqa: E402
    area_km2, classify, dedupe, israeli, merge, operator_cc, operator_facts, overpass_query, parse_overpass, parse_wikidata, site_facts,
    site_feature, check, size_guard,
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

    def test_tag_values_seen_in_the_live_data(self):
        self.assertEqual(classify({'military': 'coastguard'}), 'naval')
        self.assertEqual(classify({'military': 'danger_zone'}), 'range')
        self.assertEqual(classify({'military': 'shelter'}), 'minor')

    def test_naval_words_inside_other_words_are_not_naval(self):
        for name in ('قاعدة البحرين', 'Denizli Garnizonu', 'Akdeniz Kışlası', 'Karadeniz Bölge Komutanlığı'):
            self.assertEqual(classify({'landuse': 'military', 'name': name}), 'base', name)
        self.assertEqual(classify({'landuse': 'military', 'name': 'القاعدة البحرية'}), 'naval')

    def test_skipped(self):
        for tags in ({'military': 'airfield'}, {'military': 'base', 'aeroway': 'aerodrome'}, {'military': 'base', 'disused': 'yes'},
                     {'military': 'base', 'abandoned': 'yes'}, {'military': 'trench'}, {'military': 'obstacle_course'}):
            self.assertIsNone(classify(tags), tags)


class Operator(unittest.TestCase):
    def test_french_host_armies_are_not_france(self):
        self.assertIsNone(operator_cc('Forces Armées Djiboutiennes'))
        self.assertIsNone(operator_cc('Armée libanaise'))
        self.assertEqual(operator_cc('Forces françaises stationnées à Djibouti'), 'FR')

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

    def test_empty_answer_is_a_failure(self):
        # First run: the mirror answered Egypt with no elements and no remark; every country has some.
        with self.assertRaisesRegex(ValueError, 'EG'):
            parse_overpass({'elements': []}, 'EG')

    def test_palestine_may_be_empty(self):
        # Second run: both servers answered PS with nothing three times (its sites are Israeli and not tagged as such).
        self.assertEqual(parse_overpass({'elements': []}, 'PS'), [])

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
    def test_a_named_point_inside_a_large_area_is_the_same_base(self):
        area = site('w1', 'base', 25.117, 51.315, 'Al Udeid', 22.0)
        area['bounds'] = {'minlat': 25.095, 'minlon': 51.29, 'maxlat': 25.14, 'maxlon': 51.34}
        point = site('n1', 'base', 25.135, 51.335, 'Al Udeid')  # ~2.8 km from the centre, inside the bounds
        point['tags'].update({'wikidata': 'Q542588', 'operator': 'USAF'})
        out = dedupe([point, area])
        self.assertEqual([s['osm'] for s in out], ['w1'])
        self.assertEqual((out[0]['tags']['wikidata'], out[0]['tags']['operator']), ('Q542588', 'USAF'))

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
        self.assertEqual(u['opn'], 'United States Air Force · Royal Air Force · Qatar Emiri Air Force')  # foreign first, next to the flag
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

    def test_items_located_in_israel_are_dropped(self):
        it = wd_item('Q7', 33.0, 35.8, 'SY', en='Golan outpost')
        facts = dict(self.facts, Q7={'closed': False, 'ops': [], 'en': 'Golan outpost', 'he': None, 'il': True})
        self.assertEqual(merge([], [it], facts, self.ops), [])

    def test_hebrew_only_items_in_ps_and_sy_are_dropped(self):
        it = wd_item('Q8', 31.9, 35.2, 'PS', en=None, he='מוצב')
        self.assertEqual(merge([], [it], self.facts, self.ops), [])

    def test_p17_israel_is_recorded(self):
        ents = {'Q9': {'id': 'Q9', 'claims': {'P17': [{'mainsnak': {'snaktype': 'value', 'property': 'P17', 'datavalue': {'value': {'entity-type': 'item', 'id': 'Q801'}, 'type': 'wikibase-entityid'}}, 'type': 'statement', 'rank': 'normal'}]}}}
        self.assertTrue(site_facts(ents)['Q9']['il'])
        self.assertFalse(self.facts['Q542588']['il'])

    def test_malformed_wikidata_tag_is_ignored(self):
        s = site('n3', 'base', 20.0, 40.0, 'Camp')
        s['tags']['wikidata'] = 'Q1;Q2'
        out = merge([s], [], self.facts, self.ops)
        self.assertIsNone(out[0].get('wd'))

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

    def test_past_foreign_operators_are_not_shown(self):
        # Wikidata keeps the RAF on Egypt's canal-zone air bases (left 1956) with no end date.
        it = wd_item('Q4704083', 30.6, 32.24, 'EG', en='Al Ismailiyah Air Base', air=True)
        facts = dict(self.facts, Q4704083={'closed': False, 'ops': ['Q165862'], 'en': 'Al Ismailiyah Air Base', 'he': None})
        self.assertEqual(merge([], [it], facts, self.ops), [])
        osm = site('w11', 'base', 30.6, 32.24, 'Ismailia')
        osm['cc'] = 'EG'
        out = merge([osm], [it], facts, self.ops)[0]
        self.assertEqual((out.get('wd'), out.get('op'), out.get('f')), ('Q4704083', None, None))

    def test_former_sites_have_no_operator(self):
        s = site('w12', 'base', 25.19, 51.41, 'Former Camp As-Sayliyah (Main)')
        s['tags']['operator'] = 'United States Army'
        out = merge([s], [], self.facts, self.ops)[0]
        self.assertEqual((out.get('op'), out.get('f'), out.get('opn')), (None, None, None))

    def test_a_navy_operated_base_is_naval(self):
        s = site('w13', 'base', 34.9, 35.87, 'Material-Technical Support Point')
        s['cc'] = 'SY'
        s['tags']['operator'] = 'Russian Navy'
        self.assertEqual(merge([s], [], self.facts, self.ops)[0]['k'], 'naval')
        a = site('w14', 'base', 34.9, 35.87, 'Naval air base')
        a['air'] = True
        a['tags']['operator'] = 'United States Navy'
        self.assertEqual(merge([a], [], self.facts, self.ops)[0]['k'], 'base')  # air bases stay air bases

    def test_feature_keys(self):
        f = site_feature({'k': 'range', 'lat': 25.0, 'lng': 51.0, 'cc': 'QA', 'tags': {}, 'osm': 'w1', 'km2': None})
        self.assertEqual(f['geometry'], {'type': 'Point', 'coordinates': [51.0, 25.0]})
        self.assertEqual(set(f['properties']), {'k', 'cc', 'osm'})
        g = site_feature({'k': 'base', 'lat': 25.0, 'lng': 51.0, 'cc': 'QA', 'tags': {'name': 'معسكر', 'name:en': 'Camp', 'name:he': 'מחנה'},
                          'osm': 'w1', 'km2': 2.5, 'wd': 'Q1', 'op': 'US', 'opn': 'USAF', 'f': True})
        self.assertEqual(g['properties'], {'k': 'base', 'cc': 'QA', 'osm': 'w1', 'n': 'معسكر', 'en': 'Camp', 'he': 'מחנה', 'km2': 2.5,
                                           'wd': 'Q1', 'op': 'US', 'opn': 'USAF', 'f': True})



def feat(cc, k='base', name='Camp', km2=None):
    p = {'k': k, 'cc': cc, 'osm': 'n1'}
    if name:
        p['n'] = name
    if km2 is not None:
        p['km2'] = km2
    return {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [40.0, 30.0]}, 'properties': p}


def fake_fetch(fail=None):
    """_fetch stand-in: the QA Overpass fixture for every country, the Wikidata fixtures for Wikidata."""
    ents = fixture('wikidata_entities.json')['entities']

    def f(url, data=None):
        if fail and fail(url, data):
            raise OSError('boom')
        if url in (build_military.OVERPASS, build_military.OVERPASS_MIRROR):
            return fixture('overpass_qa.json')
        if url.startswith(build_military.ENTITIES):
            ids = url[len(build_military.ENTITIES):].split('%7C')
            return {'entities': {i: ents.get(i, {'id': i, 'missing': ''}) for i in ids}, 'success': 1}
        if url.startswith(build_military.WIKIDATA):
            return fixture('wikidata_sparql.json')
        raise AssertionError(url)
    return f


class Gate(unittest.TestCase):
    def test_size_guard_drops_small_unnamed_zones_first(self):
        named = [feat('TR', name=f'Camp {i}') for i in range(20)]
        small = [feat('TR', k='range', name=None, km2=0.01) for _ in range(20)]
        big = feat('TR', k='range', name=None, km2=3.0)
        limit = len(json.dumps({'type': 'FeatureCollection', 'features': named + [big]}, ensure_ascii=False, separators=(',', ':')).encode()) + 50
        out = size_guard(named + small + [big], limit)
        self.assertEqual(len(out), 21)
        self.assertIn(big, out)

    def test_size_guard_fails_when_still_too_big(self):
        with self.assertRaises(ValueError):
            size_guard([feat('TR')], 10)

    def test_floor_is_set_from_the_first_run(self):
        self.assertGreaterEqual(build_military.MIN_SITES, 9000)  # first run: 13,950 sites

    @mock.patch.object(build_military, 'MIN_SITES', 1000)
    def test_must_have_countries_need_openstreetmap_sites(self):
        ok = [feat(cc) for cc in ('TR', 'IR', 'SA') for _ in range(330)]
        wd_only = [feat('EG') for _ in range(24)]
        for f in wd_only:
            del f['properties']['osm']
        with self.assertRaisesRegex(ValueError, 'EG'):
            check(ok + wd_only, [])
        check(ok + [feat('EG')] + wd_only, [])

    @mock.patch.object(build_military, 'MIN_SITES', 1000)
    def test_check(self):
        ok = [feat(cc) for cc in ('TR', 'IR', 'EG', 'SA') for _ in range(250)]
        check(ok, [])
        with self.assertRaisesRegex(ValueError, 'IR'):
            check(ok, ['IR'])
        with self.assertRaises(ValueError):
            check(ok[:999], [])
        with self.assertRaisesRegex(ValueError, 'SA'):
            check([f for f in ok if f['properties']['cc'] != 'SA'] + [feat('TR')] * 300, [])

    def run_main(self, fetch, min_sites=None):
        out = tempfile.mkdtemp()
        patches = [mock.patch.object(build_military, '_fetch', fetch), mock.patch.object(build_military, 'OUT', out),
                   mock.patch.object(build_military.time, 'sleep', lambda s: None)]
        if min_sites is not None:
            patches.append(mock.patch.object(build_military, 'MIN_SITES', min_sites))
        for p in patches:
            p.start()
        try:
            code = build_military.main([])
        finally:
            for p in patches:
                p.stop()
        return code, out, sorted(os.listdir(out))

    def test_floor_not_reached_writes_nothing(self):
        self.assertEqual(self.run_main(fake_fetch())[::2], (3, []))

    def test_wikidata_down_writes_nothing(self):
        code, _, files = self.run_main(fake_fetch(lambda url, data: url.startswith(build_military.WIKIDATA)), min_sites=1)
        self.assertEqual((code, files), (3, []))

    def test_busy_server_falls_back_to_the_mirror(self):
        seen = []
        def fail(url, data):
            if data and b'IR' in data:
                seen.append(url)
                return url == build_military.OVERPASS
            return False
        code, _, files = self.run_main(fake_fetch(fail), min_sites=1)
        self.assertEqual(code, 0)
        self.assertEqual(seen[:2], [build_military.OVERPASS, build_military.OVERPASS_MIRROR])

    def test_wikidata_error_answer_is_a_failure(self):
        f = fake_fetch()
        def bad(url, data=None):
            if url.startswith(build_military.ENTITIES):
                return {'error': {'code': 'no-such-entity', 'info': 'Could not find an entity with the ID "Q1;Q2".'}}
            return f(url, data)
        self.assertEqual(self.run_main(bad, min_sites=1)[::2], (3, []))

    def test_malformed_tags_are_not_sent_to_wikidata(self):
        f = fake_fetch()
        def strict(url, data=None):
            if url == build_military.OVERPASS:
                fx = fixture('overpass_qa.json')
                fx['elements'][0]['tags']['wikidata'] = 'Q1;Q2'
                return fx
            if url.startswith(build_military.ENTITIES):
                ids = url[len(build_military.ENTITIES):].split('%7C')
                if any(not re_qid.match(i) for i in ids):
                    return {'error': {'code': 'no-such-entity'}}
            return f(url, data)
        self.assertEqual(self.run_main(strict, min_sites=1)[0], 0)

    def test_a_wikidata_hiccup_is_retried(self):
        calls = []
        def once(url, data):
            if url.startswith(build_military.WIKIDATA) and not calls:
                calls.append(url)
                return True
            return False
        code, _, files = self.run_main(fake_fetch(once), min_sites=1)
        self.assertEqual((code, len(files)), (0, 2))

    def test_a_country_down_writes_nothing(self):
        code, _, files = self.run_main(fake_fetch(lambda url, data: bool(data) and b'IR' in data), min_sites=1)
        self.assertEqual((code, files), (3, []))

    def test_success_writes_both_files(self):
        code, out, files = self.run_main(fake_fetch(), min_sites=1)
        self.assertEqual((code, files), (0, ['military-minor.geojson', 'military.geojson']))
        with open(os.path.join(out, 'military-minor.geojson'), encoding='utf-8') as f:
            minor = json.load(f)['features']
        with open(os.path.join(out, 'military.geojson'), encoding='utf-8') as f:
            main = json.load(f)['features']
        self.assertTrue(minor and all(x['properties']['k'] == 'minor' for x in minor))
        self.assertTrue(main and all(x['properties']['k'] != 'minor' for x in main))
        self.assertIn('Q542588', {x['properties'].get('wd') for x in main})


if __name__ == '__main__':
    unittest.main()
