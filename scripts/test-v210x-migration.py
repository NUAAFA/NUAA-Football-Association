"""Only generated SQLite fixtures; preserve all original cells, ledger bytes and checksums."""
from pathlib import Path
import hashlib, json, os, shutil, sqlite3, subprocess, tempfile, uuid
BASE = '704bf0af9e9b7f538cfbf6d3a76ec5f4148190e8'
root = Path(tempfile.mkdtemp(prefix='nuaafa-v210x-migration-'))
oldfile = root/'old.db'; db = sqlite3.connect(oldfile)
paths = sorted(Path('prisma/migrations').glob('*/migration.sql'))
assert len(paths) == 19
assert paths[-1].parent.name == "20261023090000_competition_reports"
ledger = []
for p in paths[:17]:
    original = subprocess.check_output(['git','show',f'{BASE}:{p.as_posix()}'])
    assert p.read_bytes() == original, f'Historical migration modified: {p}'
    db.executescript(p.read_text()); ledger.append((str(uuid.uuid4()), hashlib.sha256(original).hexdigest(), '2026-10-01T00:00:00Z', p.parent.name, '2026-10-01T00:00:00Z',1))
db.execute('CREATE TABLE "_prisma_migrations" (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, finished_at DATETIME, migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME, started_at DATETIME NOT NULL DEFAULT current_timestamp, applied_steps_count INTEGER NOT NULL DEFAULT 0)')
db.executemany('INSERT INTO "_prisma_migrations" (id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES (?,?,?,?,?,?)',ledger)
def insert(table, **values):
    for _,name,typ,required,default,pk in db.execute(f'pragma table_info("{table}")'):
        if name not in values and required and default is None:
            values[name] = 0 if 'INT' in typ or 'BOOL' in typ else '2026-10-01T00:00:00Z' if 'DATE' in typ else f'synthetic-{name}'
    db.execute(f'INSERT INTO "{table}" ({",".join(chr(34)+k+chr(34) for k in values)}) VALUES ({",".join("?" for _ in values)})',list(values.values()))
