#!/usr/bin/python3
import datetime,fcntl,importlib.util,json,os,shutil,sys,uuid
from pathlib import Path
spec=importlib.util.spec_from_file_location('verified_backup','/usr/local/lib/nuaafa-post-launch/backup.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
ROOT=Path('/var/lib/nuaafa-ops-restore')
SOURCE=Path('/var/lib/nuaafa-ops-backup')
def main():
    os.umask(0o077);b.need(os.getuid()==998,'WRONG_ACCOUNT');b.safe_root(ROOT)
    lock=os.open(ROOT/'.restore.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return 0
        if b.maintenance_active():
            b.event(ROOT,'RESTORE_SKIPPED_APPROVED_MAINTENANCE');print('{"status":"SKIPPED"}');return 0
        try:
            last=json.loads((SOURCE/'last-success.json').read_text());src=Path(last['path'])
            b.need(src.parent==SOURCE and src.name.startswith('online-') and last['status']=='PASS','UNTRUSTED_BACKUP_PATH')
            manifest=b.verify(src)
            b.need(shutil.disk_usage(ROOT).free>5*1024**3+sum(v['bytes'] for v in manifest['checksums'].values()),'RESTORE_CAPACITY_LOW')
            dest=ROOT/('restore-'+last['backup_id']+'-'+uuid.uuid4().hex[:8])
            result=b.restore(src,dest);result.update(utc=b.now(),restore_path=str(dest))
            b.status(ROOT,'last-success.json',result);b.status(ROOT,'last-attempt.json',result);b.event(ROOT,'RESTORE_SUCCESS',backup_id=result['backup_id'])
            print(json.dumps(result));return 0
        except Exception as e:
            result={'status':'FAIL','utc':b.now(),'code':str(e) if isinstance(e,b.Stop) else type(e).__name__}
            b.status(ROOT,'last-attempt.json',result);b.event(ROOT,'RESTORE_FAILURE',code=result['code']);print(json.dumps(result));return 1
    finally:os.close(lock)
if __name__=='__main__':sys.exit(main())
