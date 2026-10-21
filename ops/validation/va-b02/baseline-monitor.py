#!/usr/bin/python3
"""Read-only application and host observations; incident state is stored separately."""
import datetime, fcntl, hashlib, http.client, json, os, shutil, socket, sqlite3, ssl, stat, subprocess, sys, time, uuid
from pathlib import Path
ROOT=Path('/var/lib/nuaafa-ops-monitor')
BACKUP=Path('/var/lib/nuaafa-ops-backup')
DB=Path('/srv/nuaafa/shared/prisma/dev.db')
EXPECTED='159c36072341b31d1184afd076ed6667bd779c47'

def deployed_identity():
    """Bind a version pin to the live service and a stable process generation."""
    def observe():
        current=Path('/srv/nuaafa/current');releases=Path('/srv/nuaafa/releases')
        expected=releases/EXPECTED
        if not current.is_symlink() or os.readlink(current)!=str(expected) or current.resolve(strict=True)!=expected:
            raise RuntimeError('DEPLOYED_VERSION_MISMATCH')
        p=subprocess.run(['/usr/bin/systemctl','show','nuaafa.service','--property=ActiveState,SubState,MainPID,ControlGroup,NeedDaemonReload'],capture_output=True,text=True,timeout=3)
        if p.returncode:raise RuntimeError('DEPLOYED_SYSTEMD_READ')
        d=dict(l.split('=',1) for l in p.stdout.splitlines())
        if d.get('ActiveState')!='active' or d.get('SubState')!='running' or d.get('NeedDaemonReload')!='no':
            raise RuntimeError('DEPLOYED_SERVICE_NOT_STABLE')
        pid=int(d['MainPID'])
        if pid<=0 or d.get('ControlGroup')!='/system.slice/nuaafa.service':raise RuntimeError('DEPLOYED_PID_IDENTITY')
        proc=Path('/proc')/str(pid)
        start=proc.joinpath('stat').read_text().rsplit(')',1)[1].split()[19]
        if proc.joinpath('cwd').resolve(strict=True)!=expected:raise RuntimeError('DEPLOYED_CWD_MISMATCH')
        cgroup=proc.joinpath('cgroup').read_text().splitlines()
        if '0::'+d['ControlGroup'] not in cgroup:raise RuntimeError('DEPLOYED_CGROUP_MISMATCH')
        return (EXPECTED,pid,start)
    first=observe()
    if first!=observe():raise RuntimeError('DEPLOYED_PROCESS_CHANGED')
    return first

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def load(p,default):
    try:
        if p.is_symlink():raise ValueError('link')
        return json.loads(p.read_text())
    except FileNotFoundError:return default
def put(p,v):
    temp=p.with_name(p.name+'.'+uuid.uuid4().hex+'.tmp')
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as f:json.dump(v,f,sort_keys=True);f.write('\n');f.flush();os.fsync(f.fileno())
    os.replace(temp,p)
