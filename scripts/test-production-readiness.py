"""Exact forward policy and real Bash recovery decisions on disposable fictional DBs."""
import contextlib,hashlib,importlib.util,json,os,shutil,sqlite3,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('policy',ROOT/'ops/deploy/prebuilt-artifact.py');A=importlib.util.module_from_spec(spec);spec.loader.exec_module(A)
class Readiness(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='nuaafa-readiness-fictional-');self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve();self.old=self.root/('a'*40);self.new=self.root/('b'*40)
  # Keep the historical 17-to-18 recovery fixture exact; the 18-to-19 policy has its own test.
  for directory,count in [(self.old,17),(self.new,18)]:
   for p in sorted((ROOT/'prisma/migrations').glob('*/migration.sql'))[:count]:
    dest=directory/'prisma/migrations'/p.parent.name/p.name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest)
   shutil.copyfile(ROOT/'prisma/migrations/migration_lock.toml',directory/'prisma/migrations/migration_lock.toml')
   (directory/'prisma/schema.prisma').write_bytes(subprocess.check_output(['git','-C',str(ROOT),'show',A.BASELINE_COMMIT+':prisma/schema.prisma']) if count==17 else subprocess.check_output(['git','-C',str(ROOT),'show','5c86ad7c042efcac0256f20caa8644999ae37f34:prisma/schema.prisma']))
  self.database=self.root/'fictional.db'
  with sqlite3.connect(self.database) as db:
   db.execute('CREATE TABLE _prisma_migrations (migration_name TEXT,checksum TEXT,started_at INTEGER,finished_at TEXT,rolled_back_at TEXT)')
   for i,(name,sha) in enumerate(A.BASELINE_MIGRATIONS.items()):
    db.executescript((self.old/'prisma/migrations'/name/'migration.sql').read_text());db.execute("INSERT INTO _prisma_migrations VALUES (?,?,?,'done',NULL)",(name,sha,i))
   db.commit()
 def upgrade(self):
  with sqlite3.connect(self.database) as db:
   for name,sha in A.FORWARD_MIGRATION.items():
    db.executescript((self.new/'prisma/migrations'/name/'migration.sql').read_text());db.execute("INSERT INTO _prisma_migrations VALUES (?,?,17,'done',NULL)",(name,sha))
   db.commit()
 def test_exact17_forward18_and_repeat(self):
  self.assertEqual(len(A.migration_inventory(self.old)),17);self.assertEqual(len(A.migration_inventory(self.new)),18)
  A.migration_ready(self.new,self.old,self.database);self.upgrade();before=A.database_fingerprint(self.database)
  A.migration_ready(self.new,self.old,self.database,True);A.migration_ready(self.new,self.new,self.database,True)
  self.assertEqual(A.database_fingerprint(self.database),before)
  with self.assertRaises(ValueError):A.migration_ready(self.old,self.new,self.database)
 def test_old_sql_new_sql_schema_unknown_or_missing_rejected(self):
  for rel in ['prisma/migrations/'+next(iter(A.BASELINE_MIGRATIONS))+'/migration.sql','prisma/migrations/'+next(iter(A.FORWARD_MIGRATION))+'/migration.sql','prisma/schema.prisma']:
   path=self.new/rel;original=path.read_bytes();path.write_bytes(original+b'\n-- altered\n')
   with self.assertRaises(ValueError):A.migration_inventory(self.new)
   path.write_bytes(original)
  p=self.new/'prisma/migrations/20261021120000_unknown/migration.sql';p.parent.mkdir();p.write_text('SELECT 1;')
  with self.assertRaises(ValueError):A.migration_inventory(self.new)
  p.unlink();p.parent.rmdir();p=self.new/'prisma/migrations'/next(iter(A.FORWARD_MIGRATION))/'migration.sql';p.unlink()
  with self.assertRaises(ValueError):A.migration_inventory(self.new)
 def test_incomplete_failed_rolled_altered_reordered_unknown_history(self):
  original=self.database.read_bytes()
  for sql in ["DELETE FROM _prisma_migrations WHERE started_at=0","UPDATE _prisma_migrations SET finished_at=NULL WHERE started_at=0","UPDATE _prisma_migrations SET rolled_back_at='bad' WHERE started_at=0","UPDATE _prisma_migrations SET checksum='bad' WHERE started_at=0","UPDATE _prisma_migrations SET started_at=100 WHERE started_at=0","UPDATE _prisma_migrations SET migration_name='unknown' WHERE started_at=0"]:
   self.database.write_bytes(original)
   with sqlite3.connect(self.database) as db:db.execute(sql)
   with self.assertRaises(ValueError):A.migration_ready(self.new,self.old,self.database)
 def test_partial_and_unknown_structure_rejected(self):
  with sqlite3.connect(self.database) as db:db.execute('ALTER TABLE Referee ADD COLUMN unreviewed TEXT')
  with self.assertRaises(ValueError):A.migration_ready(self.new,self.old,self.database)
 def journal(self,phase,digest=None):
  path=self.root/'activation.json'
  with patch.object(A,'trusted_directory'),patch.object(A,'trusted_file'):
   A.write_state(path,self.new.name,self.old.name,phase,digest or A.database_fingerprint(self.database))
  return path
 def test_actual_database_changes_or_private_new_schema_block_old(self):
  path=self.journal('SERVICE_STOPPED')
  with patch.object(A,'trusted_file'):A.recovery_ready(path,self.old,self.database,self.new.name,'SERVICE_STOPPED')
  self.upgrade()
  with sqlite3.connect(self.database) as db:
   def insert(table,**values):
    for _,name,typ,required,default,pk in db.execute('PRAGMA table_info("'+table+'")'):
     if name not in values and required and default is None:values[name]=0 if 'INT' in typ or 'BOOL' in typ else '2026-10-01T00:00:00Z' if 'DATE' in typ else 'synthetic-'+name
    db.execute('INSERT INTO "'+table+'" ('+','.join('"'+k+'"' for k in values)+') VALUES ('+','.join('?' for _ in values)+')',list(values.values()))
   insert('Competition',id='comp',slug='fixture',name='Synthetic',campus='Synthetic',format='FUTSAL',status='COMPLETED')
   for i in range(2):insert('Team',id='team'+str(i),competitionId='comp',name='Synthetic'+str(i))
   insert('Match',id='match',slug='fixture',competitionId='comp',homeTeamId='team0',awayTeamId='team1',venue='Synthetic',kickoff='2026-10-01T07:00:00Z',status='COMPLETED',homeScore=2,awayScore=1,resultVersion=1,resultConfirmedAt='2026-10-01T08:00:00Z')
   insert('RefereeAppointment',id='private',matchId='match',status='COMPLETED',recordSource='POST_MATCH_ENTRY',publicHistoryVisible=False)
   self.assertEqual(db.execute("SELECT recordSource,publicHistoryVisible FROM RefereeAppointment WHERE id='private'").fetchone(),('POST_MATCH_ENTRY',0))
  # Default private schema/facts MUST NOT be interpreted by the old application.
  with self.assertRaises(ValueError):A.migration_ready(self.old,self.old,self.database,True)
  with patch.object(A,'trusted_file'),self.assertRaises(ValueError):A.recovery_ready(path,self.old,self.database,self.new.name,'SERVICE_STOPPED')
 def test_runtime_journal_missing_uncertain_mismatched_and_old_version(self):
  for phase in ['MIGRATING','MIGRATED','SWITCHING','MANUAL_REQUIRED']:
   path=self.journal(phase)
   with patch.object(A,'trusted_file'),self.assertRaises(ValueError):A.runtime_ready(self.old,self.database,path)
  path=self.journal('HEALTHY')
  with patch.object(A,'trusted_file'),self.assertRaises(ValueError):A.runtime_ready(self.old,self.database,path)
  path=self.journal('SERVICE_STOPPED')
  with patch.object(A,'trusted_file'):A.runtime_ready(self.old,self.database,path)
  path.unlink()
  with self.assertRaises((ValueError,FileNotFoundError)):A.runtime_ready(self.old,self.database,path)

 def test_real_prisma_through_deployer_and_preserved_logs(self):
  if subprocess.check_output(['node','--version'],text=True).strip()!='v22.23.4':self.skipTest('requires exact Node22.23.4')
  with sqlite3.connect(self.database) as db:
   rows=db.execute('SELECT migration_name,checksum,started_at,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY started_at').fetchall()
   db.execute('DROP TABLE _prisma_migrations');db.execute('CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY,checksum TEXT NOT NULL,finished_at DATETIME,migration_name TEXT NOT NULL,logs TEXT,rolled_back_at DATETIME,started_at DATETIME NOT NULL,applied_steps_count INTEGER NOT NULL DEFAULT 0)')
   for i,(name,digest,started,finished,rolled) in enumerate(rows):db.execute("INSERT INTO _prisma_migrations (id,checksum,started_at,finished_at,migration_name,applied_steps_count) VALUES (?,?,?,? ,?,1)",(str(i),digest,1700000000000+i,1700000000001+i,name))
   db.commit()
  shared=self.root/'real-prisma/shared';(shared/'prisma').mkdir(parents=True);database=shared/'prisma/dev.db';shutil.copyfile(self.database,database)
  A.migration_ready(ROOT,self.old,database)
  script='set -Eeuo pipefail\nsource "$DEPLOYER"\nshared="$SHARED"; activation_state="$STATE"; target_commit="$COMMIT"; student_id_preflight_node="$NODE"; prebuilt_python="$PYTHON"\nverify_root_metadata() { :; }; run_as_deploy_user() { "$@"; }\nrun_migration "$RELEASE"\n'
  env={**os.environ,'DEPLOYER':str(ROOT/'ops/deploy/nuaafa-deploy'),'SHARED':str(shared),'STATE':str(self.root/'real-prisma/activation.json'),'COMMIT':self.new.name,'NODE':shutil.which('node'),'PYTHON':os.sys.executable,'RELEASE':str(ROOT)}
  for _ in range(2):
   r=subprocess.run(['/bin/bash','-c',script],env=env,capture_output=True,text=True,timeout=60);self.assertEqual(r.returncode,0,r.stdout+r.stderr);A.migration_ready(ROOT,self.old,database,True)
  logs=list((self.root/'real-prisma').glob('activation.json.migration.*.log.*'));self.assertEqual(len(logs),2);self.assertTrue(all(p.stat().st_size>0 for p in logs))
  with sqlite3.connect(database) as db:self.assertEqual(db.execute('select count(*) from _prisma_migrations').fetchone()[0],22)

 def test_installed_old_startup_contract_blocks_before_service_mutation(self):
  wrapper=self.root/'old-wrapper';wrapper.write_text("print('OLD-CONTRACT')");wrapper.chmod(0o755)
  script='source "$DEPLOYER"; prebuilt_start="$WRAPPER"; prebuilt_python="$PYTHON"; verify_root_metadata() { :; };run_as_deploy_user() { "$@"; }; systemctl() { echo FORBIDDEN_SERVICE_ACCESS; return 99; }; verify_service_contract'
  r=subprocess.run(['/bin/bash','-c',script],env={**os.environ,'DEPLOYER':str(ROOT/'ops/deploy/nuaafa-deploy'),'WRAPPER':str(wrapper),'PYTHON':os.sys.executable},capture_output=True,text=True)
  self.assertNotEqual(r.returncode,0);self.assertNotIn('FORBIDDEN_SERVICE_ACCESS',r.stdout);self.assertIn('startup contract must be installed',r.stderr)

 def test_real_bash_failure_matrix(self):
  # Real deployer/recovery helper, simulate only service/link operations. No systemd claims.
  original=self.database.read_bytes()
  for name,phase,disk,alter,accepted in [
   ('pre-failure','PREPARED','PREPARED',False,True),('stop-failure','SERVICE_STOPPING','SERVICE_STOPPING',False,True),
   ('pre-stopped','SERVICE_STOPPED','SERVICE_STOPPED',False,True),('migration-failure','MIGRATING','MIGRATING',False,False),
   ('new-start-failure','MIGRATED','MIGRATED',False,False),('switch-failure','SWITCHING','SWITCHING',False,False),
   ('health-failure','SWITCHED','SWITCHED',False,False),('interrupted','MIGRATING','MIGRATING',False,False),
   ('state-mismatch','SERVICE_STOPPED','MIGRATING',False,False),('unknown-db-write','SERVICE_STOPPED','SERVICE_STOPPED',True,False),
   ('unknown-phase','UNKNOWN','MANUAL_REQUIRED',False,False)]:
   with self.subTest(name=name):
    self.database.write_bytes(original);path=self.journal(disk)
    if alter:
     with sqlite3.connect(self.database) as db:db.execute("UPDATE _prisma_migrations SET finished_at='different' WHERE started_at=0")
    events=self.root/'events'
    if events.exists():events.unlink()
    script='''set -Eeuo pipefail
source "$DEPLOYER"
activation_phase="$PHASE"; activation_state="$STATE"; activation_previous="$PREVIOUS"; target_commit="$COMMIT"
shared="$SHARED"; activation_database_digest="$("$PYTHON" "$HELPER" database-fingerprint --database "$DATABASE")"
run_prebuilt_helper() {
 "$PYTHON" - "$HELPER" "$@" <<'INNER'
import importlib.util,sys
s=importlib.util.spec_from_file_location('helper',sys.argv[1]);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
a.trusted_file=lambda p:None;a.trusted_directory=lambda p:None;sys.argv=sys.argv[1:];a.main()
INNER
}
validate_recovery_release() { :; }; verify_recovery_startup() { :; }; run_student_id_preflight() { :; }
atomic_switch_current() { echo switch-old >>"$EVENTS"; }
restart_service() { echo restart-old >>"$EVENTS"; }; wait_for_health() { echo health-old >>"$EVENTS"; }
stop_service() { echo stop >>"$EVENTS"; }
recover_activation
'''
    # Use the actual database path expected by the deployer, linked solely inside fixture.
    shared=self.root/'shared';(shared/'prisma').mkdir(parents=True,exist_ok=True);link=shared/'prisma/dev.db'
    if not link.exists():shutil.copyfile(self.database,link)
    else:shutil.copyfile(self.database,link)
    env={**os.environ,'DEPLOYER':str(ROOT/'ops/deploy/nuaafa-deploy'),'PHASE':phase,'STATE':str(path),'PREVIOUS':str(self.old),'COMMIT':self.new.name,'PYTHON':os.sys.executable,'HELPER':str(ROOT/'ops/deploy/prebuilt-artifact.py'),'SHARED':str(shared),'DATABASE':str(self.database),'EVENTS':str(events)}
    r=subprocess.run(['/bin/bash','-c',script],env=env,capture_output=True,text=True,timeout=20)
    self.assertEqual(r.returncode==0,accepted,r.stdout+r.stderr)
    lines=events.read_text().splitlines();self.assertEqual('restart-old' in lines,accepted)
    if not accepted:self.assertEqual(lines,['stop']);self.assertEqual(json.loads(path.read_text())['phase'],'MANUAL_REQUIRED')
    # Repeated recovery reads durable MANUAL_REQUIRED and cannot start old code.
    if not accepted:
     r=subprocess.run(['/bin/bash','-c',script],env=env,capture_output=True,text=True,timeout=20);self.assertNotEqual(r.returncode,0);self.assertNotIn('restart-old',events.read_text())
if __name__=='__main__':unittest.main(verbosity=2)
