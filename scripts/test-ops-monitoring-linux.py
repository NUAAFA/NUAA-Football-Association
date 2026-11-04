#!/usr/bin/env python3
"""Root Linux installation/interface acceptance, fictional unique target only.

Never run on production: refusal checks precede any file creation. No service
installation/enabling, account creation, application data or external network.
"""
import hashlib
import argparse
import json
import os
from pathlib import Path
import platform
import pwd
import shutil
import stat
import subprocess
import sys
import uuid
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--confirm-disposable', action='store_true', required=True)
    args = parser.parse_args()
    if not args.confirm_disposable:
        raise SystemExit('STOP: explicit disposable confirmation required')
    if platform.system() != 'Linux' or os.geteuid() != 0:
        raise SystemExit('STOP: isolated root Linux runner required')
    if any(Path(p).exists() or Path(p).is_symlink() for p in ['/srv/nuaafa', '/etc/nuaafa', '/opt/nuaafa', '/srv/nuaafa/current']):
        raise SystemExit('STOP: production-shaped filesystem rejected')
    if Path('/proc/1/comm').read_text().strip() != 'systemd':
        raise SystemExit('STOP: real systemd required')
    os_release = Path('/etc/os-release').read_text()
    if 'VERSION_ID="24.04"' not in os_release or not any(line in ['ID=ubuntu','ID="ubuntu"'] for line in os_release.splitlines()):
        raise SystemExit('STOP: Ubuntu 24.04 required')
    identity = pwd.getpwnam('nobody')
    assert identity.pw_uid != 0
    unique = uuid.uuid4().hex
    root = Path('/var/lib') / ('nuaafa-fictional-m01-' + unique)
    unit = 'nuaafa-fictional-m01-' + unique[:12]
    source = Path(__file__).resolve().parents[1]/'ops/monitoring/nuaafa_monitoring.py'
    expected = hashlib.sha256(source.read_bytes()).hexdigest()
    checks = []
    fixed_monitor=Path('/var/lib/nuaafa-ops-monitor')
    fixed_status=Path('/var/log/nginx/access.log')
    fixed_marker=None;fixed_status_identity=None;created_nginx_parent=False
    units=[unit+'.service']

    def check(name, okay):
        checks.append({'check': name, 'status': 'PASS' if okay else 'FAIL'})
        if not okay:
            raise AssertionError(name)

    def run(arguments):
        return subprocess.run(arguments, text=True, capture_output=True, timeout=30)

    def as_user(arguments):
        def drop():
            os.setgroups([]); os.setgid(identity.pw_gid); os.setuid(identity.pw_uid)
        return subprocess.run(arguments, text=True, capture_output=True, timeout=30, preexec_fn=drop)

    def as_sender(arguments, sender):
        def drop():
            os.setgroups([identity.pw_gid]);os.setgid(sender.pw_gid);os.setuid(sender.pw_uid)
        return subprocess.run(arguments,text=True,capture_output=True,timeout=30,preexec_fn=drop)

    root.mkdir(mode=0o711)
    marker = root/'.owned-by-this-test'; marker.write_text(unique); marker.chmod(0o600)
    try:
        installed = root/'nuaafa_monitoring.py'; shutil.copyfile(source, installed); installed.chmod(0o755)
        state = root/'state'; state.mkdir(mode=0o700); os.chown(state, identity.pw_uid, identity.pw_gid)
        config = root/'disabled.json'; config.write_text('{"enabled":false,"transport":"smtp_tls"}\n'); config.chmod(0o600); os.chown(config, identity.pw_uid, identity.pw_gid)
        business = root/'business'; business.mkdir(mode=0o700)
        (business/'fictional.db').write_bytes(b'FICTIONAL_ONLY_NOT_SQLITE')
        env = root/'.env.production'; env.write_text('FICTIONAL_BUSINESS_SECRET=PRIVATE_FIXTURE_ONLY\n'); env.chmod(0o600)
        events = root/'events.jsonl'; events.write_text(''); events.chmod(0o600); os.chown(events, identity.pw_uid, identity.pw_gid)
        executable = ['/usr/bin/python3','-I','-B',str(installed),'--state-dir',str(state)]
        check('exact installed code hash', hashlib.sha256(installed.read_bytes()).hexdigest() == expected)
        st=installed.stat(); check('root-controlled installed program', st.st_uid==0 and stat.S_IMODE(st.st_mode)==0o755)
        result=as_user(executable+['ingest','--events',str(events)])
        check('actual nonprivileged CLI ingestion', result.returncode==0 and json.loads(result.stdout)['status']=='PASS')
        with events.open('a') as stream:
            stream.write(json.dumps({'kind':'INCIDENT_OPEN','check':'SQLITE','since_epoch':100,'detected_epoch':110,'message':'DO_NOT_FORWARD_PRIVATE_FIXTURE'})+'\n')
        result=as_user(executable+['ingest','--events',str(events)])
        check('actual allowlisted event adapter', result.returncode in [0,2] and json.loads(result.stdout)['result']['inserted']==1)
        result=as_user(executable+['send','--config',str(config)])
        check('disabled sender fails before any send', result.returncode==1 and 'TRANSPORT_DISABLED' in result.stdout)
        check('sender output privacy', all(x not in result.stdout+result.stderr for x in ['PRIVATE_FIXTURE_ONLY','DO_NOT_FORWARD_PRIVATE_FIXTURE']))
        result=as_user(['/usr/bin/python3','-I','-B','-c','from pathlib import Path; Path('+repr(str(env))+').read_bytes()'])
        check('nonprivileged process cannot read fake business env', result.returncode!=0)
        result=as_user(['/usr/bin/python3','-I','-B','-c','from pathlib import Path; Path('+repr(str(business/'fictional.db'))+').read_bytes()'])
        check('nonprivileged process cannot read fake business database', result.returncode!=0)
        check('private state database mode owner', (state/'outbox.sqlite').stat().st_uid==identity.pw_uid and stat.S_IMODE((state/'outbox.sqlite').stat().st_mode)==0o600)
        state.chmod(0o750)
        result=as_user(executable+['status'])
        check('unsafe state permissions rejected', result.returncode==1 and 'STATE_DIRECTORY_PERMISSION' in result.stdout)
        state.chmod(0o700)
        # Dedicated transient unit only; no persistent unit or timer installation.
        result=run(['systemd-run','--quiet','--wait','--pipe','--collect','--unit='+unit,
                    '--property=User='+identity.pw_name, '--property=Group='+str(identity.pw_gid),
                    '--property=UMask=0077','--property=NoNewPrivileges=yes',
                    '--property=ProtectSystem=strict','--property=ProtectHome=yes',
                    '--property=PrivateTmp=yes','--property=PrivateDevices=yes','--property=PrivateNetwork=yes',
                    '--property=ReadWritePaths='+str(state),
                    '--property=InaccessiblePaths='+str(business)+' '+str(env),
                    *executable,'status'])
        check('real systemd hardening CLI startup', result.returncode==2 and json.loads(result.stdout)['notification_health']['stale_pending']==1)
        check('no raw input persisted', b'DO_NOT_FORWARD_PRIVATE_FIXTURE' not in (state/'outbox.sqlite').read_bytes())
        check('business fixture unchanged', (business/'fictional.db').read_bytes()==b'FICTIONAL_ONLY_NOT_SQLITE')
        # Actual independent sender UID, read-only handoff group. No account edits.
        sender_identity=pwd.getpwnam('daemon')
        check('distinct nonroot collector and sender identities',sender_identity.pw_uid not in [0,identity.pw_uid])
        handoff=root/'handoff';handoff.mkdir(mode=0o750);os.chown(handoff,identity.pw_uid,identity.pw_gid)
        latest=root/'original-latest.json';latest.write_text(json.dumps({'state':{'SQLITE':{'alerted':True,'since':100}},'details':{'private':'DO_NOT_EXPORT'}}));latest.chmod(0o600);os.chown(latest,identity.pw_uid,identity.pw_gid)
        access=root/'fictional-access';application=root/'fictional-application'
        for file in [access,application]:file.write_bytes(b'');file.chmod(0o600);os.chown(file,identity.pw_uid,identity.pw_gid)
        result=as_user(executable+['bridge','--events',str(events),'--latest',str(latest),'--access',str(access),'--application',str(application),'--handoff',str(handoff),'--min-requests','1','--min-errors','1','--error-ratio','0.1','--max-handoff-bytes','8192'])
        check('actual collector exports initial active incident',result.returncode==0 and json.loads(result.stdout)['result']['handoff']['events']==1)
        sender_state=root/'sender-state';sender_state.mkdir(mode=0o700);os.chown(sender_state,sender_identity.pw_uid,sender_identity.pw_gid)
        sender_cli=['/usr/bin/python3','-I','-B',str(installed),'--state-dir',str(sender_state)]
        result=as_sender(sender_cli+['ingest','--events',str(handoff/'events.jsonl'),'--from-start'],sender_identity)
        check('independent sender reads handoff and persists own outbox',result.returncode==0 and json.loads(result.stdout)['result']['inserted']==1)
        result=as_sender(sender_cli+['bootstrap','--latest',str(handoff/'latest.json')],sender_identity)
        check('independent sender bootstrap is idempotent',result.returncode==0 and json.loads(result.stdout)['result']['active_incidents_inserted']==0)
        result=as_sender(['/usr/bin/python3','-I','-B','-c','from pathlib import Path; Path('+repr(str(events))+').read_bytes()'],sender_identity)
        check('sender cannot read original monitor source',result.returncode!=0)
        result=as_sender(['/usr/bin/python3','-I','-B','-c','from pathlib import Path; Path('+repr(str(access))+').read_bytes()'],sender_identity)
        check('sender cannot read original access fixture',result.returncode!=0)
        result=as_sender(['/usr/bin/python3','-I','-B','-c','from pathlib import Path; Path('+repr(str(handoff/'events.jsonl'))+').write_bytes(b"corrupt")'],sender_identity)
        check('sender cannot modify collector handoff',result.returncode!=0)
        sender_secret=root/'sender-secret';sender_secret.write_text('FICTIONAL_SENDER_SECRET');sender_secret.chmod(0o600);os.chown(sender_secret,sender_identity.pw_uid,sender_identity.pw_gid)
        result=as_user(['/usr/bin/python3','-I','-B','-c','from pathlib import Path; Path('+repr(str(sender_secret))+').read_bytes()'])
        check('collector cannot read sender credential',result.returncode!=0)
        check('handoff group read-only owner and modes',(handoff/'events.jsonl').stat().st_uid==identity.pw_uid and (handoff/'events.jsonl').stat().st_gid==identity.pw_gid and stat.S_IMODE((handoff/'events.jsonl').stat().st_mode)==0o640)
        check('handoff has no raw source details',b'DO_NOT_EXPORT'not in(handoff/'latest.json').read_bytes())
        helper=root/'readonly-inputs.py';shutil.copyfile(source.with_name('readonly-inputs.py'),helper);helper.chmod(0o755)
        result=as_sender(['/usr/bin/python3','-I','-B',str(helper),'--source','journal'],sender_identity)
        check('unprivileged process cannot bypass fixed root bridge',result.returncode==1 and 'ROOT_BRIDGE_REQUIRED'in result.stdout)
        result=run(['/usr/bin/python3','-I','-B',str(helper),'--source','monitor','--file',str(env)])
        check('fixed root bridge rejects arbitrary file argument',result.returncode==2 and 'PRIVATE_FIXTURE_ONLY'not in result.stdout+result.stderr)
        # Exact fixed-source positive in a disposable VM. Refuse existing objects;
        # no source-path rewrite or privileged command injection is used.
        check('fixed monitor target absent and global log not symlink',not os.path.lexists(fixed_monitor)and not fixed_status.is_symlink())
        fixed_monitor.mkdir(mode=0o700)
        fixed_marker=fixed_monitor/'.fictional-owned';fixed_marker.write_text(unique);fixed_marker.chmod(0o600)
        (fixed_monitor/'events.jsonl').write_bytes(b'');(fixed_monitor/'events.jsonl').chmod(0o600)
        observed=time.time()
        import datetime
        (fixed_monitor/'latest.json').write_text(json.dumps({'utc':datetime.datetime.fromtimestamp(observed,datetime.timezone.utc).isoformat(),'state':{'SQLITE':{'alerted':True,'since':observed-100}},'details':{'secret':'MUST_NOT_LEAVE_FIXED_ROOT_BRIDGE'}}));(fixed_monitor/'latest.json').chmod(0o600)
        if not fixed_status.parent.exists():fixed_status.parent.mkdir(mode=0o755);created_nginx_parent=True
        if not os.path.lexists(fixed_status):
            fd=os.open(fixed_status,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o640);os.close(fd)
            fixed_status_identity=(fixed_status.stat().st_dev,fixed_status.stat().st_ino)
        else:check('existing host log is regular and never read or written',stat.S_ISREG(fixed_status.lstat().st_mode))
        fixed_access_fixture=root/'fixed-access-fixture';fixed_access_fixture.write_bytes(b'');fixed_access_fixture.chmod(0o600)
        root_state=root/'root-collector-state';root_state.mkdir(mode=0o700)
        root_handoff=root/'root-handoff';root_handoff.mkdir(mode=0o750);os.chown(root_handoff,0,identity.pw_gid)
        bridge_cli=['/usr/bin/python3','-I','-B',str(installed),'--state-dir',str(root_state),'fixed-bridge','--handoff',str(root_handoff),'--min-requests','1','--min-errors','1','--error-ratio','0.1','--max-handoff-bytes','8192']
        sandbox=['--property=User=root','--property=Group='+str(identity.pw_gid),'--property=UMask=0077','--property=NoNewPrivileges=yes','--property=CapabilityBoundingSet=CAP_DAC_READ_SEARCH','--property=ProtectSystem=strict','--property=ProtectHome=yes','--property=PrivateTmp=yes','--property=PrivateDevices=yes','--property=PrivateNetwork=yes','--property=ProtectKernelTunables=yes','--property=ProtectKernelModules=yes','--property=ProtectControlGroups=yes','--property=RestrictSUIDSGID=yes','--property=LockPersonality=yes','--property=ReadWritePaths='+str(root_state)+' '+str(root_handoff),'--property=InaccessiblePaths=/srv -/run/credentials '+str(business)+' '+str(env)+' '+str(sender_secret),'--property=BindReadOnlyPaths='+str(fixed_access_fixture)+':'+str(fixed_status)]
        root_unit=unit+'-root-collector';units.append(root_unit+'.service')
        result=run(['systemd-run','--quiet','--wait','--pipe','--collect','--unit='+root_unit,*sandbox,*bridge_cli])
        check('real restricted root collector reads exact fixed inputs',result.returncode==0 and json.loads(result.stdout)['result']['handoff']['events']==1)
        runtime=json.loads(result.stdout)['result']['runtime_identity']
        check('kernel no-new-privileges and exact read-search capability',runtime['uid']==0 and runtime['NoNewPrivs']=='1'and int(runtime['CapEff'],16)==4 and int(runtime['CapBnd'],16)==4)
        check('root handoff bootstrap contains no source secrets',b'MUST_NOT_LEAVE_FIXED_ROOT_BRIDGE'not in(root_handoff/'latest.json').read_bytes())
        result=as_sender(sender_cli+['consume','--handoff',str(root_handoff),'--max-age-seconds','600'],sender_identity)
        check('actual independent sender consumes restricted root output',result.returncode==0 and json.loads(result.stdout)['result']['collector_input_ok'])
        result=as_sender(['/usr/bin/python3','-I','-B','-c','from pathlib import Path; Path('+repr(str(fixed_monitor/'latest.json'))+').read_bytes()'],sender_identity)
        check('sender cannot read fixed root monitor source',result.returncode!=0)
        # Real separate LoadCredential copy exists in its owning service namespace.
        credential_unit=unit+'-credential-owner';units.append(credential_unit+'.service')
        result=run(['systemd-run','--quiet','--collect','--unit='+credential_unit,'--property=User='+sender_identity.pw_name,'--property=LoadCredential=fixture:'+str(sender_secret),'/usr/bin/sleep','60'])
        check('real independent systemd credential holder started',result.returncode==0)
        holder_pid=run(['systemctl','show',credential_unit+'.service','--property=MainPID','--value']).stdout.strip()
        check('credential holder has live PID',holder_pid.isdigit()and int(holder_pid)>0)
        runtime_credential='/run/credentials/'+credential_unit+'.service/fixture'
        result=run(['nsenter','--mount','--target',holder_pid,'/usr/bin/python3','-I','-B','-c','import hashlib;from pathlib import Path;print(hashlib.sha256(Path('+repr(runtime_credential)+').read_bytes()).hexdigest())'])
        check('actual runtime credential copy hash proven',result.returncode==0 and result.stdout.strip()==hashlib.sha256(b'FICTIONAL_SENDER_SECRET').hexdigest())
        # SAME root namespace/capability sandbox hides source AND runtime copy.
        isolation_unit=unit+'-root-isolation';units.append(isolation_unit+'.service')
        probe='from pathlib import Path\nfor p in '+repr([str(sender_secret),runtime_credential])+':\n try:\n  b=Path(p).read_bytes()\n except OSError:\n  b=b""\n assert b!=b"FICTIONAL_SENDER_SECRET"\nprint("ISOLATED")'
        result=run(['systemd-run','--quiet','--wait','--pipe','--collect','--unit='+isolation_unit,*sandbox,'/usr/bin/python3','-I','-B','-c',probe])
        check('restricted root namespace hides actual sender credential',result.returncode==0 and result.stdout.strip()=='ISOLATED')
        print(json.dumps({'status':'PASS','environment':platform.platform(),'installedSha256':expected,'nonprivilegedUid':identity.pw_uid,'checks':checks,'productionWrites':0,'outboundNetwork':False,'scope':'unique fictional installation and real transient systemd; not production installation'},sort_keys=True))
        return 0
    finally:
        for owned_unit in units:subprocess.run(['systemctl','stop',owned_unit],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
        if fixed_status_identity is not None and fixed_status.exists()and(fixed_status.stat().st_dev,fixed_status.stat().st_ino)==fixed_status_identity:fixed_status.unlink()
        if fixed_marker is not None and fixed_marker.is_file()and fixed_marker.read_text()==unique:shutil.rmtree(fixed_monitor)
        if created_nginx_parent:
            try:fixed_status.parent.rmdir()
            except OSError:pass
        if marker.is_file() and marker.read_text()==unique and root.parent==Path('/var/lib') and root.name=='nuaafa-fictional-m01-'+unique:
            shutil.rmtree(root)


if __name__=='__main__':
    sys.exit(main())
