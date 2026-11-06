# Run: python3 -m unittest tools/infra/test_build.py -v
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from build_infra import (  # noqa: E402
    COUNTRIES, airfield_feature, classify, feature_collection, port_columns, port_feature, runways_for,
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


if __name__ == '__main__':
    unittest.main()
