#!/usr/bin/env python3
import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('retire',pathlib.Path(__file__).resolve().parents[1]/'ops/legacy/prepare_retirement.py');M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
class Retirement(unittest.TestCase):
    def test_exact_removal_preserves_other_bytes_and_line_endings(self):
        for newline in [b'\n',b'\r\n']:
            before=b'# fictional only'+newline+b'DATABASE_URL="file:/fictional/database.db"'+newline+b'REFEREE_ADMIN_PASSWORD_HASH="scrypt\\$fictional\\$fixture"'+newline+b'UNCHANGED="fictional-other-secret"'+newline
            after=b'# fictional only'+newline+b'DATABASE_URL="file:/fictional/database.db"'+newline+b'UNCHANGED="fictional-other-secret"'+newline
            self.assertEqual(M.retire(before),after)
    def test_export_whitespace(self):self.assertEqual(M.retire(b' export REFEREE_ADMIN_PASSWORD_HASH = fixture\nOTHER=kept'),b'OTHER=kept')
    def test_dependent_expansions_require_separate_review(self):
        for value in [b'$REFEREE_ADMIN_PASSWORD_HASH',b'${REFEREE_ADMIN_PASSWORD_HASH}',b'${REFEREE_ADMIN_PASSWORD_HASH:-default}',b'"prefix-$REFEREE_ADMIN_PASSWORD_HASH"',b'\\$REFEREE_ADMIN_PASSWORD_HASH']:
            with self.subTest(value=value):
                with self.assertRaises(M.Refused):M.retire(b'REFEREE_ADMIN_PASSWORD_HASH=fixture\nOTHER='+value+b'\n')
    def test_single_backtick_escaped_quotes_and_comment(self):
        for value in [b"'fictional' # note",b'`fictional`',b'"fictional\\"value" # note']:
            self.assertEqual(M.retire(b'OTHER='+value+b'\nREFEREE_ADMIN_PASSWORD_HASH=fixture\n'),b'OTHER='+value+b'\n')
    def test_duplicates_missing_multiline_and_nul_refused(self):
        for raw in [b'OTHER=fixture\n',b'REFEREE_ADMIN_PASSWORD_HASH=x\nREFEREE_ADMIN_PASSWORD_HASH=y\n',b'OTHER="multiline\nREFEREE_ADMIN_PASSWORD_HASH=x\n"\n',b'REFEREE_ADMIN_PASSWORD_HASH=x\0',b'REFEREE_ADMIN_PASSWORD_HASH="unterminated\n',b'NOT_AN_ASSIGNMENT\nREFEREE_ADMIN_PASSWORD_HASH=x\n']:
            with self.subTest(size=len(raw)):
                with self.assertRaises(M.Refused):M.retire(raw)
if __name__=='__main__':unittest.main()
