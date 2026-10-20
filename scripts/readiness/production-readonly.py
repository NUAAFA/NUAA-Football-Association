"""Run via pinned SSH stdin only. Aggregate read-only inspection; no output of private cells/config."""
import datetime,hashlib,json,os,pathlib,sqlite3,subprocess
P=pathlib.Path
def run(args):
 r=subprocess.run(args,capture_output=True,text=True,timeout=15)
 return {'rc':r.returncode,'stdout':r.stdout.strip(),'stderr':r.stderr.strip()}
def props(unit):
 r=run(['systemctl','show',unit,'--property=ActiveState,SubState,MainPID,Result,UnitFileState,NeedDaemonReload,LastTriggerUSec,NextElapseUSecRealtime,NRestarts'])
 return dict(line.split('=',1) for line in r['stdout'].splitlines())
out={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'hostname':run(['hostname'])['stdout'],'uid':os.getuid()}
assert out['hostname']=='nuaafa-production-new' and out['uid']==0
current=P('/srv/nuaafa/current').resolve(strict=True);out['current_commit']=current.name
out['git_commit']=run(['git','-c','safe.directory='+str(current),'-C',str(current),'rev-parse','HEAD'])['stdout']
out['node']=run(['/usr/bin/node','--version'])['stdout']
out['os_release']={k:v.strip('"') for k,v in (line.split('=',1) for line in P('/etc/os-release').read_text().splitlines() if '=' in line) if k in ('ID','VERSION_ID')}
out['next']=json.loads((current/'node_modules/next/package.json').read_text())['version']
units=['nuaafa.service','nginx.service']+[f'nuaafa-ops-{n}.{kind}' for n in ['backup','monitor','restore','nginx-log'] for kind in ['timer','service']]
out['units']={u:props(u) for u in units};out['jobs']=run(['systemctl','list-jobs','--no-legend','--no-pager'])['stdout'];out['failed_units']=run(['systemctl','--failed','--no-legend','--no-pager'])['stdout']
out['capacity']=run(['df','-P','/srv/nuaafa'])['stdout'];out['inodes']=run(['df','-Pi','/srv/nuaafa'])['stdout']
dbpath=P('/srv/nuaafa/shared/prisma/dev.db');before=dbpath.stat()
db=sqlite3.connect(dbpath.as_uri()+'?mode=ro',uri=True,timeout=0);db.execute('pragma query_only=ON')
deny={sqlite3.SQLITE_INSERT,sqlite3.SQLITE_UPDATE,sqlite3.SQLITE_DELETE,sqlite3.SQLITE_CREATE_TABLE,sqlite3.SQLITE_DROP_TABLE,sqlite3.SQLITE_ALTER_TABLE,sqlite3.SQLITE_ATTACH,sqlite3.SQLITE_DETACH}
db.set_authorizer(lambda action,*_:sqlite3.SQLITE_DENY if action in deny else sqlite3.SQLITE_OK)
db.execute('BEGIN');out['integrity']=db.execute('pragma integrity_check').fetchall();out['foreign_key_violations']=len(db.execute('pragma foreign_key_check').fetchall())
out['migrations']=[dict(zip(['name','checksum','finished','rolled_back'],r)) for r in db.execute('select migration_name,checksum,finished_at,rolled_back_at from _prisma_migrations order by started_at,rowid')]
tables=[r[0] for r in db.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
out['table_counts']={t:db.execute('SELECT count(*) FROM "'+t.replace('"','""')+'"').fetchone()[0] for t in tables}
out['admin_roles']=[list(r) for r in db.execute('select role,count(*) from AdminAccount group by role')];out['assigned_roles']=[list(r) for r in db.execute('select role,count(*) from AdminRoleAssignment group by role')]
out['total_changes']=db.total_changes;db.close();out['database_identity_unchanged']=(before.st_dev,before.st_ino)==(dbpath.stat().st_dev,dbpath.stat().st_ino)
uploads=P('/srv/nuaafa/shared/uploads');media=[p for p in uploads.rglob('*') if p.is_file()];out['media']={'files':len(media),'bytes':sum(p.stat().st_size for p in media),'symlinks':sum(p.is_symlink() for p in uploads.rglob('*'))}
out['operations']={}
for name,path in [('monitor','/var/lib/nuaafa-ops-monitor/latest.json'),('backup','/var/lib/nuaafa-ops-backup/last-success.json'),('restore','/var/lib/nuaafa-ops-restore/last-success.json')]:
 p=P(path)
 if p.exists():
  v=json.loads(p.read_text());out['operations'][name]={k:v[k] for k in ['utc','status','backup_id','started_utc','finished_utc','completed_utc','manifest_sha256'] if k in v}
  if name=='monitor':out['operations'][name]['failed_checks']=[k for k,v in v.get('checks',{}).items() if not v.get('ok')]
 else:out['operations'][name]={'status':'UNKNOWN'}
backups=P('/srv/nuaafa/shared/backups/unified');out['backup_manifest_identities']=[]
for m in sorted(backups.glob('*/manifest.json')):
 out['backup_manifest_identities'].append({'id':m.parent.name,'manifest_sha256':hashlib.sha256(m.read_bytes()).hexdigest(),'mtime':m.stat().st_mtime})
writers=[]
for proc in P('/proc').iterdir():
 if not proc.name.isdigit():continue
 try:
  for fd in (proc/'fd').iterdir():
   target=os.readlink(fd)
   if target.startswith('/srv/nuaafa/shared/prisma/dev.db'):
    flags=int(next(l.split()[1] for l in (proc/'fdinfo'/fd.name).read_text().splitlines() if l.startswith('flags:')),8)
    if flags & 3: writers.append({'pid':int(proc.name),'comm':(proc/'comm').read_text().strip(),'cwd':str((proc/'cwd').resolve())});break
 except (OSError,StopIteration):continue
out['database_writers']=writers
out['https']=run(['curl','--proto','=https','-4','-fsS','--max-time','10','https://nuaafa.cn/api/health'])
print(json.dumps(out,indent=2))
