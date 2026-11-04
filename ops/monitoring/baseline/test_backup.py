import fcntl, importlib.util, json, os, sqlite3, tempfile, unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('ops_backup',Path(__file__).with_name('backup.py'));b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='NUAAFA-FICTITIOUS-OPS-');self.base=Path(self.tmp.name).resolve();self.source=self.base/'source';self.root=self.base/'backups'
        for p in [self.source,self.source/'prisma',self.source/'uploads',self.root]:p.mkdir(mode=0o700)
        self.db=self.source/'prisma/dev.db';c=sqlite3.connect(self.db)
        c.executescript('CREATE TABLE AdminAccount(id TEXT PRIMARY KEY,passwordHash TEXT);CREATE TABLE AdminSession(id TEXT PRIMARY KEY,adminId TEXT REFERENCES AdminAccount(id));CREATE TABLE AuditLog(id TEXT);CREATE TABLE _prisma_migrations(id TEXT);CREATE TABLE MediaAsset(storageKey TEXT,size INTEGER);INSERT INTO AdminAccount VALUES("FICTITIOUS","SYNTHETIC_ONLY");INSERT INTO AdminSession VALUES("FICTITIOUS_SESSION","FICTITIOUS");INSERT INTO AuditLog VALUES("FICTITIOUS_AUDIT");INSERT INTO _prisma_migrations VALUES("FICTITIOUS_MIGRATION");INSERT INTO MediaAsset VALUES("example.bin",4);');c.commit();c.close();(self.source/'uploads/example.bin').write_bytes(b'TEST')
    def tearDown(self):self.tmp.cleanup()
    def accepted(self):
        result=b.backup(self.source,self.root);self.assertEqual(result['status'],'PASS');return Path(result['path'])
    def test_actual_restore_preserves_all_tables_and_payload(self):
        db=self.db.read_bytes();p=self.accepted();self.assertEqual(self.db.read_bytes(),db)
        m=b.verify(p);self.assertEqual(len(m['database_logical']['tables']),5)
        target=self.base/'restore';self.assertEqual(b.restore(p,target)['status'],'PASS');self.assertEqual((target/'uploads/example.bin').read_bytes(),b'TEST')
        with self.assertRaises(b.Stop):b.restore(p,target)
    def test_concurrent_lock_blocks_new_output(self):
        with (self.root/'.backup.lock').open('w') as f:
            fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);result=b.backup(self.source,self.root)
        self.assertEqual(result['code'],'BACKUP_LOCKED');self.assertFalse(list(self.root.glob('online-*')))
    def test_approved_maintenance_skips_without_reading_live_source(self):
        original=b.maintenance_active;b.maintenance_active=lambda:True
        try:
            result=b.backup(self.base/'NONEXISTENT_FICTITIOUS_SOURCE',self.root)
            self.assertEqual(result['status'],'SKIPPED');self.assertFalse(list(self.root.glob('online-*')))
        finally:b.maintenance_active=original
    def test_media_change_fails_without_success_marker(self):
        result=b.backup(self.source,self.root,lambda src:(src/'uploads/example.bin').write_bytes(b'FAIL'))
        self.assertEqual(result['status'],'FAIL');self.assertFalse(list(self.root.glob('online-*/COMPLETED.json')))
        self.assertIn('BACKUP_FAILURE',(self.root/'events.jsonl').read_text())
    def test_database_change_fails(self):
        def change(src):
            c=sqlite3.connect(src/'prisma/dev.db');c.execute('INSERT INTO AuditLog VALUES("FICTITIOUS_CHANGE")');c.commit();c.close()
        self.assertEqual(b.backup(self.source,self.root,change)['status'],'FAIL')
    def test_tampered_archive_rejected(self):
        p=self.accepted();(p/'uploads/example.bin').write_bytes(b'EVIL')
        with self.assertRaises(b.Stop):b.verify(p)
    def test_symlink_rejected(self):
        (self.source/'uploads/link').symlink_to(self.db);self.assertEqual(b.backup(self.source,self.root)['status'],'FAIL')
    def test_missing_media_reference_rejected(self):
        (self.source/'uploads/example.bin').unlink();self.assertEqual(b.backup(self.source,self.root)['code'],'MEDIA_REFERENCE_MISSING')
    def test_failure_does_not_replace_last_success(self):
        self.accepted();old=(self.root/'last-success.json').read_bytes();(self.source/'uploads/example.bin').unlink();b.backup(self.source,self.root)
        self.assertEqual(old,(self.root/'last-success.json').read_bytes());self.assertEqual(json.loads((self.root/'last-attempt.json').read_text())['status'],'FAIL')
if __name__=='__main__':unittest.main(verbosity=2)
