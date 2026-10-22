#!/usr/bin/env python3
"""Native CI only: real deployer and systemd, exclusively fictional owned data.

6db56b9 is the unchanged repair candidate. 4f21397 is a compatible prior
security candidate; it is NOT the current production version. No production
credentials, paths, service, database, remote ref or approval are used.
"""
import argparse, datetime, hashlib, importlib.util, json, os, pathlib, pwd, secrets
import shutil, socket, sqlite3, subprocess, sys, time, urllib.request

P = pathlib.Path
OLD = '4f21397bf21d1d2afb8f26839dc948965ca822a2'
NEW = '6db56b94c25ca3ce1376dabbda74714448decf53'

def main():
    p=argparse.ArgumentParser()
    for name in ('source','old-archive','new-archive','output'):p.add_argument('--'+name,type=P,required=True)
    args=p.parse_args();source=args.source.resolve(strict=True);output=args.output.resolve(strict=True)
    assert os.getuid()==0 and sys.platform=='linux'
    assert P('/proc/1/comm').read_text().strip()=='systemd'
    assert os.environ.get('GITHUB_ACTIONS')=='true', 'GitHub disposable runner required'
    assert output.is_relative_to(P(os.environ['RUNNER_TEMP']).resolve())
    assert subprocess.check_output(['git','-c','safe.directory='+str(source),'-C',str(source),'rev-parse','HEAD'],text=True).strip()==NEW
    sys.path.insert(0,str(source/'scripts'))
    spec=importlib.util.spec_from_file_location('linux_fixture',source/'scripts/test-prebuilt-linux.py')
    L=importlib.util.module_from_spec(spec);spec.loader.exec_module(L)
    A=L.A;resources=L.FixtureResources();root=L.exclusive_fixture(resources)
    account=resources.create_user();user=account.pw_name
    records=[];unit='nuaafa-rehearsal-'+secrets.token_hex(12)+'.service';service_started=False
    unit_path=P('/run/systemd/system')/unit;unit_identity=None
    def record(name,**detail):
        records.append(dict(name=name,status='PASS',utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),**detail))
        (output/'rehearsal-results.json').write_text(json.dumps(records,indent=2)+'\n')
        print(name+' PASS',flush=True)
    def run(command,label,env=None,expected=0,timeout=300):
        result=subprocess.run(list(map(str,command)),env=env,capture_output=True,text=True,timeout=timeout)
        (output/(label+'.log')).write_text(result.stdout+result.stderr)
        if expected==0:assert result.returncode==0,(label,result.returncode,result.stdout[-2500:],result.stderr[-6000:])
        else:assert result.returncode!=0,(label,'unexpected success')
        return result
    def props():
        x=subprocess.check_output(['systemctl','show',unit,'--property=ActiveState,SubState,MainPID,ControlGroup,NRestarts,SendSIGKILL,Result,WorkingDirectory'],text=True)
        return dict(line.split('=',1) for line in x.splitlines() if '=' in line)
    def healthy(commit):
        state=props();pid=int(state['MainPID']);assert state['ActiveState']=='active' and pid>1
        assert (P('/proc')/str(pid)/'cwd').resolve()==root/'releases'/commit
        assert state['NRestarts']=='0' and state['SendSIGKILL']=='no'
        with urllib.request.urlopen('http://127.0.0.1:3001/api/health',timeout=3) as response:
            assert json.load(response)=={'status':'ok'}
        return state
    def fingerprint():
        with sqlite3.connect(database) as db:
            assert db.execute('pragma integrity_check').fetchall()==[('ok',)]
            assert not db.execute('pragma foreign_key_check').fetchall()
            rows=db.execute('SELECT id,publicCode,name FROM Referee ORDER BY id').fetchall()
        return dict(logical_database=A.database_fingerprint(database),sentinels=rows,media_sha256=hashlib.sha256(media.read_bytes()).hexdigest())
    try:
        for name in ('releases','trusted','home','approvals'):(root/name).mkdir(mode=0o755)
        os.chown(root/'home',account.pw_uid,account.pw_gid)
        trusted=root/'trusted';node=trusted/'node';shutil.copyfile(shutil.which('node'),node);node.chmod(0o755)
        for source_name,target in [('ops/deploy/prebuilt-artifact.py','prebuilt-artifact.py'),('ops/deploy/nuaafa-deploy','deployer'),('scripts/student-id-release-preflight.mjs','student-id-release-preflight.mjs')]:
            shutil.copyfile(source/source_name,trusted/target);(trusted/target).chmod(0o755 if target=='deployer' else 0o644)
        remote=root/'fictional-remote.git'
        L.bundle_remote(source,remote,NEW,user)
        current=root/'current';shared=root/'shared';database=shared/'prisma/dev.db';state=trusted/'activation.json'
        env={**os.environ,'DEPLOYER':str(trusted/'deployer'),'ROOT':str(root),'NODE':str(node),'APP_USER':user,'UNIT':unit,'REMOTE':str(remote)}
        setup='''set -Eeuo pipefail
source "$DEPLOYER"
release_root="$ROOT/releases"; current_link="$ROOT/current"; shared="$ROOT/shared"
prebuilt_state="$ROOT/receipts"; prebuilt_approvals="$ROOT/approvals"
activation_state="$ROOT/trusted/activation.json"; prebuilt_helper="$ROOT/trusted/prebuilt-artifact.py"
prebuilt_start="$ROOT/trusted/start-prebuilt"; lock_file="$ROOT/deploy.lock"
repository="$REMOTE"; deploy_user="$APP_USER"; service_name="$UNIT"
student_id_preflight_node="$NODE"; student_id_preflight_command="$ROOT/trusted/student-id-release-preflight.mjs"
'''
        checksums={}
        for commit,archive in [(OLD,args.old_archive),(NEW,args.new_archive)]:
            checksum=hashlib.sha256(archive.read_bytes()).hexdigest();checksums[commit]=checksum
            run(['bash','-c',setup+'main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"'],
                'import-'+commit[:7],env={**env,'ARCHIVE':str(archive),'DIGEST':checksum,'COMMIT':commit},timeout=180)
        record('actual_import_both_exact_candidates',commits=[OLD,NEW],digests=checksums)
        shared.mkdir(mode=0o755);(shared/'prisma').mkdir(mode=0o755);(shared/'uploads').mkdir(mode=0o755)
        (shared/'backups').mkdir(mode=0o755);(shared/'backups/unified').mkdir(mode=0o700)
        os.chown(shared/'backups/unified',account.pw_uid,account.pw_gid)
        for path in (shared/'prisma',shared/'uploads'):os.chown(path,account.pw_uid,account.pw_gid)
        config=shared/'.env.production'
        config.write_text('DATABASE_URL=file:'+str(database)+'\nNUAAFA_UPLOAD_DIR='+str(shared/'uploads')+'\nNUAAFA_CONTENT_SOURCE=database\nREFEREE_ADMIN_SESSION_SECRET=Synthetic-Release-Rehearsal-Only-2026\nREFEREE_MEMBER_SESSION_SECRET=Synthetic-Release-Member-Only-2026\n')
        os.chown(config,0,account.pw_gid);config.chmod(0o640)
        inventory=A.migration_inventory(root/'releases'/OLD)
        assert len(inventory)==18 and inventory==A.migration_inventory(root/'releases'/NEW)
        with sqlite3.connect(database) as db:
            db.execute('CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY,checksum TEXT NOT NULL,finished_at DATETIME,migration_name TEXT NOT NULL,logs TEXT,rolled_back_at DATETIME,started_at DATETIME NOT NULL,applied_steps_count INTEGER NOT NULL DEFAULT 0)')
            for i,(name,digest) in enumerate(inventory.items()):
                db.executescript((root/'releases'/OLD/'prisma/migrations'/name/'migration.sql').read_text())
                db.execute('INSERT INTO _prisma_migrations (id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES (?,?,?,?,?,1)',('synthetic-'+str(i),digest,1700000000001+i,name,1700000000000+i))
            db.execute("INSERT INTO Referee (id,publicCode,name,updatedAt) VALUES ('synthetic-before','SYNTHETIC-BEFORE','Fictional before release',CURRENT_TIMESTAMP)")
            db.execute("INSERT INTO MediaAsset (id,storageKey,originalFilename,storedFilename,mimeType,size,updatedAt) VALUES ('synthetic-media','2026/10/00000000-0000-0000-0000-000000000001.pdf','fictional.pdf','00000000-0000-0000-0000-000000000001.pdf','application/pdf',?,CURRENT_TIMESTAMP)",(len(b'%PDF-1.7\nFictional release fixture\n'),))
        os.chown(database,account.pw_uid,account.pw_gid);database.chmod(0o600)
        media=shared/'uploads/2026/10/00000000-0000-0000-0000-000000000001.pdf';media.parent.mkdir(parents=True);media.write_bytes(b'%PDF-1.7\nFictional release fixture\n')
        for path in [media,*list((shared/'uploads').rglob('*'))]:os.chown(path,account.pw_uid,account.pw_gid)
        for commit in (OLD,NEW):
            release=root/'releases'/commit
            for name in ('.env.production','prisma/dev.db'):(release/name).symlink_to(shared/name)
        current.symlink_to(root/'releases'/OLD)
        start_spec=importlib.util.spec_from_file_location('startup_fixture',source/'scripts/test-start-prebuilt.py')
        startup=importlib.util.module_from_spec(start_spec);start_spec.loader.exec_module(startup)
        adaptation=startup.adapt_wrapper(trusted/'start-prebuilt',current,root/'releases',shared,node,user)
        # A runtime-only unit survives stop/start; it is removed before CI ends.
        unit_bytes=('[Unit]\nDescription=Fictional NUAAFA release rehearsal\n[Service]\nType=exec\nUser='+user+'\nWorkingDirectory='+str(current)+'\nExecStart='+str(trusted/'start-prebuilt')+'\nRestart=no\nKillMode=control-group\nSendSIGKILL=no\nTimeoutStopSec=30s\nSuccessExitStatus=143\nMemoryMax=1073741824\nTasksMax=128\nCPUQuota=100%\nNoNewPrivileges=yes\n').encode()
        fd=os.open(unit_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644)
        with os.fdopen(fd,'wb') as stream:stream.write(unit_bytes)
        info=unit_path.stat();unit_identity=(info.st_dev,info.st_ino)
        run(['systemctl','daemon-reload'],'load-isolated-runtime-unit',timeout=20)
        service_started=True
        run(['systemctl','start',unit],'bootstrap-service')
        for _ in range(60):
            try:healthy(OLD);break
            except (OSError,AssertionError,ValueError):time.sleep(.25)
        else:raise AssertionError('fictional baseline service not healthy')
        initial=fingerprint();pid=healthy(OLD)['MainPID']
        activate='main --activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"'
        newenv={**env,'DIGEST':checksums[NEW],'COMMIT':NEW}
        run(['bash','-c',setup+activate],'missing-approval-refused',newenv,expected=1)
        assert fingerprint()==initial and healthy(OLD)['MainPID']==pid and not list((shared/'backups/unified').iterdir())
        record('missing_approval_refused_before_backup_stop_or_data_change')
        # This is a disposable fixture's positive-path token, NOT a production approval.
        for commit in (OLD,NEW):
            approval=dict(format=1,commit=commit,artifact_sha256=checksums[commit],allowed_ref='refs/heads/main',security_gate='PASS',linux_artifact_validation='PASS',human_review='APPROVED')
            (root/'approvals'/(commit+'.json')).write_text(json.dumps(approval));(root/'approvals'/(commit+'.json')).chmod(0o600)
        run(['bash','-c',setup+activate],'actual-activation',newenv,timeout=300)
        assert current.resolve().name==NEW and json.loads(state.read_text())['phase']=='HEALTHY'
        assert fingerprint()==initial;new_state=healthy(NEW)
        assert not (P('/proc')/pid).exists()
        record('actual_backup_migrate_switch_start_health',process=new_state,wrapper_adaptation=adaptation,data_unchanged=True)
        with sqlite3.connect(database) as db:
            db.execute("INSERT INTO Referee (id,publicCode,name,updatedAt) VALUES ('synthetic-after','SYNTHETIC-AFTER','Fictional after release',CURRENT_TIMESTAMP)")
        latest=fingerprint();assert len(latest['sentinels'])==2
        oldenv={**env,'DIGEST':checksums[OLD],'COMMIT':OLD}
        run(['bash','-c',setup+activate],'actual-compatible-version-backout',oldenv,timeout=300)
        assert current.resolve().name==OLD and json.loads(state.read_text())['phase']=='HEALTHY'
        healthy(OLD);assert fingerprint()==latest
        assert not (P('/proc')/new_state['MainPID']).exists()
        record('compatible_version_backout_preserves_new_fictional_records',sentinels=2,media_unchanged=True)
        # Inject a failure AFTER the real stop, while still before migration.
        inject='stop_service() { /usr/bin/systemctl stop "$service_name"; return 97; }\n'
        run(['bash','-c',setup+inject+activate],'actual-pre-migration-failure',newenv,expected=1,timeout=300)
        assert json.loads(state.read_text())['phase']=='ROLLED_BACK' and current.resolve().name==OLD
        healthy(OLD);assert fingerprint()==latest
        record('pre_migration_failure_actual_automatic_rollback',journal_phase='ROLLED_BACK',latest_data_preserved=True)
        # A migration uncertainty must stop, never resurrect old code automatically.
        run(['bash','-c',setup+'run_migration() { return 97; }\n'+activate],'actual-migration-uncertainty',newenv,expected=1,timeout=300)
        assert json.loads(state.read_text())['phase']=='MANUAL_REQUIRED'
        stopped=props();assert stopped['MainPID']=='0' and stopped['ActiveState'] in ('inactive','failed')
        with socket.socket() as probe:
            assert probe.connect_ex(('127.0.0.1',3001))!=0
        assert fingerprint()==latest
        run(['/usr/sbin/runuser','-u',user,'--',trusted/'start-prebuilt','--check-release',root/'releases'/OLD],
            'uncertain-state-startup-refused',expected=1)
        record('migration_uncertainty_stops_and_refuses_old_startup',journal_phase='MANUAL_REQUIRED',latest_data_preserved=True)
        record('all_native_rehearsal_scenarios',candidate=NEW,compatible_previous=OLD,production_baseline_tested=False,
               production_access=False,production_approval_generated=False,release_allowed=False)
    finally:
        if service_started:
            run(['systemctl','stop',unit],'cleanup-stop',timeout=40)
            assert props().get('MainPID','0')=='0'
        if unit_identity is not None:
            info=unit_path.lstat()
            assert (info.st_dev,info.st_ino)==unit_identity and info.st_uid==0 and unit_path.read_bytes()==unit_bytes
            unit_path.unlink()
            run(['systemctl','daemon-reload'],'cleanup-runtime-unit',timeout=20)
        resources.cleanup()
        record('owned_test_resources_removed',user=user,root_removed=not root.exists())

if __name__=='__main__':main()
