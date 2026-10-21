#!/usr/bin/python3
"""Online read-only SQLite snapshot and stable-media backup. No live mutations."""
import datetime, fcntl, hashlib, json, os, shutil, sqlite3, stat, subprocess, sys, time, uuid
from pathlib import Path

SOURCE=Path('/srv/nuaafa/shared')
STATE=Path('/var/lib/nuaafa-ops-backup')
EXPECTED='7b2d90dcea69568fb95f482de9bc89eb84b85bfa'

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

class Stop(Exception): pass
def need(ok, code):
    if not ok: raise Stop(code)
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def maintenance_active():
    return any(Path(p).exists() for p in ['/etc/nuaafa-b0-maintenance.flag','/etc/nuaafa-b0-web-maintenance.flag'])
def encode(v): return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def write_new(p,data):
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f: f.write(data);f.flush();os.fsync(f.fileno())
def syncdir(p):
    fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)
def status(root,name,value):
    temp=root/(name+'.'+uuid.uuid4().hex+'.tmp')
    write_new(temp,encode(value)); os.replace(temp,root/name); syncdir(root)
def event(root,kind,**fields):
    fd=os.open(root/'events.jsonl',os.O_WRONLY|os.O_APPEND|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'ab') as f:f.write(encode(dict(utc=now(),kind=kind,**fields)));f.flush();os.fsync(f.fileno())
def safe_root(p):
    need(p.is_absolute() and p.resolve()==p,'PATH_ALIAS')
    s=p.stat(); need(stat.S_ISDIR(s.st_mode) and s.st_uid==os.getuid() and stat.S_IMODE(s.st_mode)==0o700,'OUTPUT_PERMISSION')
def identity(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink)
def hash_file(p, dest=None):
    before=p.lstat(); need(stat.S_ISREG(before.st_mode) and before.st_nlink==1,'MEDIA_LINK_OR_TYPE')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    out=None
    try:
        need(identity(os.fstat(fd))==identity(before),'FILE_RACE')
        if dest:
            dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            out=os.fdopen(os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb')
        h=hashlib.sha256()
        while True:
            b=os.read(fd,1024*1024)
            if not b:break
            h.update(b)
            if out:out.write(b)
        need(identity(os.fstat(fd))==identity(before) and identity(p.lstat())==identity(before),'FILE_CHANGED')
        if out:out.flush();os.fsync(out.fileno())
        return dict(bytes=before.st_size,sha256=h.hexdigest(),identity=list(identity(before)))
    finally:
        os.close(fd)
        if out:out.close()
def media_inventory(root, copy_to=None):
    need(root.resolve()==root,'MEDIA_ROOT_ALIAS'); result={}; dirs={}
    for base,children,files in os.walk(root,followlinks=False):
        d=Path(base); ds=d.lstat(); need(stat.S_ISDIR(ds.st_mode) and d.resolve()==d,'MEDIA_DIRECTORY_LINK')
        dirs[str(d.relative_to(root))]=list(identity(ds))
        for n in children:need(not (d/n).is_symlink(),'MEDIA_DIRECTORY_LINK')
        for n in sorted(files):
            p=d/n;k=str(p.relative_to(root));result[k]=hash_file(p,copy_to/k if copy_to else None)
    return {'files':result,'directories':dirs}
def ro(p):
    need(p.resolve()==p and stat.S_ISREG(p.lstat().st_mode),'DATABASE_ALIAS')
    c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True,timeout=0)
    c.execute('PRAGMA query_only=ON')
    return c
