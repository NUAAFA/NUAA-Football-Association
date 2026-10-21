"""VA-B02 only. Entire VM is fictional; no production tools/data/secrets loaded."""
import datetime,fcntl,hashlib,importlib.util,json,os,platform,pwd,shutil,signal,sqlite3,subprocess,sys,threading,time
from pathlib import Path
P=Path;INPUT=P(__file__).resolve().parent;OUT=P(sys.argv[1]).resolve();OUT.mkdir(mode=0o755,parents=True);BASE='159c36072341b31d1184afd076ed6667bd779c47';TARGET='7b2d90dcea69568fb95f482de9bc89eb84b85bfa';ROOT=P('/var/lib/nuaafa-ops-monitor');BACK=P('/var/lib/nuaafa-ops-backup');SCRIPTS=P('/usr/local/lib/nuaafa-post-launch');CURRENT=P('/srv/nuaafa/current');results=[];runs=[]
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(name,value):
 (OUT/name).write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')
def run(a,check=True,timeout=60):
 p=subprocess.run([str(x) for x in a],text=True,capture_output=True,timeout=timeout)
 if check:assert p.returncode==0,(a,p.returncode,p.stderr)
 return {'rc':p.returncode,'stdout':p.stdout,'stderr':p.stderr}
def record(test,**d):
 results.append({'test':test,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS',**d});save('results.json',results);print(test,'PASS',flush=True)
def props(unit):
 return dict(l.split('=',1) for l in run(['systemctl','show',unit,'--property=Id,ActiveState,SubState,Result,MainPID,ControlPID,CPUUsageNSec,MemoryPeak,MemoryCurrent,MemoryMax,TasksMax,CPUQuotaPerSecUSec,TimeoutStartUSec,ExecMainCode,ExecMainStatus,ExecMainStartTimestampMonotonic,ExecMainExitTimestampMonotonic,InactiveExitTimestampMonotonic,InactiveEnterTimestampMonotonic,FragmentPath,DropInPaths,NeedDaemonReload,ControlGroup'])['stdout'].splitlines())
def wait(fn,timeout=15):
 t=time.monotonic()
 while time.monotonic()-t<timeout:
  if fn():return
  time.sleep(.1)
 raise RuntimeError('WAIT_LIMIT')
def install(phase,kind='revised'):
 for name in ['backup','monitor']:
  src=INPUT/(('pin-only-' if kind=='pin-only' else '')+phase+'-'+name+'.py');dst=SCRIPTS/(name+'.py');shutil.copyfile(src,dst);dst.chmod(0o644)
def health():return run(['curl','-sf','--max-time','2','http://127.0.0.1:3001/api/health'],False,4)['rc']==0
def startapp(release):
 if CURRENT.exists() or CURRENT.is_symlink():CURRENT.unlink()
 CURRENT.symlink_to(release);run(['systemctl','start','nuaafa.service']);wait(health)
def stopapp():run(['systemctl','stop','nuaafa.service'],timeout=35)
def latest():return json.loads((ROOT/'latest.json').read_text())
def runmonitor(label,expected=True,require_success=True):
 before=props('nuaafa-ops-monitor.service');samples=[];finished=threading.Event()
 def observe():
  while not finished.is_set():
   d=props('nuaafa-ops-monitor.service');sample={'monotonic':time.monotonic(),'native':d};cg=d.get('ControlGroup','')
   if cg:
    for n in ['cpu.stat','memory.current','memory.peak']:
     q=P('/sys/fs/cgroup')/cg.lstrip('/')/n
     try:sample[n]=q.read_text()
     except FileNotFoundError:pass
   samples.append(sample);finished.wait(.25)
 t=threading.Thread(target=observe);t.start();start=time.monotonic()
 try:r=run(['systemctl','start','nuaafa-ops-monitor.service'],False,timeout=65)
 finally:elapsed=time.monotonic()-start;finished.set();t.join()
 after=props('nuaafa-ops-monitor.service');raw=run(['journalctl','-u','nuaafa-ops-monitor.service','-b','--no-pager'])['stdout'];(OUT/(label+'.journal.txt')).write_text(raw)
 entry={'label':label,'client':r,'wall_seconds':elapsed,'before':before,'after':after,'samples':samples,'script_sha256':digest(SCRIPTS/'monitor.py')}
 if (ROOT/'profile.jsonl').exists():
  shutil.copyfile(ROOT/'profile.jsonl',OUT/(label+'.profile.jsonl'));(ROOT/'profile.jsonl').rename(ROOT/(label+'.profile-preserved.jsonl'))
 if r['rc']==0:
  v=latest();assert len(v['checks'])==22 and v['checks']['VERSION']['ok']==expected
  assert v['checks']['PUBLIC_HTTPS_HOME']['ok'] is False and v['checks']['PUBLIC_HTTPS_HEALTH']['ok'] is False and v['checks']['HTTPS_CERTIFICATE']['ok'] is False
  assert v['status']=='DEGRADED';entry['latest']=v
 runs.append(entry);save('monitor-runs.json',runs)
 assert after['TimeoutStartUSec']=='45s' and after['CPUQuotaPerSecUSec']=='100ms' and after['MemoryMax']=='134217728' and after['TasksMax']=='16'
 assert not after['DropInPaths'] and after['NeedDaemonReload']=='no'
 if require_success:assert r['rc']==0 and after['Result']=='success' and elapsed<45,(label,entry)
 return entry

def backup(label,success):
 p=run(['systemctl','start','nuaafa-ops-backup.service'],False,timeout=95);v=json.loads((BACK/'last-attempt.json').read_text());save(label+'.json',{'client':p,'attempt':v,'native':props('nuaafa-ops-backup.service')})
 assert (v['status']=='PASS')==success
 if success:assert p['rc']==0
 else:run(['systemctl','reset-failed','nuaafa-ops-backup.service'])
 return v

assert os.getuid()==0 and os.environ.get('VA_B02_ISOLATED_RUNNER')=='github-hosted'
assert platform.machine()=='x86_64' and P('/proc/1/comm').read_text().strip()=='systemd'
release=dict(l.rstrip().split('=',1) for l in P('/etc/os-release').read_text().splitlines() if '=' in l);assert release['ID']=='ubuntu' and release['VERSION_ID'].strip('"')=='24.04'
assert not P('/srv/nuaafa').exists(), 'REFUSE_EXISTING_SERVICE_ROOT'
platform_record={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'uname':run(['uname','-a'])['stdout'],'os_release':release,'lscpu':run(['lscpu'])['stdout'],'virtualization':run(['systemd-detect-virt'],False)['stdout'],'pid1':P('/proc/1/comm').read_text(),'systemd':run(['systemctl','--version'])['stdout'],'python':sys.version,'uid998_aliases':[],'production_access':False}
assert 'QEMU TCG' not in platform_record['lscpu']
try:platform_record['uid998_aliases'].append(pwd.getpwuid(998).pw_name)
except KeyError:pass
run(['groupadd','nuaafa']);run(['useradd','-o','-u','998','-g','nuaafa','-M','-s','/usr/sbin/nologin','nuaafa']);APP=pwd.getpwnam('nuaafa');platform_record['nuaafa_uid']=APP.pw_uid;save('environment.json',platform_record)
for p in ['/srv/nuaafa/releases','/srv/nuaafa/shared/prisma','/srv/nuaafa/shared/uploads','/srv/nuaafa/prebuilt','/etc/nuaafa',str(SCRIPTS),'/usr/local/lib/nuaafa-validation',str(ROOT),str(BACK)]:P(p).mkdir(parents=True,exist_ok=True)
for p in [ROOT,BACK]:p.chmod(0o700);os.chown(p,998,APP.pw_gid)
for sha in [BASE,TARGET]:
 p=P('/srv/nuaafa/releases')/sha;p.mkdir();(p/'FICTIONAL-IDENTITY.json').write_text(json.dumps({'represented_commit':sha,'payload':'fictional loopback HTTP fixture; not a Sealed application deployment'}))
P('/srv/nuaafa/shared/.env.production').write_text('FICTITIOUS_ONLY=1\n');P('/srv/nuaafa/shared/.env.production').chmod(0o600)
c=sqlite3.connect('/srv/nuaafa/shared/prisma/dev.db');c.executescript('CREATE TABLE AdminAccount(id TEXT PRIMARY KEY,passwordHash TEXT); CREATE TABLE AdminSession(id TEXT PRIMARY KEY,adminId TEXT REFERENCES AdminAccount(id)); CREATE TABLE AuditLog(id TEXT); CREATE TABLE _prisma_migrations(id TEXT); CREATE TABLE MediaAsset(storageKey TEXT,size INTEGER); INSERT INTO AdminAccount VALUES("FICTITIOUS","SYNTHETIC_ONLY"); INSERT INTO AdminSession VALUES("FICTITIOUS_SESSION","FICTITIOUS"); INSERT INTO AuditLog VALUES("FICTITIOUS_AUDIT"); INSERT INTO _prisma_migrations VALUES("FICTITIOUS_LEDGER_ONLY_NO_MIGRATION_EXECUTED"); INSERT INTO MediaAsset VALUES("fixture.bin",4);');c.commit();c.close();db=P('/srv/nuaafa/shared/prisma/dev.db');os.chown(db,998,APP.pw_gid);db.chmod(0o640);(P('/srv/nuaafa/shared/uploads')/'fixture.bin').write_bytes(b'TEST');dbsha=digest(db)
# Unavailable public services return actual failures. No HTTPS stub or check is skipped.
hosts=P('/etc/hosts');(OUT/'hosts-before.txt').write_bytes(hosts.read_bytes());assert b'nuaafa.cn' not in hosts.read_bytes()
with hosts.open('a') as f:f.write('\n127.0.0.1 nuaafa.cn # ISOLATED UNAVAILABLE EXTERNAL SERVICE\n')
P('/etc/nginx/sites-available').mkdir(parents=True,exist_ok=True);P('/etc/nginx/sites-available/nuaafa-production.disabled.conf').write_text('# FICTITIOUS CONFIGURATION; real expected hash must fail\n')
shutil.copyfile(INPUT/'app_fixture.py','/usr/local/lib/nuaafa-validation/app_fixture.py')
for n in ['nuaafa.service','nuaafa-ops-backup.service','nuaafa-ops-monitor.service','nuaafa-ops-event@.service']:shutil.copyfile(INPUT/n,P('/etc/systemd/system')/n)
shutil.copyfile(INPUT/'failure-event.py',SCRIPTS/'failure-event.py')
d=P('/etc/systemd/system/nuaafa.service.d');d.mkdir();(d/'90-v210x-plan-a-stop-safety.conf').write_text('[Service]\nSendSIGKILL=no\nTimeoutStopSec=infinity\n');(d/'95-isolated-app-fixture.conf').write_text('[Service]\nExecStart=\nExecStart=/usr/bin/python3 -I -B /usr/local/lib/nuaafa-validation/app_fixture.py\n')
run(['systemctl','daemon-reload'])
unit=run(['systemctl','cat','nuaafa-ops-monitor.service'])['stdout'];(OUT/'loaded-monitor-unit.txt').write_text(unit);save('loaded-monitor-values.json',props('nuaafa-ops-monitor.service'));assert digest(P('/etc/systemd/system/nuaafa-ops-monitor.service'))==digest(INPUT/'nuaafa-ops-monitor.service')
# Historical errors/manifests are append-only evidence; never retroactively corrected.
history=BACK/'FICTITIOUS-OLD-WRONG-VERSION.json';history.write_text('{"deployed_commit":"704bf0af9e9b7f538cfbf6d3a76ec5f4148190e8","fictional":true}\n');historysha=digest(history)
events=ROOT/'events.jsonl';prefix=b'{"kind":"INCIDENT_OPEN","check":"VERSION","fictional":true,"historical_label":"704bf0af"}\n';events.write_bytes(prefix);os.chown(events,998,APP.pw_gid);events.chmod(0o600)
# Unchanged 9+12 regressions in each stage, using their own fictional sources.
for phase in ['baseline','target']:
 rg=OUT/('regression-'+phase);rg.mkdir()
 for name in ['backup','monitor']:
  shutil.copyfile(INPUT/(phase+'-'+name+'.py'),rg/(name+'.py'));shutil.copyfile(INPUT/('test_'+name+'.py'),rg/('test_'+name+'.py'));p=run(['/usr/bin/python3','-B',rg/('test_'+name+'.py')],False,timeout=60);(rg/(name+'.log')).write_text(p['stdout']+p['stderr']);assert p['rc']==0
record('original_9_plus_12_regressions_both_phases',executions=42)
s=importlib.util.spec_from_file_location('instrument',INPUT/'instrument.py');INSTR=importlib.util.module_from_spec(s);s.loader.exec_module(INSTR)
for phase,sha,other in [('baseline',BASE,TARGET),('target',TARGET,BASE)]:
 startapp(P('/srv/nuaafa/releases')/sha)
 for kind in ['pin-only','revised']:
  install(phase,kind);backup_ok=backup(phase+'-'+kind+'-backup',True);manifest=P(backup_ok['path'])/'manifest.json';assert json.loads(manifest.read_text())['deployed_commit']==sha
  original=runmonitor(phase+'-'+kind+'-exact');assert original['latest']['checks']['VERSION']['ok']
  source=(SCRIPTS/'monitor.py').read_text();(SCRIPTS/'monitor.py').write_text(INSTR.instrument(source));diagnostic=runmonitor(phase+'-'+kind+'-profile');(SCRIPTS/'monitor.py').write_text(source)
  record(phase+'_'+kind+'_full_unit_and_profile',manifest_commit=sha,original_wall=original['wall_seconds'],original_cpu=original['after']['CPUUsageNSec'],profile_wall=diagnostic['wall_seconds'])
 install(phase)
 # Opposite pin is refused, all 22 checks still run, failure and recovery thresholds hold.
 install('target' if phase=='baseline' else 'baseline');failed=backup(phase+'-wrong-pin-backup',False);assert failed['code']=='DEPLOYED_VERSION_MISMATCH'
 for i in range(3):runmonitor(phase+'-wrong-pin-'+str(i),False)
 assert any(json.loads(x).get('check')=='VERSION' and json.loads(x).get('kind')=='INCIDENT_OPEN' and not json.loads(x).get('fictional') for x in events.read_text().splitlines())
 install(phase)
 for i in range(2):runmonitor(phase+'-recovery-'+str(i),True)
 assert any(json.loads(x).get('check')=='VERSION' and json.loads(x).get('kind')=='INCIDENT_RECOVERY' for x in events.read_text().splitlines())
 record(phase+'_wrong_pin_failure_and_recovery_original_thresholds')
 # A link and pin can agree while the actual old process still has the other cwd.
 CURRENT.unlink();CURRENT.symlink_to(P('/srv/nuaafa/releases')/other);install('target' if phase=='baseline' else 'baseline');failed=backup(phase+'-wrong-cwd-backup',False);assert failed['code']=='DEPLOYED_CWD_MISMATCH';runmonitor(phase+'-wrong-cwd',False);CURRENT.unlink();CURRENT.symlink_to(P('/srv/nuaafa/releases')/sha);install(phase)
 record(phase+'_correct_link_pin_wrong_process_cwd_refused')
 stopapp();failed=backup(phase+'-inactive-backup',False);assert failed['code']=='DEPLOYED_SERVICE_NOT_STABLE';runmonitor(phase+'-inactive',False)
 assert digest(db)==dbsha and digest(history)==historysha and events.read_bytes().startswith(prefix)
 record(phase+'_inactive_rejected_and_all_history_preserved',source_db_sha256=dbsha,history_sha256=historysha)
# Actual OnFailure path for a real original-unit failure; existing event history stays.
startapp(P('/srv/nuaafa/releases')/TARGET);install('target');lock=os.open(ROOT/'.monitor.lock',os.O_RDWR);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
p=run(['systemctl','start','nuaafa-ops-monitor.service'],False);assert p['rc']!=0
fcntl.flock(lock,fcntl.LOCK_UN);os.close(lock)
wait(lambda:any(json.loads(x).get('kind')=='SYSTEMD_SERVICE_FAILURE' and json.loads(x).get('service')=='nuaafa-ops-monitor' for x in events.read_text().splitlines()))
record('exact_OnFailure_event_and_history_retention',result=props('nuaafa-ops-monitor.service'))
run(['systemctl','reset-failed','nuaafa-ops-monitor.service']);runmonitor('final-recovery',True);stopapp()
assert digest(db)==dbsha and digest(history)==historysha and events.read_bytes().startswith(prefix)
shutil.copyfile(events,OUT/'final-events.jsonl');shutil.copyfile(ROOT/'latest.json',OUT/'final-monitor-latest.json')
for phase in ['baseline','target']:
 for name in ['backup','monitor']:
  save(phase+'-'+name+'-identity.json',{'sha256':digest(INPUT/(phase+'-'+name+'.py')),'production_install':False})
save('final.json',{'status':'PASS','VA-B02':'PASS','checks':22,'original_regressions':42,'real_x86_64_systemd':True,'all_primary_service_runs_under_45_seconds':all(x['wall_seconds']<45 and x['after']['Result']=='success' for x in runs),'original_limits_unchanged':True,'native_observations':len(runs),'phase_matrix':['159','7b'],'data':'fictional only; no migrations executed','shipping_scripts_optimized':False,'production_access':False,'source_database_unchanged':digest(db)==dbsha,'old_history_preserved':digest(history)==historysha,'global_health':'DEGRADED: external failures retained; not an all-green site claim'})
record('VA_B02_native_complete',monitors=len(runs))
