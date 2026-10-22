#!/usr/bin/env python3
"""Own temporary units/users on a disposable GitHub Ubuntu24 runner only."""
import hashlib,json,os,pathlib,pwd,shutil,stat,subprocess,sys,time,uuid
P=pathlib.Path
def run(args,**kwargs):return subprocess.run(args,capture_output=True,text=True,timeout=kwargs.pop('timeout',15),**kwargs)
def checked(args,**kwargs):
    p=run(args,**kwargs)
    if p.returncode:raise RuntimeError('FIXTURE_COMMAND_FAILED: '+args[0])
    return p.stdout
def put(path,data,mode=0o600,uid=0,gid=0):
    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,mode)
    with os.fdopen(fd,'w') as f:os.fchmod(f.fileno(),mode);os.fchown(f.fileno(),uid,gid);f.write(data);f.flush();os.fsync(f.fileno())
assert os.getuid()==0 and os.environ.get('GITHUB_ACTIONS')=='true' and P('/opt/hostedtoolcache').is_dir()
assert P('/proc/1/comm').read_text().strip()=='systemd'
version=checked(['systemctl','--version']).splitlines()[0];assert version.startswith('systemd 255 ')
repo=P(sys.argv[1]).resolve();out=P(sys.argv[2]).resolve();assert out.parent==P(os.environ['RUNNER_TEMP']).resolve();assert out.is_dir()
ident=uuid.uuid4().hex[:10];root=P('/var/lib')/('nuaafa-alert-ci-'+ident);root.mkdir(mode=0o755);root.chmod(0o755)
source=root/'source';source.mkdir(mode=0o700);spool=root/'spool';spool.mkdir(mode=0o750);spool.chmod(0o750);state=root/'sender';state.mkdir(mode=0o700);results=root/'results';results.mkdir(mode=0o700)
users=['nalert'+ident[:6],'napp'+ident[:6]];created_users=[];units=[];flag=P('/run')/('nuaafa-alert-ci-'+ident+'.maintenance');flag_owned=False;success=False
try:
    for user in users:
        assert run(['id',user]).returncode!=0,'REFUSE_EXISTING_USER'
        checked(['useradd','--system','--no-create-home','--shell','/usr/sbin/nologin',user]);created_users.append(user)
    alert,app=[pwd.getpwnam(x) for x in users];os.chown(source,app.pw_uid,app.pw_gid);os.chown(spool,0,alert.pw_gid)
    for p in [state,results]:os.chown(p,alert.pw_uid,alert.pw_gid)
    code=root/'code';(code/'ops/alerts').mkdir(parents=True);(code/'scripts').mkdir()
    for relative in ['ops/alerts/alerts.py','scripts/test-alerts-isolated.py','scripts/alert-native-proof.py']:
        dest=code/relative;shutil.copyfile(repo/relative,dest);dest.chmod(0o644)
    now=time.time();stamp=time.strftime('%Y-%m-%dT%H:%M:%S+00:00',time.gmtime(now))
    sys.path.insert(0,str(code/'ops/alerts'));import alerts as A
    event=dict(kind='INCIDENT_OPEN',utc=stamp,check='SQLITE',since_epoch=now-600,detected_epoch=now,failures=3,duration_basis='OBSERVED_CHECK_FAILURE_WINDOW',private='FICTIONAL_SOURCE_CANARY')
    latest=dict(utc=stamp,status='PASS',checks={k:{'ok':True} for k in A.SOURCE_CHECKS})
    put(source/'events.jsonl',A.encode(event).decode(),uid=app.pw_uid,gid=app.pw_gid);put(source/'latest.json',A.encode(latest).decode(),uid=app.pw_uid,gid=app.pw_gid)
    put(root/'storage.json',A.encode(dict(status='PASS',backup_id='20261022T000000Z-000000000000',backup_utc=stamp,verified_utc=stamp)).decode())
    put(root/'business-canary', 'FICTIONAL_MASK_CANARY',0o644)
    bridge_config=dict(enabled=True,events=str(source/'events.jsonl'),latest=str(source/'latest.json'),storage_receipt=str(root/'storage.json'),spool=str(spool),source_uid=app.pw_uid)
    put(root/'bridge-config.json',json.dumps(bridge_config),0o640,gid=alert.pw_gid)
    put(root/'proof-config.json',json.dumps(dict(result=str(results/'proof.json'),state=str(state),spool=str(spool),expected_uid=alert.pw_uid,masked_canary=str(root/'business-canary'))),0o640,gid=alert.pw_gid)
    put(root/'smtp-plaintext',A.encode({'username':'fictional-user','password':'FICTIONAL_NATIVE_CANARY'}).decode());put(root/'heartbeat-plaintext','fictional-heartbeat-key-32-bytes-minimum')
    for name in ['smtp','heartbeat']:checked(['systemd-creds','encrypt','--with-key=host','--name='+name,str(root/(name+'-plaintext')),str(root/(name+'-encrypted'))])
    bridge_name='nuaafa-alert-bridge-fixture-'+ident+'.service';proof_name='nuaafa-alert-proof-fixture-'+ident+'.service'
    common='''[Unit]
Description=NUAAFA disposable alert fixture
ConditionPathExists=!FLAG
[Service]
Type=oneshot
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
PrivateNetwork=yes
UMask=0077
CPUQuota=10%
MemoryMax=64M
TasksMax=16
LimitCORE=0
TimeoutStartSec=60s
'''.replace('FLAG',str(flag))
    bridge=common+f'User=root\nGroup={alert.pw_name}\nCapabilityBoundingSet=CAP_DAC_READ_SEARCH\nReadOnlyPaths={source}\nReadWritePaths={spool}\nRestrictAddressFamilies=AF_UNIX\nExecStart=/usr/bin/python3 -I -B {code}/ops/alerts/alerts.py bridge --config={root}/bridge-config.json\n'
    proof=common+f'User={alert.pw_name}\nGroup={alert.pw_name}\nCapabilityBoundingSet=\nReadOnlyPaths={spool}\nReadWritePaths={state} {results}\nInaccessiblePaths={root}/business-canary -/srv -/etc/nuaafa\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nLoadCredentialEncrypted=smtp:{root}/smtp-encrypted\nLoadCredentialEncrypted=heartbeat:{root}/heartbeat-encrypted\nExecStart=/usr/bin/python3 -I -B {code}/scripts/alert-native-proof.py {root}\n'
    for name,body in [(bridge_name,bridge),(proof_name,proof)]:
        path=P('/run/systemd/system')/name;put(path,body,0o644);units.append((name,path))
    checked(['systemctl','daemon-reload']);checked(['systemctl','start',bridge_name]);bridge_show=checked(['systemctl','show',bridge_name,'-p','Result','-p','ExecMainStatus']);assert 'Result=success' in bridge_show and 'ExecMainStatus=0' in bridge_show
    put(flag,'owned disposable fixture only\n');flag_owned=True;checked(['systemctl','start',proof_name]);condition=checked(['systemctl','show',proof_name,'-p','ConditionResult']);assert condition.strip()=='ConditionResult=no' and not (results/'proof.json').exists();flag.unlink();flag_owned=False
    checked(['systemctl','start','--no-block',proof_name]);deadline=time.monotonic()+65
    while not (results/'proof.json').exists():
        failed=checked(['systemctl','show',proof_name,'-p','ActiveState','--value']).strip()=='failed'
        if failed or time.monotonic()>deadline:
            log=checked(['journalctl','-u',proof_name,'--no-pager','-o','cat','-n','35']);put(out/'native-failure.log',log,0o644);raise RuntimeError('NATIVE_PROOF_FAILED' if failed else 'NATIVE_PROOF_TIMEOUT')
        time.sleep(.2)
    observed=json.loads((results/'proof.json').read_text());credential=P(observed['credential_directory'])/'smtp';probe=run(['runuser','-u',app.pw_name,'--','/bin/cat',str(credential)]);assert probe.returncode!=0 and not probe.stdout,'OTHER_UID_READ_CREDENTIAL'
    put(results/'release','other-uid-denial-verified\n');deadline=time.monotonic()+15
    while json.loads((results/'proof.json').read_text())['status']!='PASS':assert time.monotonic()<deadline;time.sleep(.1)
    deadline=time.monotonic()+15
    while checked(['systemctl','show',proof_name,'-p','ActiveState','--value']).strip() in {'activating','active'}:assert time.monotonic()<deadline;time.sleep(.1)
    props=dict(line.split('=',1) for line in checked(['systemctl','show',proof_name,'--property=Result,ExecMainStatus,CPUQuotaPerSecUSec,MemoryMax,TasksMax,PrivateNetwork,NoNewPrivileges,ProtectSystem']).splitlines())
    assert props['Result']=='success' and props['ExecMainStatus']=='0' and props['MemoryMax']=='67108864' and props['TasksMax']=='16' and props['CPUQuotaPerSecUSec']=='100ms' and props['PrivateNetwork']=='yes' and props['NoNewPrivileges']=='yes' and props['ProtectSystem']=='strict'
    final=dict(status='PASS',systemd=version,properties=props,bridge_real_unit=True,sender_other_uid_denied=True,credential_encrypted_and_readonly=True,maintenance_skip_then_resume=True,loopback_tls_smtp_and_https=True,no_network_routes=True,no_production_access=True,no_real_mail=True)
    put(out/'native-systemd-result.json',json.dumps(final,indent=2)+'\n',0o644);print(json.dumps(final));success=True
finally:
    for name,path in units:
        # Only our owned fixture units; no production service or timer is named.
        run(['systemctl','stop',name],timeout=15)
        if path.exists():path.unlink()
    if units:run(['systemctl','daemon-reload'])
    if flag_owned and flag.exists():flag.unlink()
    for user in reversed(created_users):
        if run(['id',user]).returncode==0:run(['userdel',user])
    put(out/'native-cleanup.json',json.dumps({'status':'PASS','fixture_units_removed':all(not p.exists() for _,p in units),'fixture_users_removed':all(run(['id',u]).returncode!=0 for u in created_users),'test_completed':success})+'\n',0o644)