def append(p,v):
    fd=os.open(p,os.O_WRONLY|os.O_APPEND|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as f:f.write(json.dumps(v,sort_keys=True)+'\n');f.flush();os.fsync(f.fileno())
def show(unit):
    p=subprocess.run(['/usr/bin/systemctl','show',unit,'-p','ActiveState','-p','MainPID','-p','NRestarts','-p','Result','-p','ExecMainStatus','-p','LastTriggerUSec','-p','NextElapseUSecRealtime','-p','UnitFileState'],capture_output=True,text=True,timeout=3)
    if p.returncode:raise RuntimeError('SYSTEMD_READ')
    return dict(l.split('=',1) for l in p.stdout.splitlines())
def check_http(host,path,tls=True,port=None):
    start=time.monotonic()
    c=http.client.HTTPSConnection(host,port=port,timeout=4,context=ssl.create_default_context()) if tls else http.client.HTTPConnection(host,port or 3001,timeout=4)
    try:
        c.request('GET',path,headers={'User-Agent':'NUAAFA-readonly-ops-monitor','Connection':'close'})
        r=c.getresponse(); body=r.read(512*1024)
        ok=r.status==200 and time.monotonic()-start<3
        if path=='/api/health':ok=ok and json.loads(body).get('status')=='ok'
        return {'ok':ok,'status':r.status,'seconds':round(time.monotonic()-start,3)}
    finally:c.close()
def certificate(days):return days>21
def application_status(d):
    n=int(d['NRestarts']);pid=int(d['MainPID'])
    return {'ok':d['ActiveState']=='active' and pid>0,'restart_count':n,'pid':pid,'active':d['ActiveState']}
def application_restarts(current,prior):
    n=current['restart_count'];pid=current['pid']
    count_increased=n>prior.get('restart_count',n)
    pid_changed=pid>0 and prior.get('pid',0)>0 and pid!=prior['pid']
    return {'ok':not (count_increased or pid_changed),'restart_count':n,'pid':pid,'count_increased':count_increased,'pid_changed':pid_changed}
def check_backup_files(root):
    last=load(root/'last-success.json',{});p=Path(last.get('path','/nonexistent'))
    if p.parent!=root or p.resolve()!=p or not p.name.startswith('online-'):return {'ok':False}
    manifest=p/'manifest.json';done=load(p/'COMPLETED.json',{})
    if not manifest.is_file() or manifest.is_symlink() or (p/'FAILED.json').exists():return {'ok':False}
    raw=manifest.read_bytes()
    if done.get('manifest_sha256')!=hashlib.sha256(raw).hexdigest():return {'ok':False}
    m=json.loads(raw);checks=m['checksums'];total=0
    for n,expected in checks.items():
        rel=Path(n)
        if rel.is_absolute() or '..' in rel.parts:return {'ok':False}
        q=p/rel
        if q.resolve()!=q or q.is_symlink() or not q.is_file():return {'ok':False}
        h=hashlib.sha256();size=0
        with q.open('rb') as f:
            for data in iter(lambda:f.read(1024*1024),b''):h.update(data);size+=len(data)
        if h.hexdigest()!=expected['sha256'] or size!=expected['bytes']:return {'ok':False}
        total+=size
    return {'ok':True,'files_verified':len(checks),'bytes_verified':total}
def advance(old,checks,epoch):
    state={};events=[]
    for name,result in checks.items():
        prior=old.get(name,{});ok=result['ok'];bad=0 if ok else prior.get('failures',0)+1;good=prior.get('successes',0)+1 if ok else 0
        v={'failures':bad,'successes':good,'alerted':prior.get('alerted',False),'since':prior.get('since',epoch),'last_ok':ok}
        if not ok and not prior.get('failures',0) and not v['alerted']:v['since']=epoch
        threshold=1 if name=='APPLICATION_RESTARTS' else 3
        duration_basis='OBSERVED_RESTART_INSTABILITY_WINDOW' if name=='APPLICATION_RESTARTS' else 'OBSERVED_CHECK_FAILURE_WINDOW'
        if bad>=threshold and not v['alerted']:
            events.append({'kind':'INCIDENT_OPEN','check':name,'since_epoch':v['since'],'detected_epoch':epoch,'failures':bad,'duration_basis':duration_basis});v['alerted']=True
        if ok and good>=2 and v['alerted']:
            events.append({'kind':'INCIDENT_RECOVERY','check':name,'since_epoch':v['since'],'recovered_epoch':epoch,'duration_seconds':round(epoch-v['since'],3),'duration_basis':duration_basis});v['alerted']=False
        state[name]=v
    return state,events
def collect(previous):
    checks={};details={}
    def check(name,fn):
        try:
            r=fn();checks[name]={'ok':bool(r['ok'])};details[name]=r
        except Exception as e:checks[name]={'ok':False};details[name]={'ok':False,'error_type':type(e).__name__}
    check('PUBLIC_HTTPS_HOME',lambda:check_http('nuaafa.cn','/'))
    check('PUBLIC_HTTPS_HEALTH',lambda:check_http('nuaafa.cn','/api/health'))
    check('LOCAL_APPLICATION_HEALTH',lambda:check_http('127.0.0.1','/api/health',False))
    check('APPLICATION',lambda:application_status(show('nuaafa.service')))
    check('APPLICATION_RESTARTS',lambda:application_restarts(details['APPLICATION'],previous.get('details',{}).get('APPLICATION',{})))
    check('VERSION',lambda:{'ok':bool(deployed_identity())})
    check('NGINX',lambda:{'ok':show('nginx.service')['ActiveState']=='active'})
    def nginx_config():
        p=Path('/etc/nginx/sites-available/nuaafa-production.disabled.conf')
        return {'ok':hashlib.sha256(p.read_bytes()).hexdigest()=='0aaa8faa5708e769c7806236c8280057fcb9da664488cf83b7b48b8e69196488'}
    check('NGINX_CONFIG',nginx_config)
    def nginx_log():
        d=load(Path('/var/lib/nuaafa-ops-nginx-log/latest.json'),{})
        return {'ok':d.get('ok') is True and time.time()-d['epoch']<12*60 and d.get('errors_15m',0)<5 and d.get('critical_15m',0)==0,'errors_15m':d.get('errors_15m'),'critical_15m':d.get('critical_15m'),'age_seconds':round(time.time()-d['epoch']) if d else None}
    check('NGINX_ERROR_LOG',nginx_log)
    def db():
        c=sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True,timeout=0)
        try:
            c.execute('PRAGMA query_only=ON');c.execute('BEGIN');ok=c.execute('PRAGMA quick_check').fetchall()==[('ok',)] and c.execute('PRAGMA foreign_key_check').fetchall()==[] and c.total_changes==0
            return {'ok':ok,'total_changes':c.total_changes}
        finally:c.close()
    check('SQLITE',db)
    def space():
        v=os.statvfs('/srv/nuaafa/shared');used=1-v.f_bavail/v.f_blocks;iu=1-v.f_favail/v.f_files
        return {'ok':used<0.80 and v.f_bavail*v.f_frsize>5*1024**3 and iu<0.80,'disk_used_fraction':round(used,4),'inode_used_fraction':round(iu,4),'free_bytes':v.f_bavail*v.f_frsize}
    check('DISK_INODES',space)
    def memory():
        d={l.split(':')[0]:int(l.split()[1])*1024 for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith(('MemTotal:','MemAvailable:'))}
        used=1-d['MemAvailable']/d['MemTotal'];return {'ok':used<0.90,'used_fraction':round(used,4)}
    check('MEMORY',memory)
    def cpu():
        v=list(map(int,Path('/proc/stat').read_text().splitlines()[0].split()[1:9]));total=sum(v);idle=v[3]+v[4];old=previous.get('details',{}).get('CPU',{});delta=total-old.get('total',total);busy=1-(idle-old.get('idle',idle))/delta if delta>0 else 0
        load=os.getloadavg()[0]/(os.cpu_count() or 1);return {'ok':busy<0.90 and load<1.5,'busy_fraction':round(busy,4),'load_per_cpu':round(load,4),'total':total,'idle':idle}
    check('CPU',cpu)
    def cert():
        with socket.create_connection(('nuaafa.cn',443),timeout=4) as raw:
            with ssl.create_default_context().wrap_socket(raw,server_hostname='nuaafa.cn') as tls:
                end=ssl.cert_time_to_seconds(tls.getpeercert()['notAfter']);days=(end-time.time())/86400
        return {'ok':certificate(days),'remaining_days':round(days,2)}
    check('HTTPS_CERTIFICATE',cert)
    def renewal():
        t=show('certbot.timer');s=show('certbot.service');return {'ok':t['ActiveState']=='active' and t['UnitFileState']=='enabled' and s.get('Result','success')=='success','timer_active':t['ActiveState'],'last_service_result':s.get('Result')}
    check('CERTIFICATE_RENEWAL',renewal)
    def backup():
        last=load(BACKUP/'last-success.json',{});attempt=load(BACKUP/'last-attempt.json',{});epoch=datetime.datetime.fromisoformat(last['utc']).timestamp() if last else 0;age=time.time()-epoch
        return {'ok':last.get('status')=='PASS' and age<27*3600 and attempt.get('status')=='PASS','age_seconds':round(age),'last_attempt':attempt.get('status','MISSING')}
    check('BACKUP_FRESHNESS_AND_FAILURE',backup)
    def integrity():
        result=check_backup_files(BACKUP);a=show('nuaafa-ops-backup.service')
        result['ok']=result['ok'] and a.get('Result','success')=='success'
        return result
    check('BACKUP_COMPLETION',integrity)
    def restore_health():
        root=Path('/var/lib/nuaafa-ops-restore');last=load(root/'last-success.json',{});attempt=load(root/'last-attempt.json',{})
        age=time.time()-datetime.datetime.fromisoformat(last['utc']).timestamp() if last else float('inf')
        return {'ok':last.get('status')=='PASS' and attempt.get('status')=='PASS' and age<8*86400,'last_attempt':attempt.get('status','MISSING'),'age_seconds':round(age) if last else None}
    check('ISOLATED_RESTORE_FRESHNESS',restore_health)
    for u in ['nuaafa-ops-backup.timer','nuaafa-ops-monitor.timer','nuaafa-ops-restore.timer','nuaafa-ops-nginx-log.timer']:
        def timer(u=u):
            d=show(u);return {'ok':d['ActiveState']=='active' and d['UnitFileState']=='enabled','active':d['ActiveState'],'last_trigger':d.get('LastTriggerUSec'),'next_trigger':d.get('NextElapseUSecRealtime')}
        check('SCHEDULE_'+u,timer)
    return checks,details