def logical(c):
    c.execute('BEGIN')
    try:
        need(c.execute('PRAGMA integrity_check').fetchall()==[('ok',)],'DATABASE_INTEGRITY')
        need(c.execute('PRAGMA foreign_key_check').fetchall()==[],'FOREIGN_KEYS')
        tables={}
        for (name,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
            rows=c.execute('SELECT * FROM "'+name.replace('"','""')+'"').fetchall()
            tables[name]={'count':len(rows),'sha256':hashlib.sha256(b''.join(sorted(hashlib.sha256(repr(r).encode()).digest() for r in rows))).hexdigest()}
        schema=list(c.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name'))
        need(c.total_changes==0,'SOURCE_WRITE')
        return {'tables':tables,'schema_sha256':hashlib.sha256(repr(schema).encode()).hexdigest()}
    finally:c.rollback()
def verify(p):
    need(p.resolve()==p and p.is_dir(),'BACKUP_ALIAS')
    need(not (p/'FAILED.json').exists(),'BACKUP_FAILED')
    m=json.loads((p/'manifest.json').read_text()); done=json.loads((p/'COMPLETED.json').read_text())
    need(done['manifest_sha256']==hash_file(p/'manifest.json')['sha256'] and done['backup_id']==m['backup_id'],'COMPLETION_BINDING')
    actual={str(q.relative_to(p)) for q in p.rglob('*') if q.is_file()}
    need(actual==set(m['checksums'])|{'manifest.json','COMPLETED.json'},'BACKUP_FILE_SET')
    need(not any(q.is_symlink() for q in p.rglob('*')),'BACKUP_LINK')
    for name,record in m['checksums'].items():
        q=Path(name);need(not q.is_absolute() and '..' not in q.parts,'BACKUP_PATH_ESCAPE')
        d=hash_file(p/q);need(d['sha256']==record['sha256'] and d['bytes']==record['bytes'],'BACKUP_CHECKSUM')
    c=ro(p/'database.sqlite')
    try:need(logical(c)==m['database_logical'],'BACKUP_DATABASE_LOGICAL')
    finally:c.close()
    need(m['consistency']=='ONLINE_STABLE_INTERVAL_VERIFIED','BACKUP_CONSISTENCY')
    return m
def restore(p,target):
    # Caller supplies a fresh private target. No merge, replace or live destination.
    need(target.is_absolute() and not os.path.lexists(target),'RESTORE_TARGET_EXISTS')
    need(not str(target).startswith('/srv/') and target.parent.resolve()==target.parent,'RESTORE_TARGET_UNSAFE')
    m=verify(p);target.mkdir(mode=0o700)
    for name,record in m['checksums'].items():
        out=target/name;out.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        d=hash_file(p/name,out);need(d['sha256']==record['sha256'],'RESTORE_CHECKSUM')
    c=ro(target/'database.sqlite')
    try:need(logical(c)==m['database_logical'],'RESTORE_DATABASE')
    finally:c.close()
    return {'status':'PASS','backup_id':m['backup_id'],'restored_files':len(m['checksums']),'tables':len(m['database_logical']['tables'])}
def backup(source=SOURCE,root=STATE,hook=None):
    os.umask(0o077); safe_root(root)
    lock=os.open(root/'.backup.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            event(root,'BACKUP_CONCURRENCY_BLOCKED');return {'status':'BLOCKED','code':'BACKUP_LOCKED'}
        if maintenance_active():
            event(root,'BACKUP_SKIPPED_APPROVED_MAINTENANCE')
            return {'status':'SKIPPED','code':'APPROVED_MAINTENANCE'}
        started=now(); ident=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:12]
        out=root/('online-'+ident);out.mkdir(mode=0o700)
        try:
            # Explicit custom sources remain usable for isolated library regression.
            # Scheduled production execution always uses the exact SOURCE default.
            bound=deployed_identity() if source==SOURCE else None
            need(source.resolve()==source,'SOURCE_ALIAS')
            db_before=identity((source/'prisma/dev.db').lstat())
            need(shutil.disk_usage(root).free>max(5*1024**3,(source/'prisma/dev.db').stat().st_size*4),'CAPACITY_LOW')
            before_media=media_inventory(source/'uploads')
            total=sum(v['bytes'] for v in before_media['files'].values())
            need(shutil.disk_usage(root).free>total*2+5*1024**3,'CAPACITY_LOW')
            c=ro(source/'prisma/dev.db')
            try:
                before=logical(c)
                target=out/'database.sqlite';write_new(target,b'')
                dst=sqlite3.connect(target);deadline=time.monotonic()+10
                def progress(code,left,all_pages):need(time.monotonic()<deadline,'DATABASE_BACKUP_TIMEOUT')
                try:c.backup(dst,pages=64,progress=progress,sleep=0.01)
                finally:dst.close()
                copy=ro(target)
                try:snap=logical(copy)
                finally:copy.close()
                copied=media_inventory(source/'uploads',out/'uploads')
                if hook:hook(source)
                after=logical(c); after_media=media_inventory(source/'uploads')
                need(before==snap==after,'DATABASE_CHANGED_DURING_BACKUP')
                need(identity((source/'prisma/dev.db').lstat())==db_before,'DATABASE_METADATA_CHANGED')
                need(before_media==copied==after_media,'MEDIA_CHANGED_DURING_BACKUP')
                refs=c.execute('SELECT storageKey,size FROM MediaAsset').fetchall()
                need(all(k in copied['files'] and copied['files'][k]['bytes']==size for k,size in refs),'MEDIA_REFERENCE_MISSING')
            finally:c.close()
            checks={str(q.relative_to(out)):{k:v for k,v in hash_file(q).items() if k!='identity'} for q in out.rglob('*') if q.is_file()}
            if bound is not None:
                need(deployed_identity()==bound,'DEPLOYED_PROCESS_CHANGED_DURING_BACKUP')
            manifest={'format':'NUAAFA_ONLINE_OPS_V1','backup_id':ident,'started_utc':started,'completed_utc':now(),'deployed_commit':EXPECTED,'consistency':'ONLINE_STABLE_INTERVAL_VERIFIED','strict_frozen_consistency':False,'database_logical':snap,'media_count':len(copied['files']),'media_reference_count':len(refs),'media_total_bytes':total,'source_total_changes':0,'checksums':checks}
            write_new(out/'manifest.json',encode(manifest))
            for directory in sorted((q for q in out.rglob('*') if q.is_dir()),key=lambda q:len(q.parts),reverse=True):syncdir(directory)
            syncdir(out)
            write_new(out/'COMPLETED.json',encode({'backup_id':ident,'manifest_sha256':hash_file(out/'manifest.json')['sha256'],'completed_utc':now()}));syncdir(out)
            verify(out)
            ok={'status':'PASS','utc':now(),'backup_id':ident,'path':str(out),'consistency':manifest['consistency'],'files':len(checks),'bytes':sum(x['bytes'] for x in checks.values()),'tables':len(snap['tables']),'media_count':len(copied['files'])}
            status(root,'last-success.json',ok);status(root,'last-attempt.json',ok);event(root,'BACKUP_SUCCESS',backup_id=ident)
            return ok
        except Exception as e:
            code=str(e) if isinstance(e,Stop) or (isinstance(e,RuntimeError) and str(e).startswith('DEPLOYED_')) else type(e).__name__
            fail={'status':'FAIL','utc':now(),'backup_id':ident,'code':code}
            write_new(out/'FAILED.json',encode(fail));status(root,'last-attempt.json',fail);event(root,'BACKUP_FAILURE',backup_id=ident,code=code)
            return fail
    finally:os.close(lock)
def main():
    if len(sys.argv)==1:
        need(os.getuid()==998,'WRONG_ACCOUNT')
        result=backup()
    elif len(sys.argv)==3 and sys.argv[1]=='verify':
        m=verify(Path(sys.argv[2]));result={'status':'PASS','backup_id':m['backup_id'],'files':len(m['checksums']),'consistency':m['consistency']}
    elif len(sys.argv)==4 and sys.argv[1]=='restore':result=restore(Path(sys.argv[2]),Path(sys.argv[3]))
    else:raise Stop('ARGUMENTS')
    print(json.dumps(result));return 0 if result['status'] in ['PASS','SKIPPED'] else 1
if __name__=='__main__':sys.exit(main())
