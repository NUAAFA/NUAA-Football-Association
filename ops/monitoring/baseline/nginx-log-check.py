#!/usr/bin/python3
"""Read Nginx-owned error log as www-data; expose only aggregate counts."""
import fcntl,json,os,re,stat,sys,time,uuid
from pathlib import Path
ROOT=Path('/var/lib/nuaafa-ops-nginx-log')
LOG=Path('/var/log/nginx/error.log')
def save(p,value,mode):
    tmp=p.with_name(p.name+'.'+uuid.uuid4().hex+'.tmp')
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    with os.fdopen(fd,'w') as f:json.dump(value,f,sort_keys=True);f.write('\n');f.flush();os.fsync(f.fileno())
    os.replace(tmp,p)
def scan(log,previous,epoch):
    s=log.lstat()
    if not stat.S_ISREG(s.st_mode) or log.resolve()!=log:raise ValueError('LOG_PATH_TYPE')
    identity=[s.st_dev,s.st_ino]
    if not previous:
        return {'identity':identity,'offset':s.st_size,'windows':[]},{'ok':True,'epoch':epoch,'initial_existing_bytes_skipped':s.st_size,'errors_15m':0,'critical_15m':0,'backlog_bytes':0}
    offset=previous['offset'] if previous.get('identity')==identity and s.st_size>=previous['offset'] else 0
    fd=os.open(log,os.O_RDONLY|os.O_NOFOLLOW|getattr(os,'O_NOATIME',0))
    try:
        if [os.fstat(fd).st_dev,os.fstat(fd).st_ino]!=identity:raise ValueError('LOG_RACE')
        os.lseek(fd,offset,os.SEEK_SET);data=os.read(fd,1024*1024)
        after=os.fstat(fd)
        if [log.stat().st_dev,log.stat().st_ino]!=identity:raise ValueError('LOG_ROTATED_DURING_SCAN')
    finally:os.close(fd)
    end=data.rfind(b'\n')+1;complete=data[:end]
    errors=sum(bool(re.search(rb'\[error\]',line)) for line in complete.splitlines())
    critical=sum(bool(re.search(rb'\[(crit|alert|emerg)\]',line)) for line in complete.splitlines())
    windows=[w for w in previous.get('windows',[]) if epoch-w['epoch']<15*60]
    if errors or critical:windows.append({'epoch':epoch,'errors':errors,'critical':critical})
    offset+=end;backlog=max(0,after.st_size-offset)
    result={'ok':backlog<1024*1024,'epoch':epoch,'errors_15m':sum(w['errors'] for w in windows),'critical_15m':sum(w['critical'] for w in windows),'backlog_bytes':backlog,'bytes_scanned':end}
    return {'identity':identity,'offset':offset,'windows':windows},result
def main():
    if os.getuid()!=33 or ROOT.resolve()!=ROOT:raise RuntimeError('WRONG_IDENTITY')
    lock=os.open(ROOT/'.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        statepath=ROOT/'private-state.json';previous=json.loads(statepath.read_text()) if statepath.exists() else {}
        state,result=scan(LOG,previous,time.time());save(statepath,state,0o600);save(ROOT/'latest.json',result,0o644)
        print(json.dumps(result));return 0
    except Exception as e:
        result={'ok':False,'epoch':time.time(),'code':type(e).__name__};save(ROOT/'latest.json',result,0o644);print(json.dumps(result));return 1
    finally:os.close(lock)
if __name__=='__main__':sys.exit(main())