def main():
    os.umask(0o077)
    if os.getuid()!=998 or ROOT.resolve()!=ROOT or stat.S_IMODE(ROOT.stat().st_mode)!=0o700:raise RuntimeError('STATE_IDENTITY')
    fd=os.open(ROOT/'.monitor.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if any(Path(p).exists() for p in ['/etc/nuaafa-b0-maintenance.flag','/etc/nuaafa-b0-web-maintenance.flag']):
            append(ROOT/'events.jsonl',{'utc':now(),'kind':'MONITOR_SKIPPED_APPROVED_MAINTENANCE'})
            print(json.dumps({'status':'SKIPPED','code':'APPROVED_MAINTENANCE'}));return 0
        start=time.monotonic();previous=load(ROOT/'latest.json',{});checks,details=collect(previous)
        state,events=advance(previous.get('state',{}),checks,time.time());utc=now()
        for e in events:append(ROOT/'events.jsonl',dict(utc=utc,**e,delivery='PENDING_TRANSPORT_CONFIGURATION'))
        day=utc[:10]
        if previous.get('summary_day')!=day:append(ROOT/'events.jsonl',{'utc':utc,'kind':'DAILY_HEALTH_SUMMARY','checks':len(checks),'unhealthy':sum(not x['ok'] for x in checks.values()),'delivery':'PENDING_TRANSPORT_CONFIGURATION'})
        result={'utc':utc,'status':'PASS' if all(x['ok'] for x in checks.values()) else 'DEGRADED','checks':checks,'details':details,'state':state,'summary_day':day,'elapsed_seconds':round(time.monotonic()-start,3),'events_emitted':len(events),'alert_delivery':'PENDING_TRANSPORT_CONFIGURATION'}
        put(ROOT/'latest.json',result)
        print(json.dumps({k:result[k] for k in ['utc','status','elapsed_seconds','events_emitted','alert_delivery']}))
        return 0
    finally:os.close(fd)
if __name__=='__main__':sys.exit(main())
