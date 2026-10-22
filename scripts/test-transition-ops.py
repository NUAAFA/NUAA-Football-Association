#!/usr/bin/env python3
"""Exercise preserved ops identity/backup checks against the real fictional unit."""
import hashlib, importlib.util, json
from pathlib import Path
import subprocess, time, urllib.request
OLD='b68797c2e28e9dfdec215c460243628d1f0a4f6a'
NEW='6db56b94c25ca3ce1376dabbda74714448decf53'
def exercise_ops(output, root, shared, unit, commit):
    repo=Path(__file__).resolve().parents[1]
    spec=importlib.util.spec_from_file_location('pin_render',repo/'ops/security-transition/render-ops-pins.py');renderer=importlib.util.module_from_spec(spec);spec.loader.exec_module(renderer)
    modules={}
    for name in ('monitor','backup'):
        source=repo/'scripts/fixtures/security-ops'/(name+'.py')
        for target in (OLD,NEW):
            text=renderer.render(source.read_text(),target)
            # Only paths/unit constants are adapted; guard functions are intact.
            for old,new in [('/srv/nuaafa/current',str(root/'current')),('/srv/nuaafa/releases',str(root/'releases')),('/srv/nuaafa/shared',str(shared)),('nuaafa.service',unit)]:text=text.replace(old,new)
            path=root/'trusted'/('ops-'+name+'-'+target+'.py');path.write_text(text);path.chmod(0o644)
            spec=importlib.util.spec_from_file_location('test_ops_'+name+target,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);modules[(name,target)]=module
    other=OLD if commit==NEW else NEW
    for name in ('monitor','backup'):
        try:modules[(name,other)].deployed_identity()
        except RuntimeError as e:assert str(e)=='DEPLOYED_VERSION_MISMATCH'
        else:raise AssertionError('wrong ops pin accepted')
        bound=modules[(name,commit)].deployed_identity();assert bound[0]==commit and bound[1]>0
    backup=modules[('backup',commit)];state=root/('ops-backup-'+commit);state.mkdir(mode=0o700)
    result=backup.backup(source=shared,root=state);assert result['status']=='PASS',result
    archive=Path(result['path']);manifest=backup.verify(archive)
    assert manifest['deployed_commit']==commit and manifest['source_total_changes']==0
    restored=root/('ops-restore-'+commit);assert backup.restore(archive,restored)['status']=='PASS'
    last_success=(state/'last-success.json').read_bytes()
    def restart(_):
        subprocess.run(['systemctl','restart',unit],check=True,timeout=45)
        for _ in range(100):
            try:
                with urllib.request.urlopen('http://127.0.0.1:3001/api/health',timeout=1) as response:
                    assert json.load(response)=={'status':'ok'}
                break
            except (OSError,AssertionError):time.sleep(.1)
        else:raise AssertionError('fictional service did not recover')
    rejected=backup.backup(source=shared,root=state,hook=restart)
    assert rejected['status']=='FAIL' and rejected['code']=='DEPLOYED_PROCESS_CHANGED_DURING_BACKUP',rejected
    assert (state/'last-success.json').read_bytes()==last_success
    assert backup.verify(archive)['backup_id']==manifest['backup_id']
    result=dict(status='PASS',commit=commit,stale_pin_refused=True,actual_pid_cwd_cgroup_verified=True,online_backup_and_isolated_restore=True,backup_manifest_correct_commit=True,source_total_changes=0,real_service_generation_change_refused=True,last_success_preserved=True,whole_production_scripts_byte_identity='NOT RUN',production_access=False)
    (output/('ops-results-'+commit[:7]+'.json')).write_text(json.dumps(result,indent=2)+'\n')
    return result
