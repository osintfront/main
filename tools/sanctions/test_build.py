# Run: python3 -m unittest tools/sanctions/test_build.py -v
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from build_sanctions import imo_valid, imos_in, merge, vessels_from_rows  # noqa: E402


class Imo(unittest.TestCase):
    def test_check_digit(self):
        self.assertTrue(imo_valid('9074729'))
        self.assertFalse(imo_valid('9074728'))
        self.assertFalse(imo_valid('123'))
        self.assertFalse(imo_valid('90747290'))

    def test_found_in_text(self):
        self.assertEqual(imos_in('Vessel Registration Identification IMO 9074729; MMSI 123456789'), ['9074729'])
        self.assertEqual(imos_in('IMO: 9074729, IMO 9074728'), ['9074729'])
        self.assertEqual(imos_in('no number here'), [])


class Rows(unittest.TestCase):
    def test_ofac_row(self):
        row = ['36', 'ANYSHIP', 'vessel', 'IRAN', '-0-', '-0-', 'Crude Oil Tanker', '-0-', '-0-', 'Iran', '-0-',
               'Vessel Registration Identification IMO 9074729; MMSI 422000000.']
        self.assertEqual(vessels_from_rows([row], 'OFAC'), {'9074729': {'n': 'ANYSHIP', 'l': ['OFAC']}})

    def test_ofac_person_without_imo_is_ignored(self):
        self.assertEqual(vessels_from_rows([['1', 'SOMEONE', 'individual', 'SDGT', '', '', '', '', '', '', '', 'DOB 1970']], 'OFAC'), {})

    def test_uk_dict_row(self):
        row = {'Name 6': 'ANYSHIP', 'Group Type': 'Ship', 'IMO number': '9074729', 'Other Information': ''}
        self.assertEqual(vessels_from_rows([row], 'UK'), {'9074729': {'n': 'ANYSHIP', 'l': ['UK']}})

    def test_uk_imo_inside_free_text(self):
        row = {'Name 6': 'OTHER SHIP', 'Group Type': 'Ship', 'Other Information': '(IMO number):9074729 (Current owner): X'}
        self.assertEqual(vessels_from_rows([row], 'UK'), {'9074729': {'n': 'OTHER SHIP', 'l': ['UK']}})


class OnlyShips(unittest.TestCase):
    # Review finding 7: companies carry IMO company numbers; only ship rows count.
    def test_ofac_company_with_imo_number_is_ignored(self):
        row = ['99', 'SHIPPING CO LLC', 'entity', 'IRAN', '', '', '', '', '', '', '', 'Company Number IMO 9074729; Website x']
        self.assertEqual(vessels_from_rows([row], 'OFAC'), {})

    def test_uk_entity_with_imo_number_is_ignored(self):
        row = {'Name 6': 'SHIPPING CO LLC', 'Group Type': 'Entity', 'Other Information': '(IMO number):9074729'}
        self.assertEqual(vessels_from_rows([row], 'UK'), {})

    def test_uk_without_type_column_uses_only_imo_columns(self):
        self.assertEqual(vessels_from_rows([{'Name 6': 'X', 'Other Information': 'IMO 9074729'}], 'UK'), {})
        self.assertEqual(vessels_from_rows([{'Name 6': 'X', 'IMO number': '9074729'}], 'UK'), {'9074729': {'n': 'X', 'l': ['UK']}})


class Merge(unittest.TestCase):
    def test_same_ship_on_two_lists(self):
        a = {'9074729': {'n': 'ANYSHIP', 'l': ['OFAC']}}
        b = {'9074729': {'n': 'ANY SHIP', 'l': ['UK']}, '9180334': {'n': 'B', 'l': ['UK']}}
        m = merge(a, b)
        self.assertEqual(m['9074729'], {'n': 'ANYSHIP', 'l': ['OFAC', 'UK']})
        self.assertEqual(m['9180334']['l'], ['UK'])


if __name__ == '__main__':
    unittest.main()