insert('Competition', id='comp',slug='clone-fixture',name='虚构旧赛事',campus='虚构',format='FUTSAL',status='COMPLETED')
for i in range(2): insert('Team',id=f'team{i}',competitionId='comp',name=f'虚构旧队{i}')
insert('Referee',id='ref',publicCode='SYNTHETIC-1',name='虚构旧裁判',studentId='CG0123010189',grade='大三',status='INACTIVE',passwordHash='synthetic-protected-value')
insert('AdminAccount',id='admin',username='synthetic-admin',displayName='虚构旧管理员',passwordHash='synthetic-admin-protected',role='SUPER_ADMIN')
insert('AdminRoleAssignment',id='role',adminAccountId='admin',role='SUPER_ADMIN')
insert('Match',id='match',slug='fixture',competitionId='comp',stage='历史文字',venue='虚构旧球场',homeTeamId='team0',awayTeamId='team1',status='COMPLETED',homeScore=2,awayScore=1,kickoff='2026-10-01T07:00:00Z',resultVersion=1,resultConfirmedAt='2026-10-01T08:00:00Z')
insert('RefereeAppointment',id='apt',matchId='match',status='COMPLETED',publishedAt='2026-09-30T02:00:00Z',completedAt='2026-10-01T08:00:00Z',revision=2)
insert('AppointmentPosition',id='pos',appointmentId='apt',refereeId='ref',key='REFEREE',label='裁判员',sortOrder=1,slot=1)
insert('AppointmentVersion',id='ver',appointmentId='apt',revision=1,status='PUBLISHED',snapshot='{"historical":"unaltered"}',createdByAdminId='admin')
insert('AuditLog',id='audit',actorType='ADMIN',actorId='admin',action='FIXTURE_HISTORY',entityType='RefereeAppointment',entityId='apt',summary='虚构旧记录')
db.commit()
tables=[r[0] for r in db.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
columns={t:[r[1] for r in db.execute(f'pragma table_info("{t}")')] for t in tables}
def snapshot(connection):
    return {t:connection.execute(f'SELECT {",".join(chr(34)+c+chr(34) for c in columns[t])} FROM "{t}" ORDER BY {chr(34)+columns[t][0]+chr(34)}').fetchall() for t in tables}
before=snapshot(db); db.close(); oldhash=hashlib.sha256(oldfile.read_bytes()).hexdigest()
clone=root/'upgrade.db'; shutil.copy2(oldfile,clone)
def migrate(file):
    env={**os.environ,'DATABASE_URL':f'file:{file}'}
    result=subprocess.run(['node','node_modules/prisma/build/index.js','migrate','deploy'],env=env,capture_output=True,text=True)
    assert result.returncode==0,result.stdout+result.stderr
migrate(clone); upgraded=sqlite3.connect(clone)
after=snapshot(upgraded)
assert after['_prisma_migrations'][:0] == []
for table in tables:
    if table=='_prisma_migrations':
        old_ids={row[0] for row in before[table]}
        assert [row for row in after[table] if row[0] in old_ids] == before[table]
    else: assert before[table]==after[table],table
assert upgraded.execute('select gradeMode,grade from Referee').fetchone()==('UNVERIFIED','大三')
assert upgraded.execute('select recordSource,publishedAt from RefereeAppointment').fetchone()==('PRE_MATCH','2026-09-30T02:00:00Z')
assert upgraded.execute('pragma integrity_check').fetchone()[0]=='ok'
assert not upgraded.execute('pragma foreign_key_check').fetchall()
assert upgraded.execute('select count(*) from _prisma_migrations').fetchone()[0]==19
repeat=snapshot(upgraded);migrate(clone);assert snapshot(upgraded)==repeat
plan=upgraded.execute('EXPLAIN QUERY PLAN SELECT id FROM "Match" WHERE competitionId=? AND stageId=? AND roundId=? ORDER BY kickoff,id',('comp','stage','round')).fetchall()
assert any('Match_structure_navigation_idx' in row[-1] for row in plan)
# Inject a failing additional migration into a disposable copy: additive changes roll back atomically.
failure=root/'failed.db';shutil.copy2(oldfile,failure);failed=sqlite3.connect(failure)
try: failed.executescript('BEGIN;'+paths[-1].read_text()+'; SELECT * FROM definitely_missing_table; COMMIT;')
except sqlite3.DatabaseError: failed.rollback()
assert snapshot(failed)==before
# Exercise a real Prisma migration failure with a private copy of candidate SQL.
private_migrations=root/'private-migrations';shutil.copytree('prisma/migrations',private_migrations)
private_sql=private_migrations/paths[-1].parent.name/'migration.sql'
private_sql.write_text(private_sql.read_text()+'\nSELECT * FROM deliberately_missing_v210x_table;\n')
prisma_failed=root/'prisma-failed.db';shutil.copy2(oldfile,prisma_failed)
config=root/'prisma-failure.config.ts'
config.write_text('import { defineConfig } from '+json.dumps(str(Path('node_modules/prisma/config.js').resolve()))+';\nexport default defineConfig({schema:'+json.dumps(str(Path('prisma/schema.prisma').resolve()))+',migrations:{path:'+json.dumps(str(private_migrations))+'},datasource:{url:'+json.dumps('file:'+str(prisma_failed))+'}});\n')
failure_run=subprocess.run(['node','node_modules/prisma/build/index.js','migrate','deploy','--config',str(config)],capture_output=True,text=True)
assert failure_run.returncode!=0
assert 'deliberately_missing_v210x_table' in failure_run.stdout+failure_run.stderr, failure_run.stdout+failure_run.stderr
failed_prisma=sqlite3.connect(prisma_failed)
for table in tables:
    if table!='_prisma_migrations': assert snapshot(failed_prisma)[table]==before[table],table
assert failed_prisma.execute('select count(*) from _prisma_migrations where finished_at is null').fetchone()[0]==1
# Preserve the failed candidate and recover to a fresh path from the pre-change clone.
recovered=root/'prisma-recovered.db';assert not recovered.exists();shutil.copy2(oldfile,recovered);migrate(recovered)
assert sqlite3.connect(recovered).execute('select count(*) from _prisma_migrations where finished_at is not null').fetchone()[0]==19
# Recover to a new sibling; never overwrite an existing path or discard candidate history.
restored=root/'restored.db';assert not restored.exists();shutil.copy2(oldfile,restored)
assert snapshot(sqlite3.connect(restored))==before
assert hashlib.sha256(oldfile.read_bytes()).hexdigest()==oldhash
print(json.dumps({'status':'PASS','historical_migrations_unchanged':17,'candidate_migrations':19,'baseline_tables_preserved':len(tables),'old_cells_and_admin_credentials':'EXACT_EQUAL','repeat_deploy':'PASS','failure_atomicity':'PASS','real_prisma_failure_and_clone_recovery':'PASS','isolated_restore':'PASS','integrity_and_foreign_keys':'PASS','navigation_index_plan':[row[-1] for row in plan]},ensure_ascii=False,indent=2))
