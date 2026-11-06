# Run: python3 -m unittest tools/infra/test_build.py -v
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import build_infra  # noqa: E402
from build_infra import (  # noqa: E402
    COUNTRIES, airfield_feature, check_airfields, classify, feature_collection, missing_coastal, port_columns, port_feature, runways_for,
)


def row(**kw):
    base = {'type': 'small_airport', 'name': 'X', 'keywords': '', 'iso_country': 'LB', 'icao_code': '', 'iata_code': '',
            'ident': 'XX01', 'latitude_deg': '33.820889', 'longitude_deg': '35.488449', 'elevation_ft': '', 'municipality': ''}
    base.update(kw)
    return base


class Classify(unittest.TestCase):
    def test_air_base_is_military(self):
        self.assertEqual(classify(row(type='large_airport', name='Al Udeid Air Base', iso_country='QA', icao_code='OTBH')), 'military')

    def test_military_hospital_heliport_is_a_strip(self):
        self.assertEqual(classify(row(type='heliport', name='Zayed Military Hospital Heliport', iso_country='AE')), 'strip')

    def test_closed_wins_over_military_name(self):
        self.assertEqual(classify(row(type='closed', name='Old Air Base', iso_country='SY')), 'closed')

    def test_small_airport_with_icao_is_civil(self):
        self.assertEqual(classify(row(icao_code='OLKA')), 'civil')

    def test_small_airport_without_codes_is_a_strip(self):
        self.assertEqual(classify(row()), 'strip')

    def test_keywords_count_for_military(self):
        self.assertEqual(classify(row(type='medium_airport', name='Shayrat', keywords='Shayrat Air Base', iso_country='SY')), 'military')

    def test_country_filter(self):
        self.assertIsNone(classify(row(iso_country='IL')))
        self.assertIsNotNone(classify(row(iso_country='PS')))
        self.assertIsNone(classify(row(iso_country='FR')))
        self.assertNotIn('IL', COUNTRIES)
        self.assertEqual(len(COUNTRIES), 20)


class Runways(unittest.TestCase):
    def test_closed_runways_are_skipped_and_lengths_are_ints(self):
        rws = runways_for([
            {'airport_ident': 'OLBA', 'length_ft': '10663', 'surface': 'ASP', 'lighted': '1', 'closed': '0'},
            {'airport_ident': 'OLBA', 'length_ft': '5000', 'surface': 'GRS', 'lighted': '0', 'closed': '1'},
            {'airport_ident': 'OLBA', 'length_ft': '', 'surface': 'CON', 'lighted': '0', 'closed': '0'},
        ])
        self.assertEqual(rws['OLBA'], [{'l': 10663, 's': 'ASP', 'lit': True}])


class AirfieldFeature(unittest.TestCase):
    def test_shape(self):
        f = airfield_feature(row(type='large_airport', name='Beirut Rafic Hariri International Airport', icao_code='OLBA',
                                 iata_code='BEY', elevation_ft='87', ident='OLBA'), [{'l': 10663, 's': 'ASP', 'lit': True}])
        self.assertEqual(f['type'], 'Feature')
        self.assertEqual(f['geometry']['coordinates'], [35.48845, 33.82089])
        p = f['properties']
        self.assertTrue(set(p) <= {'k', 'n', 't', 'icao', 'iata', 'cc', 'el', 'rw'})
        self.assertEqual((p['k'], p['icao'], p['iata'], p['cc'], p['el']), ('civil', 'OLBA', 'BEY', 'LB', 87))

    def test_empty_codes_are_left_out(self):
        p = airfield_feature(row(), [])['properties']
        self.assertNotIn('icao', p)
        self.assertNotIn('iata', p)
        self.assertNotIn('el', p)
        self.assertNotIn('rw', p)

    def test_collection(self):
        fc = feature_collection([airfield_feature(row(), [])])
        self.assertEqual(fc['type'], 'FeatureCollection')
        self.assertEqual(len(fc['features']), 1)


