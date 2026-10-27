"""Verify the exact 19-to-20 migration without production data or relaxed guards."""
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


class ResourceReadiness(unittest.TestCase):
    def test_exact_forward_and_rejection(self):
        with tempfile.TemporaryDirectory(prefix='nuaafa-resources-policy-') as temporary:
            parent = Path(temporary).resolve()
            new, old = parent / 'candidate', parent / 'previous'
            name = next(iter(A.RESOURCE_DOCUMENT_MIGRATION))
            for target in (new, old):
                shutil.copytree(ROOT / 'prisma', target / 'prisma', ignore=shutil.ignore_patterns('*.db*'))
                shutil.rmtree(target / 'prisma/migrations' / next(iter(A.LEAGUE_MIGRATION)))
            (new / 'prisma/schema.prisma').write_bytes(subprocess.check_output(['git', '-C', str(ROOT), 'show', 'e553429:prisma/schema.prisma']))
            shutil.rmtree(old / 'prisma/migrations' / name)
            (old / 'prisma/schema.prisma').write_bytes(subprocess.check_output([
                'git', '-C', str(ROOT), 'show', '845b8215ef056289f4e545151bc291925cc331ec:prisma/schema.prisma']))
            self.assertEqual(len(A.migration_inventory(old)), 19)
            inventory = A.migration_inventory(new)
            self.assertEqual(len(inventory), 20)
            database = parent / 'synthetic.db'
            with sqlite3.connect(database) as db:
                db.execute('CREATE TABLE _prisma_migrations (migration_name TEXT, checksum TEXT, started_at INTEGER, finished_at TEXT, rolled_back_at TEXT)')
                for index, (migration, checksum) in enumerate(A.migration_inventory(old).items()):
                    db.executescript((old / 'prisma/migrations' / migration / 'migration.sql').read_text())
                    db.execute("INSERT INTO _prisma_migrations VALUES (?,?,?,'complete',NULL)", (migration, checksum, index))
                db.execute("INSERT INTO ContentPost (id,slug,title,summary,content,updatedAt) VALUES ('preserved','preserved','Existing report','Preserve','{}','2026-10-20')")
            A.migration_ready(new, old, database)
            with sqlite3.connect(database) as db:
                before = db.execute('SELECT * FROM ContentPost').fetchall()
                sql = (new / 'prisma/migrations' / name / 'migration.sql').read_bytes()
                self.assertEqual(hashlib.sha256(sql).hexdigest(), inventory[name])
                db.executescript(sql.decode())
                db.execute("INSERT INTO _prisma_migrations VALUES (?,?,19,'complete',NULL)", (name, inventory[name]))
                self.assertEqual(db.execute('SELECT * FROM ContentPost').fetchall(), before)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM ResourceDocument').fetchone()[0], 0)
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
            A.migration_ready(new, old, database, complete=True)
            with self.assertRaises(ValueError):
                A.migration_ready(old, old, database, complete=True)
            for path in (new / 'prisma/schema.prisma', new / 'prisma/migrations' / name / 'migration.sql'):
                original = path.read_bytes()
                path.write_bytes(original + b'\n-- unreviewed\n')
                with self.assertRaises(ValueError):
                    A.migration_inventory(new)
                path.write_bytes(original)
            with sqlite3.connect(database) as db:
                db.execute('ALTER TABLE ResourceDocument ADD COLUMN unreviewed TEXT')
            with self.assertRaises(ValueError):
                A.migration_ready(new, old, database, complete=True)


if __name__ == '__main__':
    unittest.main()
