#!/usr/bin/env python3
"""Disposable systemd fixture worker. Never run with production credentials."""
import importlib.util,json,os,pathlib,stat,sys,tempfile,time
P=pathlib.Path
spec=importlib.util.spec_from_file_location('loopback_tests',P(__file__).with_name('test-alerts-isolated.py'));T=importlib.util.module_from_spec(spec);spec.loader.exec_module(T);A=T.A
root=P(sys.argv[1]);config=A.config_file(root/'proof-config.json');output=P(config['result']);state=P(config['state']);spool=P(config['spool']);creds=P(os.environ['CREDENTIALS_DIRECTORY'])
assert os.getuid()==config['expected_uid']!=0 and not [x for x in P('/proc/net/route').read_text().splitlines()[1:] if x.strip()]
assert A.credentials(creds/'smtp')=={'username':'fictional-user','password':'FICTIONAL_NATIVE_CANARY'}
assert (creds/'smtp').stat().st_uid==os.getuid() and os.statvfs(creds).f_flag&os.ST_RDONLY
try:(creds/'smtp').open('ab')
except (PermissionError,OSError):pass
else:raise RuntimeError('CREDENTIAL_WRITABLE')
try:P(config['masked_canary']).read_bytes()
except (PermissionError,OSError):pass
else:raise RuntimeError('BUSINESS_MASK_NOT_EFFECTIVE')
assert os.statvfs(P(__file__)).f_flag&os.ST_RDONLY
with tempfile.TemporaryDirectory(prefix='nuaafa-native-fake-tls-') as t:
    certroot=P(t).resolve();T.certs(certroot)
    with T.server('smtp',certroot) as smtp:
        c=dict(enabled=True,isolated=True,host='localhost',port=smtp.server_address[1],sender='alert@fixture.invalid',recipients=['ops@fixture.invalid'],ca_file=str(certroot/'ca.crt'),spool_uid=0,deadline_seconds=15)
        delivery=A.deliver(spool,state,c,creds/'smtp');assert delivery['delivered']==1 and len(smtp.messages)==1 and b'FICTIONAL_NATIVE_CANARY' not in smtp.messages[0]
    with T.server('https',certroot) as https:
        https.now=time.time();https.key=(creds/'heartbeat').read_bytes();hc=dict(enabled=True,isolated=True,host='localhost',port=https.server_address[1],path='/heartbeat',ca_file=str(certroot/'ca.crt'),spool_uid=0,deadline_seconds=10)
        hb=A.send_heartbeat(spool,state,hc,creds/'heartbeat',delivery);assert hb['status']=='PASS' and https.received['health']=='PASS'
record=dict(status='AWAITING_OTHER_UID_DENIAL',uid=os.getuid(),credential_directory=str(creds),credential_readonly=True,network_routes=0,application_path_masked=True,code_readonly=True,synthetic_tls_smtp='PASS',synthetic_https_heartbeat='PASS',private_values_exported=False)
A.atomic(output,A.encode(record));deadline=time.monotonic()+25
while not (output.parent/'release').exists():
    assert time.monotonic()<deadline,'UID_PROBE_TIMEOUT';time.sleep(.1)
record['status']='PASS';A.atomic(output,A.encode(record));print(json.dumps({k:v for k,v in record.items() if k!='credential_directory'}))
