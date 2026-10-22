#!/usr/bin/env python3
"""Real loopback TLS SMTP/HTTPS tests. Fictional data and credentials only."""
import base64,contextlib,hashlib,hmac,http.server,importlib.util,io,json,os,pathlib,smtplib,socketserver,ssl,subprocess,tempfile,threading,time,unittest
from unittest.mock import patch
P=pathlib.Path
spec=importlib.util.spec_from_file_location('alerts',P(__file__).resolve().parents[1]/'ops/alerts/alerts.py');A=importlib.util.module_from_spec(spec);spec.loader.exec_module(A)
def private(path,data):path.write_bytes(data);path.chmod(0o600)
def certs(root):
    def run(args):
        r=subprocess.run(['openssl',*args],capture_output=True,timeout=15)
        if r.returncode:raise RuntimeError('FICTIONAL_CERT_GENERATION_FAILED')
    run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(root/'ca.key'),'-out',str(root/'ca.crt'),'-days','2','-subj','/CN=NUAAFA-FICTIONAL-TEST-CA'])
    run(['req','-new','-newkey','rsa:2048','-nodes','-keyout',str(root/'server.key'),'-out',str(root/'server.csr'),'-subj','/CN=localhost'])
    private(root/'index.txt',b'');private(root/'index.txt.attr',b'unique_subject = no\n');private(root/'serial',b'1000\n');(root/'new').mkdir()
    conf='''[ca]
default_ca=test
[test]
database=DIR/index.txt
new_certs_dir=DIR/new
certificate=DIR/ca.crt
private_key=DIR/ca.key
serial=DIR/serial
default_md=sha256
default_days=1
policy=policy
x509_extensions=server
[policy]
commonName=supplied
[server]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1
'''.replace('DIR',str(root))
    private(root/'ca.conf',conf.encode())
    run(['ca','-batch','-notext','-config',str(root/'ca.conf'),'-in',str(root/'server.csr'),'-out',str(root/'server.crt')])
    run(['ca','-batch','-notext','-config',str(root/'ca.conf'),'-in',str(root/'server.csr'),'-out',str(root/'expired.crt'),'-startdate','20000101000000Z','-enddate','20000102000000Z'])
    for p in root.glob('*.key'):p.chmod(0o600)
class TLSMixin:
    allow_reuse_address=True
    daemon_threads=True
    def get_request(self):
        s,address=super().get_request();s.settimeout(3)
        try:return self.tls.wrap_socket(s,server_side=True),address
        except BaseException:s.close();raise
    def handle_error(self,*args):pass
class SMTPServer(TLSMixin,socketserver.ThreadingTCPServer):pass
class SMTPHandler(socketserver.StreamRequestHandler):
    def handle(self):
        s=self.server
        def send(v):self.wfile.write(v+b'\r\n');self.wfile.flush()
        send(b'220 fixture.invalid ESMTP')
        while True:
            line=self.rfile.readline(8192)
            if not line:return
            word=line.split(b' ',1)[0].strip().upper()
            if word==b'EHLO':
                if s.stall:time.sleep(2)
                send(b'250-fixture.invalid');send(b'250 AUTH PLAIN')
            elif word==b'AUTH':s.auth_count+=1;send(b'535 fictional authentication rejected' if s.auth_fail else b'235 authenticated')
            elif word==b'MAIL':send(b'250 sender accepted')
            elif word==b'RCPT':
                address=line.decode().split('<',1)[1].split('>',1)[0];s.rcpts.append(address);send(b'550 rejected' if address in s.refuse else b'250 accepted')
            elif word==b'DATA':
                send(b'354 send data');parts=[]
                while True:
                    v=self.rfile.readline(8192)
                    if not v or v==b'.\r\n':break
                    parts.append(v)
                s.messages.append(b''.join(parts));send(str(s.data_code).encode()+b' fictional result')
            elif word==b'RSET':send(b'250 reset')
            elif word==b'QUIT':send(b'221 bye');return
            else:send(b'500 unsupported')
class HTTPSServer(TLSMixin,http.server.ThreadingHTTPServer):pass
class HTTPSHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        s=self.server;status=s.http_status;body=(b'{"status":"ok"}' if s.health_ok else b'{"status":"bad"}') if self.path=='/api/health' else b'fictional home'
        if s.oversize:body=b'x'*8193
        self.send_response(status);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_POST(self):
        s=self.server;n=int(self.headers.get('Content-Length','0'));raw=self.rfile.read(min(n,4097));signature=self.headers.get('X-NUAAFA-Signature','')
        try:
            s.received=A.record_heartbeat(s.received_state,raw,signature,s.key,s.now) if s.received_state is not None else A.accept_heartbeat(raw,signature,s.key,s.received,s.now)
            status=200;body=b'{"accepted":true}'
        except A.Refused:status=400;body=b'{"accepted":false}'
        self.send_response(status);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
