#!/usr/bin/env python3
"""Cold-start source and restored application using NEW fictional data only.

Runs against an already built checkout. Never reads a production environment or
an existing database. Source and restore directories are exclusive new temporary
objects. This does not validate a real production backup or an offsite copy.
"""
import base64
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
import urllib.error

REPO = Path(__file__).resolve().parents[1]
BASELINE = REPO / 'ops/monitoring/baseline/backup.py'
IMAGE = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=')
utc = lambda: dt.datetime.now(dt.timezone.utc).isoformat()
RESULT = None


def main():
    global RESULT
    for name in ('.env', '.env.local', '.env.production', '.env.production.local'):
        if (REPO / name).exists():
            raise RuntimeError('Refusing a checkout with runtime environment files')
    if not (REPO / '.next/BUILD_ID').is_file():
        raise RuntimeError('An existing candidate build is required')
    assert len(list((REPO / 'prisma/migrations').glob('*/migration.sql'))) == 21
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node unavailable')
    spec = importlib.util.spec_from_file_location('fictional_backup', BASELINE)
    backup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backup)
    out = {'startedAt': utc(), 'sourceCommit': subprocess.check_output(['git','rev-parse','HEAD'], cwd=REPO, text=True).strip(),
           'platform': platform.platform(), 'node': subprocess.check_output([node,'--version'], text=True).strip(),
           'backupLibrarySha256': hashlib.sha256(BASELINE.read_bytes()).hexdigest(),
           'scope': 'new fictional data and loopback HTTP only; no real backup or production access',
           'checks': [], 'processes': []}
    RESULT = out
    def check(name, condition, detail=None):
        out['checks'].append({'name': name, 'status': 'PASS' if condition else 'FAIL', 'detail': detail})
        if not condition:
            raise AssertionError(name)
    env = {k: os.environ[k] for k in ('PATH','HOME','TMPDIR','LANG','LC_ALL') if k in os.environ}
    env.update(NODE_ENV='production', NUAAFA_CONTENT_SOURCE='database', NEXT_TELEMETRY_DISABLED='1', CHECKPOINT_DISABLE='1',
               REFEREE_ADMIN_SESSION_SECRET='Fictional-Ops-Admin-Only-Isolated-20261027-Long-Secret',
               REFEREE_MEMBER_SESSION_SECRET='Fictional-Ops-Member-Only-Isolated-20261027-Long-Secret')
    with tempfile.TemporaryDirectory(prefix='nuaafa-fictional-app-restore-') as temp:
        root = Path(temp).resolve(); root.chmod(0o700)
        source = root/'source'; (source/'prisma').mkdir(parents=True, mode=0o700)
        uploads = source/'uploads'; (uploads/'2026/10').mkdir(parents=True, mode=0o700)
        database = source/'prisma/dev.db'
        database.touch(mode=0o600)
        migrate = subprocess.run([node, str(REPO/'node_modules/prisma/build/index.js'), 'migrate','deploy'], cwd=REPO,
                                 env={**env,'DATABASE_URL':'file:'+str(database)}, text=True, capture_output=True, timeout=120)
        migrate_detail = {'exitCode':migrate.returncode}
        if migrate.returncode:
            migrate_detail.update(stdout=migrate.stdout[-131072:],stderr=migrate.stderr[-131072:])
        check('all21 migrations deploy into new fictional database', migrate.returncode == 0, migrate_detail)
        image_name = '2026/10/00000000-0000-4000-8000-000000000001.png'; (uploads/image_name).write_bytes(IMAGE)
        now = int(time.time()*1000)
        body=json.dumps({'schemaVersion':1,'document':{'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'FICTITIOUS RESTORE ACCEPTANCE ONLY'}]}]}})
        with sqlite3.connect(database) as db:
            db.execute('INSERT INTO MediaAsset(id,storageKey,originalFilename,storedFilename,mimeType,size,visibility,altText,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)',
                       ('FICTITIOUS-media',image_name,'fictional.png',Path(image_name).name,'image/png',len(IMAGE),'PUBLIC','Fictional restore image',now,now))
            db.execute('INSERT INTO ContentPost(id,type,slug,title,summary,content,coverMediaId,status,publishedAt,pinned,featured,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       ('FICTITIOUS-post','NEWS','ops-fictional-restore','Fictional restore acceptance','Synthetic data only',body,'FICTITIOUS-media','PUBLISHED',now-3600000,0,0,now,now))
        def observe(label, path, upload_root):
            with socket.socket() as sock:
                sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
            process_log = root/(label+'.log')
            with process_log.open('w') as log:
                proc=subprocess.Popen([node,str(REPO/'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',str(port)],
                                      cwd=REPO,env={**env,'DATABASE_URL':'file:'+str(path),'NUAAFA_UPLOAD_DIR':str(upload_root)},stdout=log,stderr=subprocess.STDOUT)
                record={'label':label,'pid':proc.pid,'bind':'127.0.0.1','startedAt':utc()};out['processes'].append(record)
                try:
                    ready=False
                    for _ in range(300):
                        if proc.poll() is not None:break
                        try:
                            with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/api/health',timeout=1) as response:
                                ready=response.status==200 and json.load(response).get('status')=='ok'
                            if ready:break
                        except (OSError,ValueError):time.sleep(.1)
                    check(label+' cold startup and database health',ready)
                    for route in ['/api/health','/api/content/posts?limit=3','/news/ops-fictional-restore','/media/FICTITIOUS-media']:
                        with urllib.request.urlopen('http://127.0.0.1:'+str(port)+route,timeout=20) as response:
                            content=response.read();status=response.status
                        check(label+' HTTP '+route,status==200,{'http':status,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()})
                        if route.startswith('/api/content/'):check(label+' catalogue retains article',b'Fictional restore acceptance' in content)
                        if route.startswith('/news/'):check(label+' article retains body',b'FICTITIOUS RESTORE ACCEPTANCE ONLY' in content)
                        if route.startswith('/media/'):check(label+' image retains exact bytes',content==IMAGE)
                    for route in ['/api/admin/media','/api/admin/content/posts']:
                        try:
                            urllib.request.urlopen('http://127.0.0.1:'+str(port)+route,timeout=10)
                            status=200
                        except urllib.error.HTTPError as error:status=error.code
                        check(label+' unauthenticated admin boundary '+route,status in (401,403),{'http':status})
                finally:
                    proc.terminate()
                    try:proc.wait(timeout=8)
                    except subprocess.TimeoutExpired:proc.kill();proc.wait()
                    record.update(stoppedAt=utc(),exitCode=proc.returncode)
        try:
            observe('source',database,uploads)
            backups=root/'backups';backups.mkdir(mode=0o700)
            result=backup.backup(source,backups)
            check('installed ONLINE_OPS library produces complete fictional backup',result['status']=='PASS')
            recovery_point=Path(result['path']);manifest=backup.verify(recovery_point)
            check('manifest includes database and upload',len(manifest['checksums'])==2 and manifest['media_count']==1)
            target=root/'restored';result=backup.restore(recovery_point,target)
            check('restore into exclusive new private target',result['status']=='PASS')
            with sqlite3.connect((target/'database.sqlite').as_uri()+'?mode=ro',uri=True) as db:
                db.execute('PRAGMA query_only=ON')
                check('restored migration identity21',db.execute('SELECT count(*) FROM _prisma_migrations').fetchone()[0]==21)
                check('restored integrity and foreign keys',db.execute('PRAGMA integrity_check').fetchall()==[('ok',)] and not db.execute('PRAGMA foreign_key_check').fetchall())
            observe('restored',target/'database.sqlite',target/'uploads')
            a=backup.ro(database);b=backup.ro(target/'database.sqlite')
            try:check('all table content and schema remain identical',backup.logical(a)==backup.logical(b))
            finally:a.close();b.close()
            check('both own application instances stopped',len(out['processes'])==2 and all(x.get('stoppedAt') for x in out['processes']))
            out['status']='PASS'
        except Exception as error:
            out.update(status='FAIL',errorClass=type(error).__name__,error=str(error))
            out['diagnostics'] = {log.name: {'bytes':log.stat().st_size,'tail':log.read_text(errors='replace')[-131072:]}
                                  for log in root.glob('*.log') if log.is_file()}
        out['finishedAt']=utc()
        print(json.dumps(out,ensure_ascii=False,indent=2))
        return 0 if out['status']=='PASS' else 1


if __name__=='__main__':
    try:
        code = main()
    except Exception as error:
        failure = RESULT or {'checks': [], 'scope':'fictional test setup only'}
        failure.update(status='FAIL',errorClass=type(error).__name__,error=str(error),finishedAt=utc())
        print(json.dumps(failure,ensure_ascii=False,indent=2))
        code = 1
    raise SystemExit(code)
