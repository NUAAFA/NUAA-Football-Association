import hashlib
import importlib.util
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('artifact', ROOT / 'ops/deploy/prebuilt-artifact.py')
A = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(A)


class CompetitionMigrationPolicy(unittest.TestCase):
    def test_exact_forward_transition_and_rejection(self):
        with tempfile.TemporaryDirectory(prefix='nuaafa-reports-policy-') as temporary:
            parent = Path(temporary).resolve()
            new, old = parent / 'candidate', parent / 'previous'
            for target in (new, old):
                shutil.copytree(ROOT / 'prisma', target / 'prisma', ignore=shutil.ignore_patterns('*.db*'))
            for target in (new, old):
                shutil.rmtree(target / 'prisma/migrations' / next(iter(A.COMPETITION_ORDER_MIGRATION)))
                shutil.rmtree(target / 'prisma/migrations' / next(iter(A.RESOURCE_DOCUMENT_MIGRATION)))
                shutil.rmtree(target / 'prisma/migrations' / next(iter(A.LEAGUE_MIGRATION)))
            (new / 'prisma/schema.prisma').write_bytes(subprocess.check_output(['git', '-C', str(ROOT), 'show', '845b8215ef056289f4e545151bc291925cc331ec:prisma/schema.prisma']))
            name = next(iter(A.COMPETITION_REPORT_MIGRATION))
            shutil.rmtree(old / 'prisma/migrations' / name)
            (old / 'prisma/schema.prisma').write_bytes(subprocess.check_output(['git', '-C', str(ROOT), 'show', '5c86ad7c042efcac0256f20caa8644999ae37f34:prisma/schema.prisma']))
            self.assertEqual(len(A.migration_inventory(old)), 18)
            inventory = A.migration_inventory(new)
            self.assertEqual(len(inventory), 19)
            database = parent / 'synthetic.db'
            with sqlite3.connect(database) as db:
                db.execute('CREATE TABLE _prisma_migrations (migration_name TEXT,checksum TEXT,started_at INTEGER,finished_at TEXT,rolled_back_at TEXT)')
                for index, (migration, checksum) in enumerate(A.migration_inventory(old).items()):
                    db.executescript((old / 'prisma/migrations' / migration / 'migration.sql').read_text())
                    db.execute('INSERT INTO _prisma_migrations VALUES (?,?,?,\'complete\',NULL)', (migration, checksum, index))
                db.execute('INSERT INTO ContentPost (id,slug,title,summary,content,updatedAt) VALUES (\'preserved\',\'preserved\',\'Synthetic existing article\',\'Preserve\',\'{}\',\'2026-10-20\')')
            A.migration_ready(new, old, database)
            with sqlite3.connect(database) as db:
                sql = (new / 'prisma/migrations' / name / 'migration.sql').read_text()
                self.assertEqual(hashlib.sha256(sql.encode()).hexdigest(), inventory[name])
                db.executescript(sql)
                db.execute('INSERT INTO _prisma_migrations VALUES (?,?,18,\'complete\',NULL)', (name, inventory[name]))
                self.assertEqual(db.execute("SELECT title,competitionId FROM ContentPost WHERE id='preserved'").fetchone(), ('Synthetic existing article', None))
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
            A.migration_ready(new, old, database, complete=True)
            with self.assertRaises(ValueError):
                A.migration_ready(old, old, database, complete=True)
            sql_path = new / 'prisma/migrations' / name / 'migration.sql'
            original = sql_path.read_bytes()
            sql_path.write_bytes(original + b'-- unreviewed change\n')
            with self.assertRaises(ValueError):
                A.migration_inventory(new)
            sql_path.write_bytes(original)
            schema = new / 'prisma/schema.prisma'
            schema.write_bytes(schema.read_bytes() + b'\n// unreviewed change\n')
            with self.assertRaises(ValueError):
                A.migration_inventory(new)


if __name__ == '__main__':
    unittest.main()