@contextlib.contextmanager
def server(kind,root,expired=False):
    cls,handler=(SMTPServer,SMTPHandler) if kind=='smtp' else (HTTPSServer,HTTPSHandler)
    s=cls(('127.0.0.1',0),handler);s.tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);s.tls.load_cert_chain(root/('expired.crt' if expired else 'server.crt'),root/'server.key')
    s.auth_count=0;s.auth_fail=False;s.stall=False;s.data_code=250;s.refuse=set();s.messages=[];s.rcpts=[];s.http_status=200;s.health_ok=True;s.oversize=False;s.key=b'fictional-heartbeat-key-32-bytes-minimum';s.received={};s.received_state=None;s.now=1000
    thread=threading.Thread(target=s.serve_forever,daemon=True);thread.start()
    try:yield s
    finally:s.shutdown();s.server_close();thread.join(3)
class Alerts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.certs_tmp=tempfile.TemporaryDirectory();cls.certroot=P(cls.certs_tmp.name).resolve();certs(cls.certroot)
    @classmethod
    def tearDownClass(cls):cls.certs_tmp.cleanup()
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=P(self.tmp.name).resolve();self.spool=self.root/'spool';self.spool.mkdir();self.spool.chmod(0o750);self.state=self.root/'state';self.state.mkdir(mode=0o700);self.cred=self.root/'smtp';private(self.cred,A.encode({'username':'fictional-user','password':'FICTIONAL_SECRET_CANARY'}));self.hbcred=self.root/'heartbeat';private(self.hbcred,b'fictional-heartbeat-key-32-bytes-minimum');self.now=1000
    def tearDown(self):self.tmp.cleanup()
    def event(self,**extra):
        d=dict(kind='INCIDENT_OPEN',utc=A.stamp(1000),check='SQLITE',since_epoch=100,detected_epoch=700,failures=3,duration_basis='OBSERVED_CHECK_FAILURE_WINDOW');d.update(extra);return d
    def queue(self,event=None):
        e=A.sanitize(event or self.event());A.atomic(self.spool/(e['event_id']+'.json'),A.encode(e),0o640,True);return e
    def config(self,s):return dict(enabled=True,isolated=True,host='localhost',port=s.server_address[1],sender='alert@fixture.invalid',recipients=['ops@fixture.invalid'],ca_file=str(self.certroot/'ca.crt'),spool_uid=os.getuid(),deadline_seconds=5)
    def health(self,now=1000,storage='PASS'):
        latest={'utc':A.stamp(now),'status':'PASS','checks':{k:{'ok':True} for k in A.SOURCE_CHECKS},'details':{'secret':'FICTIONAL_SECRET_CANARY'}};return latest,A.heartbeat_observation(latest,storage,now)
    def receipt(self,now=1000):return dict(status='PASS',backup_id='19700101T001640Z-000000000000',backup_utc=A.stamp(now),verified_utc=A.stamp(now))
    def source(self,raw=None):
        folder=self.root/'source';folder.mkdir(mode=0o700);events=folder/'events.jsonl';latest=folder/'latest.json';storage=self.root/'storage.json'
        private(events,raw if raw is not None else A.encode(self.event(password='FICTIONAL_SECRET_CANARY')));private(latest,A.encode(self.health()[0]));private(storage,A.encode(self.receipt()));return events,latest,storage
    def test_bridge_private_filter_and_exact_replay(self):
        paths=self.source();out=A.bridge(*paths,self.spool,os.getuid(),1000);self.assertEqual(out['events_processed'],1);out=A.bridge(*paths,self.spool,os.getuid(),1000);self.assertEqual(out['events_processed'],0)
        for p in self.spool.glob('*.json'):self.assertNotIn(b'FICTIONAL_SECRET_CANARY',p.read_bytes())
        self.assertEqual(len(list(self.spool.glob('[a-f0-9]'*64+'.json'))),1)
    def test_bridge_duplicate_nan_unknown_line_bound(self):
        for raw in [b'{"kind":"X","kind":"Y"}\n',b'{"number":NaN}\n',A.encode(self.event(check='UNKNOWN')),b'x'*8193+b'\n']:
            with self.subTest(size=len(raw)):
                with tempfile.TemporaryDirectory() as t:
                    out=P(t).resolve();out.chmod(0o750);p=self.root/'raw';private(p,raw);latest=self.root/'latest';private(latest,A.encode(self.health()[0]));store=self.root/'storage';private(store,A.encode(self.receipt()))
                    with self.assertRaises((A.Refused,ValueError)):A.bridge(p,latest,store,out,os.getuid(),1000)
                    self.assertFalse((out/'cursor.json').exists())
    def test_bridge_symlink_hardlink_and_permissions(self):
        paths=self.source();link=self.root/'link';link.symlink_to(paths[0])
        with self.assertRaises(A.Refused):A.bridge(link,*paths[1:],self.spool,os.getuid(),1000)
        paths[0].chmod(0o644)
        with self.assertRaises(A.Refused):A.bridge(*paths,self.spool,os.getuid(),1000)
        paths[0].chmod(0o600);os.link(paths[0],self.root/'hardlink')
        with self.assertRaises(A.Refused):A.bridge(*paths,self.spool,os.getuid(),1000)
    def test_bridge_rotation_truncation_and_rewrite(self):
        paths=self.source();A.bridge(*paths,self.spool,os.getuid(),1000);original=paths[0].read_bytes();private(paths[0],original[:-1])
        with self.assertRaises(A.Refused):A.bridge(*paths,self.spool,os.getuid(),1000)
        private(paths[0],original.replace(b'SQLITE',b'MEMORY'))
        with self.assertRaises(A.Refused):A.bridge(*paths,self.spool,os.getuid(),1000)
        paths[0].rename(paths[0].with_suffix('.old'));private(paths[0],original)
        with self.assertRaises(A.Refused):A.bridge(*paths,self.spool,os.getuid(),1000)
    def test_bridge_partial_line_no_loss(self):
        line=A.encode(self.event());paths=self.source(line[:-1]);out=A.bridge(*paths,self.spool,os.getuid(),1000);self.assertEqual(out['events_processed'],0)
        with paths[0].open('ab') as f:f.write(b'\n')
        self.assertEqual(A.bridge(*paths,self.spool,os.getuid(),1000)['events_processed'],1)
    def test_bridge_durable_cursor_failure_replays_without_duplicate(self):
        paths=self.source();real=A.atomic
        def fail(p,*args,**kwargs):
            if p.name=='cursor.json':raise OSError('FICTIONAL_DISK_FULL')
            return real(p,*args,**kwargs)
        with patch.object(A,'atomic',side_effect=fail):
            with self.assertRaises(OSError):A.bridge(*paths,self.spool,os.getuid(),1000)
        self.assertEqual(A.bridge(*paths,self.spool,os.getuid(),1000)['events_processed'],1)
        self.assertEqual(len([p for p in self.spool.iterdir() if len(p.stem)==64]),1)
    def test_tls_smtp_delivery_and_restart_dedup(self):
        e=self.queue(self.event(password='FICTIONAL_SECRET_CANARY'))
        with server('smtp',self.certroot) as s:
            config=self.config(s);out=A.deliver(self.spool,self.state,config,self.cred,1000);self.assertEqual(out['delivered'],1);self.assertEqual(len(s.messages),1);self.assertNotIn(b'FICTIONAL_SECRET_CANARY',s.messages[0]);self.assertIn(e['event_id'].encode(),s.messages[0]);self.assertEqual(A.deliver(self.spool,self.state,config,self.cred,1100)['attempted'],0);self.assertEqual(len(s.messages),1)
    def test_tls_untrusted_expired_and_hostname_fail_closed(self):
        for name in ['untrusted','expired','hostname']:
            with self.subTest(name=name),server('smtp',self.certroot,expired=name=='expired') as s:
                config=self.config(s)
                if name=='untrusted':config.pop('ca_file')
                if name=='hostname':config['host']='wrong.fixture.invalid'
                if name=='hostname':
                    with patch.object(A,'endpoint',return_value='127.0.0.1'):
                        with self.assertRaises(ssl.SSLError):A.smtp_send(A.sanitize(self.event()),config,A.credentials(self.cred),config['recipients'])
                else:
                    with self.assertRaises(ssl.SSLError):A.smtp_send(A.sanitize(self.event()),config,A.credentials(self.cred),config['recipients'])
                self.assertEqual(s.auth_count,0);self.assertEqual(len(s.messages),0)
    def test_authentication_quarantine_no_secret_logs(self):
        self.queue()
        with server('smtp',self.certroot) as s:
            s.auth_fail=True;out=A.deliver(self.spool,self.state,self.config(s),self.cred,1000);self.assertEqual(out['quarantined'],1);self.assertNotIn('FICTIONAL_SECRET_CANARY',(self.state/'outbox.json').read_text());self.assertEqual(len(s.messages),0)
    def test_smtp_4xx_retry_persisted_then_success(self):
        self.queue()
        with server('smtp',self.certroot) as s:
            s.data_code=451;c=self.config(s);self.assertEqual(A.deliver(self.spool,self.state,c,self.cred,1000)['pending'],1);self.assertEqual(A.deliver(self.spool,self.state,c,self.cred,1059)['attempted'],0);s.data_code=250;self.assertEqual(A.deliver(self.spool,self.state,c,self.cred,1060)['delivered'],1)
    def test_smtp_5xx_quarantine(self):
        self.queue()
        with server('smtp',self.certroot) as s:s.data_code=550;self.assertEqual(A.deliver(self.spool,self.state,self.config(s),self.cred,1000)['quarantined'],1)
    def test_partial_recipient_acceptance_not_resent(self):
        self.queue()
        with server('smtp',self.certroot) as s:
            c=self.config(s);c['recipients'].append('backup@fixture.invalid');s.refuse.add('backup@fixture.invalid');out=A.deliver(self.spool,self.state,c,self.cred,1000);self.assertEqual((out['delivered'],out['quarantined']),(1,1));self.assertEqual(A.deliver(self.spool,self.state,c,self.cred,1100)['attempted'],0);self.assertEqual(len(s.messages),1)
    def test_total_deadline_is_not_per_socket_timeout(self):
        self.queue()
        with server('smtp',self.certroot) as s:
            s.stall=True;c=self.config(s);c['deadline_seconds']=.2;start=time.monotonic()
            with self.assertRaises(A.Deadline):A.deliver(self.spool,self.state,c,self.cred,1000)
            self.assertLess(time.monotonic()-start,1);self.assertIn('TOTAL_DEADLINE',(self.state/'outbox.json').read_text())
    def test_crash_after_smtp_acceptance_is_at_least_once(self):
        self.queue()
        class SimulatedCrash(BaseException):pass
        def crash():raise SimulatedCrash()
        with server('smtp',self.certroot) as s:
            c=self.config(s)
            with self.assertRaises(SimulatedCrash):A.deliver(self.spool,self.state,c,self.cred,1000,after_accept=crash)
            self.assertEqual(A.deliver(self.spool,self.state,c,self.cred,1060)['delivered'],1);self.assertEqual(len(s.messages),2)
    def test_outbox_disk_full_does_not_send(self):
        self.queue()
        with server('smtp',self.certroot) as s,patch.object(A,'atomic',side_effect=OSError('FICTIONAL_DISK_FULL')):
            with self.assertRaises(OSError):A.deliver(self.spool,self.state,self.config(s),self.cred,1000)
            self.assertEqual(s.auth_count,0)
    def test_outbox_count_and_symlink_fail_closed(self):
        for mode in ['count','symlink']:
            with self.subTest(mode=mode):
                if mode=='count':private(self.state/'outbox.json',A.encode({'jobs':{str(i):{} for i in range(10001)}}))
                else:(self.state/'outbox.json').unlink();(self.state/'outbox.json').symlink_to(self.cred)
                with self.assertRaises(A.Refused):A.deliver(self.spool,self.state,dict(enabled=True,recipients=['ops@fixture.invalid'],spool_uid=os.getuid()),self.cred,1000)
    def test_isolated_egress_and_header_injection(self):
        with patch.object(A.socket,'getaddrinfo',return_value=[(2,1,6,'',('192.0.2.10',465))]):
            with self.assertRaises(A.Refused):A.endpoint('smtp.fixture.invalid',465,True)
        with self.assertRaises(A.Refused):A.address('ops@fixture.invalid\r\nBcc:attacker@fixture.invalid')
        with self.assertRaises(A.Refused):A.sanitize(self.event(check='SQLITE\r\n'))
    def test_heartbeat_https_signature_replay_and_stale(self):
        _,observation=self.health();A.atomic(self.spool/'observation.json',A.encode(observation),0o640)
        with server('https',self.certroot) as s:
            c=dict(self.config(s),path='/heartbeat');out=A.send_heartbeat(self.spool,self.state,c,self.hbcred,{'status':'PASS'},1000);self.assertEqual(out['health'],'PASS');self.assertEqual(s.received['health'],'PASS');self.assertEqual(A.send_heartbeat(self.spool,self.state,c,self.hbcred,{'status':'PASS'},1000)['status'],'SKIPPED')
            payload=A.heartbeat_payload(observation,{'status':'PASS'},1000);raw=A.encode(payload);sig=hmac.new(s.key,raw,hashlib.sha256).hexdigest()
            with self.assertRaises(A.Refused):A.accept_heartbeat(raw,'0'*64,s.key,{},1000)
            with self.assertRaises(A.Refused):A.accept_heartbeat(raw,sig,s.key,s.received,1000)
            with self.assertRaises(A.Refused):A.accept_heartbeat(raw,sig,s.key,{},1800)
    def test_blocked_storage_stale_monitor_and_failed_delivery_not_healthy(self):
        latest,observation=self.health(storage='BLOCKED');self.assertEqual(observation['status'],'DEGRADED');self.assertEqual(A.heartbeat_payload(observation,{'status':'PASS'},1000)['overall_status'],'DEGRADED')
        _,good=self.health();self.assertEqual(A.heartbeat_payload(good,{'status':'DEGRADED'},1000)['overall_status'],'DEGRADED')
        with self.assertRaises(A.Refused):A.heartbeat_observation(latest,'PASS',1500)
        forged=dict(observation,status='PASS')
        with self.assertRaises(A.Refused):A.heartbeat_payload(forged,{'status':'PASS'},1000)
        receipt=self.receipt();receipt['backup_utc']=A.stamp(0);receipt['verified_utc']=A.stamp(100000)
        self.assertEqual(A.storage_status(receipt,100000),'FAIL')
        with self.assertRaises(A.Refused):A.storage_status({'status':'PASS'},1000)
    def test_external_probe_outage_recovery_and_deadman_without_production(self):
        with server('https',self.certroot) as s:
            external=self.root/'independent-state';external.mkdir(mode=0o700);s.received_state=external;config=self.config(s);config['path']='/heartbeat'
            _,observation=self.health();A.atomic(self.spool/'observation.json',A.encode(observation),0o640)
            self.assertEqual(A.send_heartbeat(self.spool,self.state,config,self.hbcred,{'status':'PASS'},1000)['status'],'PASS');s.http_status=503
            for now in [1000,1060,1120]:out=A.external_check(config,external,self.spool,now)
            self.assertEqual(out['events'],2);self.assertEqual(len([p for p in self.spool.iterdir() if len(p.stem)==64]),2)
            s.http_status=200;A.external_check(config,external,self.spool,1180);out=A.external_check(config,external,self.spool,1240);self.assertEqual(out['events'],2)
            out=A.external_check(config,external,self.spool,1780);self.assertFalse(out['checks']['EXTERNAL_HEARTBEAT']);self.assertEqual(out['events'],1)
            _,observation=self.health(now=1800);A.atomic(self.spool/'observation.json',A.encode(observation),0o640);s.now=1800
            A.send_heartbeat(self.spool,self.state,config,self.hbcred,{'status':'PASS'},1800)
            A.external_check(config,external,self.spool,1840);out=A.external_check(config,external,self.spool,1900);self.assertTrue(out['checks']['EXTERNAL_HEARTBEAT']);self.assertEqual(out['events'],1)
    def test_external_probe_tls_redirect_json_body_bounds(self):
        with server('https',self.certroot) as s:
            config=self.config(s);s.http_status=302;self.assertFalse(A.external_check(config,self.state,self.spool,1000)['checks']['PUBLIC_HTTPS_HOME']);s.http_status=200;s.health_ok=False;self.assertFalse(A.external_check(config,self.state,self.spool,1060)['checks']['PUBLIC_HTTPS_HEALTH']);s.oversize=True;self.assertFalse(A.external_check(config,self.state,self.spool,1120)['checks']['PUBLIC_HTTPS_HOME'])
    def test_disabled_configuration_prevents_network(self):
        with patch.object(A,'smtp_send',side_effect=AssertionError('NETWORK_MUST_NOT_RUN')):
            with self.assertRaises(A.Refused):A.deliver(self.spool,self.state,{'enabled':False},self.cred,1000)
        self.assertEqual(A.send_heartbeat(self.spool,self.state,{'enabled':False},self.hbcred,{},1000)['status'],'NOT RUN')
if __name__=='__main__':unittest.main(verbosity=2)
