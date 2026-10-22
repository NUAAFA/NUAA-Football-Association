#!/usr/bin/env python3
"""Native CI only: real deployer and systemd, exclusively fictional owned data.

6db56b9 is the unchanged repair candidate. b68797c is the current production
source; both archives are the original authenticated CI bytes. No production
credentials, paths, service, database, remote ref or approval are used.
"""
import argparse, datetime, hashlib, importlib.util, json, os, pathlib, pwd, secrets
import shutil, socket, sqlite3, subprocess, sys, time, urllib.request

P = pathlib.Path
OLD = 'b68797c2e28e9dfdec215c460243628d1f0a4f6a'
NEW = '6db56b94c25ca3ce1376dabbda74714448decf53'

def main():
    p=argparse.ArgumentParser()
    for name in ('source','previous-source','old-node','new-node','old-archive','new-archive','output'):p.add_argument('--'+name,type=P,required=True)
    args=p.parse_args();source=args.source.resolve(strict=True);previous_source=args.previous_source.resolve(strict=True);output=args.output.resolve(strict=True)
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
    system_node=P('/usr/bin/node');node_alias_identity=None
    def record(name,**detail):
        records.append(dict(name=name,status='PASS',utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),**detail))
        (output/'rehearsal-results.json').write_text(json.dumps(records,indent=2)+'\n')
        print(name+' PASS',flush=True)
    def run(command,label,env=None,expected=0,timeout=300,cwd="/"):
        result=subprocess.run(list(map(str,command)),env=env,capture_output=True,text=True,timeout=timeout,cwd=cwd)
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
        trusted=root/'trusted';slots={};contracts={}
        for commit,tree,runtime in [(OLD,previous_source,args.old_node),(NEW,source,args.new_node)]:
            slot=trusted/commit;slot.mkdir(mode=0o755);slots[commit]=slot
            shutil.copyfile(runtime.resolve(strict=True),slot/'node');(slot/'node').chmod(0o755)
            for rel,name in [('ops/deploy/prebuilt-artifact.py','prebuilt-artifact.py'),('ops/deploy/nuaafa-deploy','deployer'),('scripts/student-id-release-preflight.mjs','student-id-release-preflight.mjs')]:
                shutil.copyfile(tree/rel,slot/name);(slot/name).chmod(0o755 if name=='deployer' else 0o644)
        node=slots[NEW]/'node'
        assert hashlib.sha256((slots[OLD]/'prebuilt-artifact.py').read_bytes()).hexdigest()=='5354eb97591d4e0954ca24b4d497cc957f9bc723cffa5f4d5d4fdd6ba69cb89a'
        assert hashlib.sha256((previous_source/'ops/deploy/start-prebuilt').read_bytes()).hexdigest()=='e3031b95a8d666126117df7ec3090cc63b1f1efa36820681016709f57d946b98'
        # setup-node only adds its cache to PATH. The real deployer intentionally
        # clears PATH; emulate the separately installed host runtime in this VM.
        if not os.path.lexists(system_node):
            system_node.symlink_to(node)
            info=system_node.lstat();node_alias_identity=(info.st_dev,info.st_ino)
        assert subprocess.check_output([system_node,'--version'],text=True).strip()=='v22.23.4'
        remote=root/'fictional-remote.git'
        L.bundle_remote(source,remote,NEW,user)
        current=root/'current';shared=root/'shared';database=shared/'prisma/dev.db';state=trusted/'activation.json'
        env={**os.environ,'DEPLOYER':str(slots[NEW]/'deployer'),'SLOT':str(slots[NEW]),'ROOT':str(root),'NODE':str(node),'APP_USER':user,'UNIT':unit,'REMOTE':str(remote)}
        setup='''set -Eeuo pipefail
source "$DEPLOYER"
release_root="$ROOT/releases"; current_link="$ROOT/current"; shared="$ROOT/shared"
prebuilt_state="$ROOT/receipts"; prebuilt_approvals="$ROOT/approvals"
activation_state="$ROOT/trusted/activation.json"; prebuilt_helper="$SLOT/prebuilt-artifact.py"
prebuilt_start="$ROOT/trusted/start-prebuilt"; lock_file="$ROOT/deploy.lock"
repository="$REMOTE"; deploy_user="$APP_USER"; service_name="$UNIT"
student_id_preflight_node="$NODE"; student_id_preflight_command="$SLOT/student-id-release-preflight.mjs"
'''
        checksums={}
        for commit,archive in [(OLD,args.old_archive),(NEW,args.new_archive)]:
            checksum=hashlib.sha256(archive.read_bytes()).hexdigest();checksums[commit]=checksum
            expected={OLD:'7ab7b87387363fb91ba9787eabd64f80c9ba76f1ded9b6fcf6915fb3f0de70b0',NEW:'20aa86143e1e65553fa37d27e3e67258f4e55136ccc4adc7d8bcb317a34f5ba1'}
            assert checksum==expected[commit], 'must use original authenticated archive bytes'
            slotenv={**env,'DEPLOYER':str(slots[commit]/'deployer'),'SLOT':str(slots[commit]),'NODE':str(slots[commit]/'node')}
            # The imported artifact is checked by its original exact tool/runtime.
            if system_node.is_symlink() and node_alias_identity is not None:
                system_node.unlink();system_node.symlink_to(slots[commit]/'node')
                info=system_node.lstat();node_alias_identity=(info.st_dev,info.st_ino)
            run(['bash','-c',setup+'main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"'],
                'import-'+commit[:7],env={**slotenv,'ARCHIVE':str(archive),'DIGEST':checksum,'COMMIT':commit},timeout=180)
        if node_alias_identity is not None:
            system_node.unlink();system_node.symlink_to(slots[OLD]/'node')
            info=system_node.lstat();node_alias_identity=(info.st_dev,info.st_ino)
        record('actual_import_both_original_artifacts',commits=[OLD,NEW],digests=checksums)
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
            db.execute("INSERT INTO Referee (id,publicCode,name,studentId,updatedAt) VALUES ('synthetic-before','SYNTHETIC-BEFORE','Fictional before release','SYNTHETIC-RELEASE-001',CURRENT_TIMESTAMP)")
            db.execute("INSERT INTO MediaAsset (id,storageKey,originalFilename,storedFilename,mimeType,size,updatedAt) VALUES ('synthetic-media','2026/10/00000000-0000-0000-0000-000000000001.pdf','fictional.pdf','00000000-0000-0000-0000-000000000001.pdf','application/pdf',?,CURRENT_TIMESTAMP)",(len(b'%PDF-1.7\nFictional release fixture\n'),))
        os.chown(database,account.pw_uid,account.pw_gid);database.chmod(0o600)
        preflight=run(['/usr/sbin/runuser','-u',user,'--',node,slots[NEW]/'student-id-release-preflight.mjs','--database='+str(database)],'fictional-data-preflight')
        assert json.loads(preflight.stdout)['releaseAllowed']==1
        media=shared/'uploads/2026/10/00000000-0000-0000-0000-000000000001.pdf';media.parent.mkdir(parents=True);media.write_bytes(b'%PDF-1.7\nFictional release fixture\n')
        for path in [media,*list((shared/'uploads').rglob('*'))]:os.chown(path,account.pw_uid,account.pw_gid)
        # Execute the ORIGINAL old release's backup, verifier and isolated restore.
        before_restore=fingerprint()
        old_release=root/'releases'/OLD;old_node=slots[OLD]/'node'
        backup_env={**os.environ,'PATH':str(old_node.parent)+':/usr/bin:/bin','DATABASE_URL':'file:'+str(database),'NUAAFA_UPLOAD_DIR':str(shared/'uploads'),'NUAAFA_CONTENT_SOURCE':'database'}
        backup_result=run(['/usr/sbin/runuser','-u',user,'--',old_node,old_release/'node_modules/tsx/dist/cli.mjs',old_release/'scripts/backup-unified-data.ts','--root='+str(shared/'backups/unified')],'old-original-backup',env=backup_env,cwd=old_release)
        backup=P(json.loads(backup_result.stdout)['outputDirectory'])
        run(['/usr/sbin/runuser','-u',user,'--',old_node,old_release/'node_modules/tsx/dist/cli.mjs',old_release/'scripts/verify-unified-backup.ts','--backup='+str(backup)],'old-original-backup-verification',env=backup_env,cwd=old_release)
        sandbox=root/'restore-sandbox';sandbox.mkdir(mode=0o755);os.chown(sandbox,account.pw_uid,account.pw_gid)
        restored_db=sandbox/'restored/prisma/dev.db';restored_media=sandbox/'restored/uploads'
        run(['/usr/sbin/runuser','-u',user,'--',old_node,old_release/'node_modules/tsx/dist/cli.mjs',old_release/'scripts/restore-unified-data.ts','--backup='+str(backup),'--database='+str(restored_db),'--uploads='+str(restored_media)],'old-original-isolated-restore',env={**backup_env,'NUAAFA_RESTORE_ISOLATED':'1','NUAAFA_RESTORE_TARGET_ROOT':str(sandbox)},cwd=old_release)
        assert A.database_fingerprint(restored_db)==before_restore['logical_database']
        assert hashlib.sha256((restored_media/media.relative_to(shared/'uploads')).read_bytes()).hexdigest()==before_restore['media_sha256']
        # Boot the actual old release on the verified restored fictional data.
        database.rename(root/'seed-original.db');restored_db.rename(database)
        (shared/'uploads').rename(root/'seed-original-uploads');restored_media.rename(shared/'uploads')
        assert fingerprint()==before_restore
        record('old_original_backup_verify_restore_exact_logical_and_media',restored_data_used_for_service=True,records=1)
        for commit in (OLD,NEW):
            release=root/'releases'/commit
            for name in ('.env.production','prisma/dev.db'):(release/name).symlink_to(shared/name)
        current.symlink_to(root/'releases'/OLD)
        start_spec=importlib.util.spec_from_file_location('startup_fixture',source/'scripts/test-start-prebuilt.py')
        startup=importlib.util.module_from_spec(start_spec);start_spec.loader.exec_module(startup)
        adaptations={}
        for commit,tree in [(OLD,previous_source),(NEW,source)]:
            startup.REPO=tree
            adaptations[commit]=startup.adapt_wrapper(slots[commit]/'start-prebuilt',current,root/'releases',shared,slots[commit]/'node',user)
            wrapper=slots[commit]/'start-prebuilt'
            text=wrapper.read_text().replace('ACTIVATION_STATE = '+repr(str(slots[commit]/'activation.json')),'ACTIVATION_STATE = '+repr(str(state)))
            wrapper.write_text(text);wrapper.chmod(0o755)
            contracts[commit]=dict(sha256=checksums[commit])
            for name,file in [('node',slots[commit]/'node'),('helper',slots[commit]/'prebuilt-artifact.py'),('start',wrapper)]:
                contracts[commit][name]=str(file);contracts[commit][name+'_sha256']=hashlib.sha256(file.read_bytes()).hexdigest()
        state.write_text(json.dumps(dict(format=1,commit=OLD,previous=OLD,phase='HEALTHY')));state.chmod(0o644)
        configuration=trusted/'security-transition.json'
        configuration.write_text(json.dumps(dict(format=1,current=str(current),releases=str(root/'releases'),contracts=contracts)));configuration.chmod(0o644)
        router_source=(P(__file__).resolve().parents[1]/'ops/security-transition/contract-router.py').read_text()
        for name in ('helper-transition.py','start-transition'):
            target=trusted/name;target.write_text(router_source.replace('CONFIG = "/etc/nuaafa/security-transition.json"','CONFIG = '+repr(str(configuration))));target.chmod(0o755)
        setup+='prebuilt_helper="$ROOT/trusted/helper-transition.py"; prebuilt_start="$ROOT/trusted/start-transition"\n'
        (output/'transition-contract-tested.json').write_text(json.dumps(dict(format=1,contracts=contracts,adaptations=adaptations),indent=2)+'\n')
        # A runtime-only unit survives stop/start; it is removed before CI ends.
        unit_bytes=('[Unit]\nDescription=Fictional NUAAFA release rehearsal\n[Service]\nType=exec\nUser='+user+'\nWorkingDirectory='+str(current)+'\nExecStart='+str(trusted/'start-transition')+'\nRestart=no\nKillMode=control-group\nSendSIGKILL=no\nTimeoutStopSec=infinity\nSuccessExitStatus=143\nMemoryHigh=1073741824\nMemoryMax=1610612736\nTasksMax=128\nCPUQuota=100%\nNoNewPrivileges=yes\n').encode()
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
        original_configuration=configuration.read_bytes()
        poisoned=json.loads(original_configuration);poisoned['contracts'][OLD]['node_sha256']='0'*64
        configuration.write_text(json.dumps(poisoned))
        try:
            run(['/usr/sbin/runuser','-u',user,'--',trusted/'start-transition','--check-release',root/'releases'/OLD],'transition-digest-drift-refused',expected=1)
        finally:configuration.write_bytes(original_configuration)
        run(['/usr/bin/python3','-I',trusted/'helper-transition.py','verify','--commit','f'*40,'--sha256',checksums[OLD]],'unknown-transition-commit-refused',expected=1)
        assert fingerprint()==initial and healthy(OLD)['MainPID']==pid
        record('transition_runtime_digest_drift_and_unknown_commit_refused')
        activate='main --activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"'
        newenv={**env,'DIGEST':checksums[NEW],'COMMIT':NEW}
        run(['bash','-c',setup+activate],'missing-approval-refused',newenv,expected=1)
        assert fingerprint()==initial and healthy(OLD)['MainPID']==pid
        record('missing_approval_refused_before_backup_stop_or_data_change')
        # This is a disposable fixture's positive-path token, NOT a production approval.
        for commit in (OLD,NEW):
            approval=dict(format=1,commit=commit,artifact_sha256=checksums[commit],allowed_ref='refs/heads/main',security_gate='PASS',linux_artifact_validation='PASS',human_review='APPROVED')
            (root/'approvals'/(commit+'.json')).write_text(json.dumps(approval));(root/'approvals'/(commit+'.json')).chmod(0o600)
        run(['bash','-c',setup+activate],'actual-activation',newenv,timeout=300)
        assert current.resolve().name==NEW and json.loads(state.read_text())['phase']=='HEALTHY'
        assert fingerprint()==initial;new_state=healthy(NEW)
        assert not (P('/proc')/pid).exists()
        record('actual_backup_migrate_switch_start_health',process=new_state,wrapper_adaptations=adaptations,data_unchanged=True)
        ops_spec=importlib.util.spec_from_file_location('transition_ops',P(__file__).with_name('test-transition-ops.py'))
        ops_test=importlib.util.module_from_spec(ops_spec);ops_spec.loader.exec_module(ops_test)
        record('new_ops_pin_backup_restore_and_generation_guards',result=ops_test.exercise_ops(output,root,shared,unit,NEW))
        new_state=healthy(NEW)
        # Bounded requests against the actual server under the proposed caps.
        import concurrent.futures
        def request(_):
            with urllib.request.urlopen('http://127.0.0.1:3001/'+('api/health' if _%2 else ''),timeout=10) as response:return response.status
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:assert list(pool.map(request,range(80)))==[200]*80
        group=P('/sys/fs/cgroup')/healthy(NEW)['ControlGroup'].lstrip('/')
        limits={name:((group/name).read_text().strip() if (group/name).exists() else 'UNKNOWN') for name in ('memory.max','memory.high','memory.peak','memory.events','cpu.max','pids.max','pids.peak')}
        assert limits['memory.max']=='1610612736' and limits['memory.high']=='1073741824' and limits['pids.max']=='128'
        assert limits['cpu.max'].split()[0]==limits['cpu.max'].split()[1]
        assert dict(line.split() for line in limits['memory.events'].splitlines())['oom_kill']=='0'
        assert fingerprint()==initial
        record('actual_resource_caps_and_bounded_http_load',requests=80,parallel=8,limits=limits,production_load_equivalence=False)
        with sqlite3.connect(database) as db:
            db.execute("INSERT INTO Referee (id,publicCode,name,studentId,updatedAt) VALUES ('synthetic-after','SYNTHETIC-AFTER','Fictional after release','SYNTHETIC-RELEASE-002',CURRENT_TIMESTAMP)")
        latest=fingerprint();assert len(latest['sentinels'])==2
        oldenv={**env,'DEPLOYER':str(slots[OLD]/'deployer'),'SLOT':str(slots[OLD]),'NODE':str(slots[OLD]/'node'),'DIGEST':checksums[OLD],'COMMIT':OLD}
        run(['bash','-c',setup+activate],'actual-old-production-version-backout',oldenv,timeout=300)
        assert current.resolve().name==OLD and json.loads(state.read_text())['phase']=='HEALTHY'
        healthy(OLD);assert fingerprint()==latest
        assert not (P('/proc')/new_state['MainPID']).exists()
        record('old_production_version_backout_preserves_new_fictional_records',sentinels=2,media_unchanged=True)
        record('old_ops_pin_backup_restore_and_generation_guards',result=ops_test.exercise_ops(output,root,shared,unit,OLD))
        assert fingerprint()==latest
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
        run(['/usr/sbin/runuser','-u',user,'--',trusted/'start-transition','--check-release',root/'releases'/OLD],
            'uncertain-state-startup-refused',expected=1)
        record('migration_uncertainty_stops_and_refuses_old_startup',journal_phase='MANUAL_REQUIRED',latest_data_preserved=True)
        record('all_native_rehearsal_scenarios',candidate=NEW,original_production_previous=OLD,production_baseline_tested=True,
               production_access=False,production_approval_generated=False,release_allowed=False)
    finally:
        if service_started:
            run(['systemctl','stop',unit],'cleanup-stop',timeout=60)
            assert props().get('MainPID','0')=='0'
        if unit_identity is not None:
            info=unit_path.lstat()
            assert (info.st_dev,info.st_ino)==unit_identity and info.st_uid==0 and unit_path.read_bytes()==unit_bytes
            unit_path.unlink()
            run(['systemctl','daemon-reload'],'cleanup-runtime-unit',timeout=20)
        if node_alias_identity is not None:
            info=system_node.lstat()
            assert (info.st_dev,info.st_ino)==node_alias_identity and system_node.is_symlink() and system_node.readlink() in (node,slots[OLD]/'node')
            system_node.unlink()
        resources.cleanup()
        record('owned_test_resources_removed',user=user,root_removed=not root.exists())

if __name__=='__main__':main()
