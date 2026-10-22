#!/usr/bin/env python3
"""Healthchecks contract through fictional loopback TLS only; no real account."""
import importlib.util,json,os,pathlib,ssl,tempfile,unittest
from unittest.mock import patch
P=pathlib.Path
spec=importlib.util.spec_from_file_location('loopback',P(__file__).with_name('test-alerts-isolated.py'));T=importlib.util.module_from_spec(spec);spec.loader.exec_module(T);A=T.A
TOKEN='/11111111-1111-4111-8111-111111111111'
class Provider(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.certs_tmp=tempfile.TemporaryDirectory();cls.certroot=P(cls.certs_tmp.name).resolve();T.certs(cls.certroot)
    @classmethod
    def tearDownClass(cls):cls.certs_tmp.cleanup()
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=P(self.tmp.name).resolve();self.spool=self.root/'spool';self.spool.mkdir(mode=0o750);self.spool.chmod(0o750);self.state=self.root/'state';self.state.mkdir(mode=0o700);self.cred=self.root/'heartbeat';T.private(self.cred,A.encode({'path':TOKEN}));self.observe()
    def tearDown(self):self.tmp.cleanup()
    def observe(self,now=1000,storage='PASS'):
        latest=dict(utc=A.stamp(now),status='PASS',checks={k:{'ok':True} for k in A.SOURCE_CHECKS})
        A.atomic(self.spool/'observation.json',A.encode(A.heartbeat_observation(latest,storage,now)),0o640)
    def config(self,s):
        s.provider_ping=True
        return dict(enabled=True,provider='healthchecks',isolated=True,host='localhost',port=s.server_address[1],ca_file=str(self.certroot/'ca.crt'),spool_uid=os.getuid(),deadline_seconds=5)
    def call(self,c,now=1000):return A.send_healthchecks_heartbeat(self.spool,self.state,c,self.cred,now)
    def test_success_and_restart_do_not_export_token_or_claim_inbox_delivery(self):
        with T.server('https',self.certroot) as s:
            c=self.config(s);out=self.call(c);self.assertEqual(out['status'],'PASS');self.assertFalse(out['mail_delivery_verified']);self.assertEqual(s.get_paths,[TOKEN]);self.assertEqual(self.call(c,1010)['status'],'SKIPPED');self.assertEqual(s.get_paths,[TOKEN])
            for p in self.state.iterdir():self.assertNotIn(TOKEN.encode(),p.read_bytes())
    def test_failure_is_not_success_and_recovery_requires_fresh_observation(self):
        with T.server('https',self.certroot) as s:
            c=self.config(s);self.call(c);self.observe(storage='FAIL');self.assertEqual(self.call(c)['status'],'DEGRADED');self.assertEqual(s.get_paths,[TOKEN,TOKEN+'/fail']);self.assertEqual(self.call(c,1010)['status'],'DEGRADED');self.assertEqual(len(s.get_paths),2)
            self.observe()
            with self.assertRaises(A.Refused):self.call(c,1010)
            self.observe(1300);self.assertEqual(self.call(c,1300)['status'],'PASS');self.assertEqual(s.get_paths[-1],TOKEN)
    def test_stale_future_and_invalid_source_never_ping(self):
        with patch.object(A,'https_exchange',side_effect=AssertionError('NO_NETWORK')):
            for now in [1600,500]:
                with self.assertRaises(A.Refused):self.call(dict(enabled=True,provider='healthchecks',isolated=True,host='localhost',port=443),now)
            A.atomic(self.spool/'observation.json',A.encode({'status':'PASS'}),0o640)
            with self.assertRaises(A.Refused):self.call(dict(enabled=True,provider='healthchecks',isolated=True,host='localhost',port=443))
    def test_accept_before_ack_disk_failure_never_replays_old_observation(self):
        with T.server('https',self.certroot) as s:
            c=self.config(s);real=A.atomic
            def fail(path,raw,*args,**kwargs):
                if path.name=='hosted-heartbeat-attempt.json' and A.decode(raw)['result']=='ACK':raise OSError('FICTIONAL_DISK_FULL')
                return real(path,raw,*args,**kwargs)
            with patch.object(A,'atomic',side_effect=fail):
                with self.assertRaises(OSError):self.call(c)
            self.assertEqual(self.call(c,1010)['status'],'DEGRADED');self.assertEqual(s.get_paths,[TOKEN]);self.observe(1300);self.assertEqual(self.call(c,1300)['status'],'PASS');self.assertEqual(len(s.get_paths),2)
    def test_bad_status_redirect_body_and_size_are_not_acknowledged(self):
        for code,body,oversize in [(302,b'OK',False),(429,b'OK',False),(500,b'OK',False),(200,b'{"accepted":true}',False),(200,b'OK',True)]:
            with self.subTest(code=code,oversize=oversize),T.server('https',self.certroot) as s:
                c=self.config(s);s.http_status=code;s.ping_body=body;s.oversize=oversize
                with self.assertRaises(A.Refused):self.call(c)
                self.assertEqual(A.decode((self.state/'hosted-heartbeat-attempt.json').read_bytes())['result'],'ATTEMPTED');(self.state/'hosted-heartbeat-attempt.json').unlink()
    def test_tls_untrusted_expired_and_hostname_fail_closed(self):
        for mode in ['untrusted','expired','hostname']:
            with self.subTest(mode=mode),T.server('https',self.certroot,expired=mode=='expired') as s:
                c=self.config(s)
                if mode=='untrusted':c.pop('ca_file')
                if mode=='hostname':c['host']='127.0.0.2'
                with patch.object(A,'endpoint',return_value='127.0.0.1'):
                    with self.assertRaises(ssl.SSLError):self.call(c)
                self.assertFalse(s.get_paths);(self.state/'hosted-heartbeat-attempt.json').unlink()
    def test_endpoint_and_secret_alias_permissions_and_shape_are_rejected(self):
        base=dict(enabled=True,provider='healthchecks',isolated=False,host='hc-ping.com',port=443)
        with patch.object(A,'https_exchange',side_effect=AssertionError('NO_NETWORK')):
            for bad in [dict(host='example.com'),dict(port=80),dict(isolated=True,host='example.com')]:
                with self.assertRaises(A.Refused):self.call(dict(base,**bad))
            for raw in [A.encode({'path':TOKEN+'?create=1'}),A.encode({'path':TOKEN+'/fail'}),A.encode({'url':'https://hc-ping.com'+TOKEN}),A.encode({'path':TOKEN,'extra':1})]:
                T.private(self.cred,raw)
                with self.assertRaises(A.Refused):self.call(base)
            T.private(self.cred,A.encode({'path':TOKEN}));self.cred.chmod(0o644)
            with self.assertRaises(A.Refused):self.call(base)
            self.cred.chmod(0o600);self.cred.rename(self.root/'original');self.cred.symlink_to(self.root/'original')
            with self.assertRaises(A.Refused):self.call(base)
    def test_disabled_configuration_never_reads_credential_or_network(self):
        with patch.object(A,'read_credential',side_effect=AssertionError('NO_SECRET_READ')),patch.object(A,'https_exchange',side_effect=AssertionError('NO_NETWORK')):
            with self.assertRaises(A.Refused):self.call(dict(enabled=False,provider='healthchecks',isolated=False))
    def test_total_deadline_preserves_attempt_and_no_old_retry(self):
        with T.server('https',self.certroot) as s:
            c=self.config(s);c['deadline_seconds']=.1;s.get_delay=1
            with self.assertRaises(A.Deadline):self.call(c)
            self.assertEqual(self.call(c,1010)['status'],'DEGRADED');self.assertEqual(len(s.get_paths),1)
    def test_token_rotation_and_observation_replay_need_explicit_reconciliation(self):
        with T.server('https',self.certroot) as s:
            c=self.config(s);self.call(c);self.observe(999)
            with self.assertRaises(A.Refused):self.call(c)
            self.observe(1300);T.private(self.cred,A.encode({'path':'/22222222-2222-4222-8222-222222222222'}))
            with self.assertRaises(A.Refused):self.call(c,1300)
            self.assertEqual(s.get_paths,[TOKEN])
    def test_writeahead_failure_blocks_transmission(self):
        with T.server('https',self.certroot) as s:
            c=self.config(s)
            with patch.object(A,'atomic',side_effect=OSError('FICTIONAL_DISK_FULL')):
                with self.assertRaises(OSError):self.call(c)
            self.assertFalse(s.get_paths)
if __name__=='__main__':unittest.main(verbosity=2)