class Ports(unittest.TestCase):
    def test_columns_csv_spelling(self):
        c = port_columns(['Main Port Name', 'Country Code', 'Latitude', 'Longitude', 'Harbor Size', 'Channel Depth (m)'])
        self.assertEqual((c['name'], c['country'], c['lat'], c['lng'], c['size'], c['ch']),
                         ('Main Port Name', 'Country Code', 'Latitude', 'Longitude', 'Harbor Size', 'Channel Depth (m)'))

    def test_columns_api_spelling(self):
        c = port_columns(['portName', 'countryName', 'ycoord', 'xcoord', 'harborSize', 'chDepth'])
        self.assertEqual((c['name'], c['country'], c['lat'], c['lng'], c['size'], c['ch']),
                         ('portName', 'countryName', 'ycoord', 'xcoord', 'harborSize', 'chDepth'))

    def test_missing_column_names_the_headers(self):
        with self.assertRaises(ValueError) as e:
            port_columns(['foo', 'bar'])
        self.assertIn('foo', str(e.exception))

    def test_port_feature(self):
        cols = port_columns(['Main Port Name', 'Country Code', 'Latitude', 'Longitude', 'Harbor Size', 'Channel Depth (m)'])
        f = port_feature({'Main Port Name': 'Beirut', 'Country Code': 'Lebanon', 'Latitude': '33.9', 'Longitude': '35.516667',
                          'Harbor Size': 'Medium', 'Channel Depth (m)': '15.5'}, cols)
        self.assertEqual(f['properties'], {'n': 'Beirut', 'cc': 'LB', 'sz': 'M', 'ch': 15.5})
        self.assertEqual(f['geometry']['coordinates'], [35.51667, 33.9])

    def test_israeli_port_is_dropped(self):
        cols = port_columns(['Main Port Name', 'Country Code', 'Latitude', 'Longitude'])
        self.assertIsNone(port_feature({'Main Port Name': 'Haifa', 'Country Code': 'Israel', 'Latitude': '32.8', 'Longitude': '35'}, cols))



class MilitaryNames(unittest.TestCase):
    # Review findings I1/I2: scheduled airports with an "Air Base" keyword stay civil; AB only in capitals; more military words.
    def test_scheduled_airport_with_air_base_keyword_stays_civil(self):
        self.assertEqual(classify(row(type='large_airport', name='Beirut Rafic Hariri International Airport', keywords='Beirut Air Base',
                                      icao_code='OLBA', scheduled_service='yes')), 'civil')

    def test_lowercase_ab_is_not_air_base(self):
        self.assertEqual(classify(row(name='Ab Pakhsh Airport', iso_country='IR')), 'strip')

    def test_more_military_words(self):
        for n in ('King Faisal Naval Base', 'RAF Troodos', 'H3 Northwest AFB', 'Korean Village Forward Operating Base', 'Ahvaz Air Defense Base'):
            self.assertEqual(classify(row(type='small_airport', name=n, iso_country='SA')), 'military', n)

    def test_raf_inside_a_word_is_not_military(self):
        self.assertEqual(classify(row(type='medium_airport', name='Rafsanjan Airport', iso_country='IR')), 'civil')

    def test_museum_and_medical_are_not_military(self):
        self.assertEqual(classify(row(type='heliport', name='El Alamein Heliport', keywords='Military Museum', iso_country='EG')), 'strip')
        self.assertEqual(classify(row(type='heliport', name='Military Medical City Heliport', iso_country='SA')), 'strip')


class PortsRobust(unittest.TestCase):
    # Review finding I4: decimal coordinates first, country spellings, coastal countries without ports.
    def test_decimal_coordinates_preferred(self):
        c = port_columns(['Main Port Name', 'Country Code', 'Latitude', 'Longitude', 'ycoord', 'xcoord'])
        self.assertEqual((c['lat'], c['lng']), ('ycoord', 'xcoord'))

    def test_country_spellings(self):
        cols = port_columns(['portName', 'countryName', 'ycoord', 'xcoord'])
        for name, iso in (('Iran (Islamic Republic of)', 'IR'), ('Turkey (Türkiye)', 'TR'), ('U.A.E.', 'AE'),
                          ('Palestinian Territory, Occupied', 'PS'), ('Saudi Arabia', 'SA')):
            f = port_feature({'portName': 'P', 'countryName': name, 'ycoord': '27', 'xcoord': '50'}, cols)
            self.assertIsNotNone(f, name)
            self.assertEqual(f['properties']['cc'], iso, name)

    def test_coastal_countries_without_ports(self):
        feats = [{'properties': {'cc': cc}} for cc in ('LB', 'SY', 'TR', 'CY', 'EG', 'SA', 'YE', 'OM', 'AE', 'QA', 'BH', 'KW', 'IQ', 'IR', 'SD', 'ER', 'DJ', 'SO')]
        self.assertEqual(missing_coastal(feats), ['PS'])
        self.assertIn('IR', missing_coastal(feats[:13]))


class BuildSafety(unittest.TestCase):
    # Review finding I5: a short airfields download is not written; exit codes tell airfields and ports apart.
    def test_airfields_floor(self):
        with self.assertRaises(ValueError):
            check_airfields(1200)
        check_airfields(2100)

    def test_exit_codes(self):
        orig = (build_infra.build_airfields, build_infra.build_ports)
        try:
            build_infra.build_airfields = lambda: None
            build_infra.build_ports = lambda: (_ for _ in ()).throw(ValueError('ports broke'))
            self.assertEqual(build_infra.main([]), 2)
            build_infra.build_airfields = lambda: (_ for _ in ()).throw(ValueError('airfields broke'))
            self.assertEqual(build_infra.main([]), 3)
        finally:
            build_infra.build_airfields, build_infra.build_ports = orig


if __name__ == '__main__':
    unittest.main()
