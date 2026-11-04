#!/usr/bin/env python3
"""Fictional local-only M01 acceptance; no production paths or recipients."""
import contextlib
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socketserver
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('monitoring_candidate', ROOT / 'ops/monitoring/nuaafa_monitoring.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def event(kind='INCIDENT_OPEN', since=100, epoch=110):
    result = dict(kind=kind, check='PUBLIC_HTTPS_HEALTH', since_epoch=since)
    result['detected_epoch' if kind == 'INCIDENT_OPEN' else 'recovered_epoch'] = epoch
    return result


class Receiver(socketserver.StreamRequestHandler):
    def finish(self):
        super().finish()
        self.request.close()

    def handle(self):
        try:
            self.request = self.server.context.wrap_socket(self.request, server_side=True)
            self.rfile, self.wfile = self.request.makefile('rb'), self.request.makefile('wb')
            self.wfile.write(b'220 localhost fictional SMTP\r\n'); self.wfile.flush()
            while True:
                line = self.rfile.readline(65536)
                if not line:
                    return
                command = line.decode('ascii').strip().upper()
                if command.startswith('EHLO'):
                    reply = b'250-localhost\r\n250 AUTH PLAIN\r\n'
                elif command.startswith('AUTH'):
                    reply = b'235 authenticated\r\n'
                elif command.startswith('RCPT') and self.server.failure == 'reject':
                    reply = b'451 temporary not accepted\r\n'
                elif command == 'DATA':
                    self.wfile.write(b'354 data\r\n'); self.wfile.flush()
                    data = b''
                    while True:
                        part = self.rfile.readline(65536)
                        if not part:
                            return
                        if part == b'.\r\n':
                            break
                        data += part
                    self.server.messages.append(data)
                    if self.server.failure == 'uncertain':
                        return
                    reply = b'250 accepted\r\n'
                elif command == 'QUIT':
                    self.wfile.write(b'221 bye\r\n'); self.wfile.flush(); return
                else:
                    reply = b'250 okay\r\n'
                self.wfile.write(reply); self.wfile.flush()
        except (ssl.SSLError, ConnectionError, BrokenPipeError):
            pass


class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tls_tmp = tempfile.TemporaryDirectory(prefix='NUAAFA-FICTIONAL-TLS-')
        base = Path(cls.tls_tmp.name).resolve()
        cls.cert, cls.key = base/'cert.pem', base/'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', str(cls.key), '-out', str(cls.cert)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    @classmethod
    def tearDownClass(cls):
        cls.tls_tmp.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='NUAAFA-FICTIONAL-M01-')
        self.root = Path(self.tmp.name).resolve(); os.chmod(self.root, 0o700)
        self.state = self.root/'state'; self.state.mkdir(mode=0o700)

    def tearDown(self):
        self.tmp.cleanup()

    @contextlib.contextmanager
    def receiver(self, failure=''):
        server = socketserver.ThreadingTCPServer(('127.0.0.1', 0), Receiver)
        server.daemon_threads = True; server.messages = []; server.failure = failure
        server.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server.context.load_cert_chain(self.cert, self.key)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            yield server
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def config(self, port, enabled=True):
        secret = self.root/'secret'; secret.write_text('FICTIONAL_ONLY_PASSWORD'); secret.chmod(0o600)
        config = self.root/'sender.json'
        config.write_text(json.dumps(dict(enabled=enabled, transport='smtp_tls', host='localhost', port=port, username='fictional', password_file=str(secret), **{'from':'fixture@invalid.example','to':['receiver@invalid.example']})))
        config.chmod(0o600)
        return config

    def transport(self, config):
        return m.SMTPTransport(config, ssl_context=ssl.create_default_context(cafile=str(self.cert)))

    def test_01_whitelist_redacts_and_deduplicates_persistently(self):
        secret = 'PRIVATE_STUDENT_SQL_TOKEN_AND_URL'
        value = dict(event(), message=secret, error=secret, url=secret, recipient=secret)
        with m.Outbox(self.state) as box:
            self.assertTrue(box.enqueue(value)); self.assertFalse(box.enqueue(value)); box.db.commit()
            self.assertIsNone(m.normalize_event(dict(value, check=secret)))
        with m.Outbox(self.state) as box:
            self.assertFalse(box.enqueue(value)); self.assertEqual(box.summary(), {'PENDING':1})
        for file in self.state.iterdir():
            self.assertNotIn(secret.encode(), file.read_bytes())

    def test_02_flapping_and_sustained_incident_once_then_linked_recovery(self):
        state = {}; events = []
        for index, okay in enumerate([False,True,False,False,False,False,True,False,True,True]):
            state, values = m.advance(state, {'HTTP_5XX_WINDOW':okay}, index * 300); events += values
        self.assertEqual([e['kind'] for e in events], ['INCIDENT_OPEN','INCIDENT_RECOVERY'])
        self.assertEqual(events[0]['since_epoch'], events[1]['since_epoch'])

    def test_03_real_tls_transport_and_recovery_order(self):
        with self.receiver() as server, m.Outbox(self.state) as box:
            config = self.config(server.server_address[1]); transport = self.transport(config)
            box.enqueue(event('INCIDENT_RECOVERY', epoch=200)); box.db.commit()
            self.assertEqual(box.dispatch(transport,300)['blocked'],1)
            box.enqueue(event()); box.db.commit()
            self.assertEqual(box.dispatch(transport,300,max_batch=2)['sent'],2)
            self.assertIn(b'INCIDENT_OPEN',server.messages[0]); self.assertIn(b'INCIDENT_RECOVERY',server.messages[1])
            self.assertEqual(box.dispatch(transport,400)['sent'],0)
            self.assertFalse(box.health(400)['receipt_proven'])

    def test_04_explicit_smtp_rejection_bounded_retry_and_terminal_failure(self):
        with self.receiver('reject') as server, m.Outbox(self.state) as box:
            transport=self.transport(self.config(server.server_address[1])); box.enqueue(event()); box.db.commit()
            self.assertEqual(box.dispatch(transport,100,max_attempts=2,retry_seconds=(30,))['retry'],1)
            self.assertEqual(box.dispatch(transport,129,max_attempts=2,retry_seconds=(30,))['sent'],0)
            self.assertEqual(box.dispatch(transport,130,max_attempts=2,retry_seconds=(30,))['failed'],1)
            self.assertEqual(box.dispatch(transport,999,max_attempts=2,retry_seconds=(30,))['failed'],0)
            self.assertFalse(box.health(999)['ok']); self.assertEqual(server.messages,[])

    def test_05_real_smtp_uncertain_acceptance_never_blind_retries(self):
        with self.receiver('uncertain') as server, m.Outbox(self.state) as box:
            transport=self.transport(self.config(server.server_address[1])); box.enqueue(event()); box.db.commit()
            self.assertEqual(box.dispatch(transport,100)['unknown'],1)
            self.assertEqual(box.dispatch(transport,999)['sent'],0)
            self.assertEqual(len(server.messages),1)
            self.assertEqual(box.summary(),{'UNKNOWN_DELIVERY':1})

    def test_06_crashed_sending_is_quarantined_on_restart(self):
        with m.Outbox(self.state) as box:
            box.enqueue(event()); box.db.execute("UPDATE events SET status='SENDING'"); box.db.commit()
        with m.Outbox(self.state) as box:
            self.assertEqual(box.summary(),{'UNKNOWN_DELIVERY':1})
            self.assertFalse(box.health(500)['ok'])

    def test_07_private_config_secret_and_state_permissions_and_symlinks(self):
        config=self.config(465,enabled=False)
        with self.assertRaises(m.SafeError): m.SMTPTransport(config)
        config=self.config(465); config.chmod(0o644)
        with self.assertRaises(m.SafeError): m.SMTPTransport(config)
        config.chmod(0o600); (self.root/'secret').chmod(0o640)
        with self.assertRaises(m.SafeError): m.SMTPTransport(config)
        link=self.root/'linked'; link.symlink_to(self.state,target_is_directory=True)
        with self.assertRaises(m.SafeError): m.Outbox(link)
        self.state.chmod(0o750)
        with self.assertRaises(m.SafeError): m.Outbox(self.state)

    def test_08_database_and_lock_cannot_be_linked_or_concurrent(self):
        with m.Outbox(self.state):
            with self.assertRaises(BlockingIOError): m.Outbox(self.state)
        db=self.state/'outbox.sqlite'; db.chmod(0o644)
        with self.assertRaises(m.SafeError): m.Outbox(self.state)
        db.chmod(0o600); db.rename(self.state/'old'); db.symlink_to(self.state/'old')
        with self.assertRaises(m.SafeError): m.Outbox(self.state)

    def test_09_disabled_cli_never_networks_and_does_not_leak_config(self):
        config=self.config(465,enabled=False)
        result=subprocess.run(['python3',str(ROOT/'ops/monitoring/nuaafa_monitoring.py'),'--state-dir',str(self.state),'send','--config',str(config)],capture_output=True,text=True)
        self.assertEqual(result.returncode,1); self.assertIn('TRANSPORT_DISABLED',result.stdout)
        self.assertNotIn('receiver@',result.stdout+result.stderr); self.assertNotIn('PASSWORD',result.stdout+result.stderr)

    def test_10_tls_certificate_verification_is_mandatory(self):
        with self.receiver() as server:
            config=self.config(server.server_address[1]); transport=m.SMTPTransport(config)
            with self.assertRaises(m.RetryableTransport): transport.send('a'*64,event())
            with self.assertRaises(m.SafeError): m.SMTPTransport(config,ssl_context=ssl._create_unverified_context())

    def test_11_ingest_transaction_and_partial_lines_original_unchanged(self):
        log=self.root/'events.jsonl'; log.write_bytes(b'')
        with m.Outbox(self.state) as box:
            box.ingest(log)
            complete=json.dumps(dict(event(),secret='DO_NOT_SAVE')).encode()+b'\n'
            log.write_bytes(complete+json.dumps(event('INCIDENT_RECOVERY',epoch=200)).encode())
            before=log.read_bytes(); self.assertEqual(box.ingest(log)['inserted'],1); self.assertEqual(log.read_bytes(),before)
            with log.open('ab') as stream: stream.write(b'\n')
            self.assertEqual(box.ingest(log)['inserted'],1); self.assertEqual(box.ingest(log)['inserted'],0)
            self.assertNotIn('DO_NOT_SAVE', (self.state/'outbox.sqlite').read_bytes().decode(errors='ignore'))

    def access_line(self,status,epoch=1000):
        timestamp=dt.datetime.fromtimestamp(epoch,dt.timezone.utc).strftime('%d/%b/%Y:%H:%M:%S %z')
        return f'192.0.2.1 - - [{timestamp}] "GET /private?token=SHOULD_NOT_SAVE HTTP/1.1" {status} 123 "-" "Private-Agent"'.encode()

    def test_12_access_only_5xx_window_and_no_raw_storage(self):
        lines=[self.access_line(s) for s in [200,400,401,403,404,500,502,503]]
        buckets,result=m.aggregate(lines,{},1100,'access')
        self.assertEqual(result['requests'],8); self.assertEqual(result['server_errors'],3)
        self.assertEqual(result['server_error_ratio'],3/8)
        self.assertNotIn('private',json.dumps(buckets)); self.assertNotIn('SHOULD_NOT_SAVE',json.dumps(result))
        _,expired=m.aggregate([],buckets,2100,'access'); self.assertEqual(expired['requests'],0)

    def test_13_database_categories_exclude_normal_http_statuses(self):
        lines=[b'HTTP 400 401 403 404 not found', b'[public-read] unavailable { operation: secret, category: ReadError }', b'PrismaClientInitializationError secret SQL', b'PrismaClientKnownRequestError secret SQL', b'SQLITE_BUSY database is locked', b'SQLITE_LOCKED']
        buckets,total=m.aggregate(lines,{},1000,'application')
        self.assertEqual(total['PUBLIC_READ_UNAVAILABLE'],1); self.assertEqual(total['PRISMA_INITIALIZATION'],1)
        self.assertEqual(total['PRISMA_QUERY'],1); self.assertEqual(total['SQLITE_BUSY_LOCKED'],2)
        self.assertNotIn('secret',json.dumps(buckets))

    def test_14_log_rename_rotation_drains_old_then_new_once(self):
        log=self.root/'access.log'; log.write_bytes(b'old\n')
        lines,state=m.tail_lines(log,None,initial_skip=False); self.assertEqual(lines,[b'old'])
        with log.open('ab') as stream: stream.write(b'tail\n')
        log.rename(self.root/'access.log.1'); log.write_bytes(b'new\n')
        lines,state=m.tail_lines(log,state); self.assertEqual(lines,[b'tail',b'new']); self.assertFalse(state['coverage_gap'])
        lines,state=m.tail_lines(log,state); self.assertEqual(lines,[])

    def test_15_log_copytruncate_missing_rotation_and_huge_line_fail_closed(self):
        log=self.root/'access.log'; log.write_bytes(b'old\n')
        _,state=m.tail_lines(log,None,initial_skip=False)
        log.write_bytes(b'a-new-record\n')
        lines,state=m.tail_lines(log,state); self.assertEqual(lines,[b'a-new-record']); self.assertTrue(state['coverage_gap'])
        log.rename(self.root/'unavailable-rotation'); log.write_bytes(b'next\n')
        _,state=m.tail_lines(log,state); self.assertTrue(state['coverage_gap'])
        log.write_bytes(b'x'*(m.MAX_LINE+1))
        with self.assertRaises(m.SafeError): m.tail_lines(log,None,initial_skip=False)

    def test_16_real_collection_new_metrics_trigger_incidents_and_privacy(self):
        access=self.root/'access'; app=self.root/'application'; access.write_bytes(b'');app.write_bytes(b'')
        with m.Outbox(self.state) as box:
            m.collect_logs(box,access,app,1000,1,1,.1)
            access.write_bytes(self.access_line(503)+b'\n'); app.write_bytes(b'[public-read] unavailable secret Personal Name SQL token\n')
            for epoch in [1000,1100,1200]: result=m.collect_logs(box,access,app,epoch,1,1,.1)
            self.assertEqual(box.summary(),{'PENDING':2}); self.assertEqual(result['events'],2)
            self.assertFalse(result['checks']['HTTP_5XX_WINDOW']); self.assertFalse(result['checks']['APPLICATION_DATABASE_ERRORS'])
            for epoch in [2300,2400]: result=m.collect_logs(box,access,app,epoch,1,1,.1)
            self.assertEqual(box.summary(),{'PENDING':4})
            raw=(self.state/'outbox.sqlite').read_bytes()
            for secret in [b'Personal Name',b'token',b'192.0.2.1',b'SHOULD_NOT_SAVE']: self.assertNotIn(secret,raw)

    def test_17_sender_fault_does_not_change_original_events_or_business_fixture(self):
        original=self.root/'original'; original.write_bytes(b'fictional immutable business fixture')
        class Broken:
            def send(self,*args): raise RuntimeError('SENSITIVE_PATH_PASSWORD_DO_NOT_LOG')
        before=hashlib.sha256(original.read_bytes()).hexdigest()
        with m.Outbox(self.state) as box:
            box.enqueue(event());box.db.commit();self.assertEqual(box.dispatch(Broken(),100)['unknown'],1)
            self.assertNotIn('SENSITIVE_PATH', (self.state/'outbox.sqlite').read_bytes().decode(errors='ignore'))
        self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(),before)

    def test_18_bootstrap_active_original_monitor_state_once_without_raw_details(self):
        latest=self.root/'latest.json'
        latest.write_text(json.dumps({'state':{'SQLITE':{'alerted':True,'since':100},'MEMORY':{'alerted':False,'since':90}},'details':{'private':'SECRET_DO_NOT_COPY'}}))
        with m.Outbox(self.state) as box:
            self.assertEqual(box.bootstrap_current(latest,200)['active_incidents_inserted'],1)
            self.assertEqual(box.bootstrap_current(latest,300)['active_incidents_inserted'],0)
            self.assertNotIn('SECRET_DO_NOT_COPY',(self.state/'outbox.sqlite').read_bytes().decode(errors='ignore'))

    def test_19_journal_real_subprocess_unit_cursor_and_aggregate_only(self):
        fixture=self.root/'journal.py'
        records=[{'__CURSOR':'s=fictional;i=1','__REALTIME_TIMESTAMP':'1000000000','MESSAGE':'PrismaClientInitializationError SECRET_PRIVATE_SQL'}]
        fixture.write_text('import json,sys\nassert "--unit=nuaafa.service" in sys.argv\nassert "--no-tail" in sys.argv\nprint('+repr(json.dumps(records[0]))+') if not any(x.startswith("--after-cursor=") for x in sys.argv) else None\n')
        access=self.root/'access';access.write_bytes(b'')
        with m.Outbox(self.state) as box:
            result=m.collect_logs(box,access,None,1100,1,1,.1,journal_command=[sys.executable,str(fixture)])
            self.assertEqual(result['aggregates']['application']['PRISMA_INITIALIZATION'],1)
            result=m.collect_logs(box,access,None,1200,1,1,.1,journal_command=[sys.executable,str(fixture)])
            self.assertEqual(result['aggregates']['application']['PRISMA_INITIALIZATION'],1)
            self.assertNotIn('SECRET_PRIVATE_SQL',(self.state/'outbox.sqlite').read_bytes().decode(errors='ignore'))

    def test_20_journal_failure_does_not_commit_cursor_or_events(self):
        fixture=self.root/'journal.py';fixture.write_text('import sys\nprint("PRIVATE_RAW_MESSAGE")\nsys.exit(1)\n')
        access=self.root/'access';access.write_bytes(b'')
        with m.Outbox(self.state) as box:
            with self.assertRaises(m.SafeError): m.collect_logs(box,access,None,1100,1,1,.1,journal_command=[sys.executable,str(fixture)])
            self.assertIsNone(box.metadata('log-application'))
            self.assertEqual(box.summary(),{})
            self.assertNotIn(b'PRIVATE_RAW_MESSAGE',(self.state/'outbox.sqlite').read_bytes())

    def test_21_many_blocked_recoveries_cannot_starve_later_incident(self):
        class Accept:
            def __init__(self): self.ids=[]
            def send(self,event_id,payload): self.ids.append(event_id)
        transport=Accept()
        with m.Outbox(self.state) as box:
            for index in range(30): box.enqueue(event('INCIDENT_RECOVERY',since=index,epoch=100))
            box.enqueue(event(since=1000,epoch=1100));box.db.commit()
            result=box.dispatch(transport,1200,max_batch=20)
            self.assertEqual(result['sent'],1);self.assertEqual(result['blocked'],30)
            self.assertEqual(box.dispatch(transport,1300,max_batch=20)['sent'],0)

    def test_22_numeric_time_representation_does_not_change_event_id(self):
        self.assertEqual(m.normalize_event(event(since=100))[0],m.normalize_event(event(since=100.0))[0])

    def test_23_normal_cli_budget_is_one_message_per_cycle(self):
        class Accept:
            def send(self,*args): pass
        with m.Outbox(self.state) as box:
            box.enqueue(event());box.enqueue(event(since=200,epoch=210));box.db.commit()
            self.assertEqual(box.dispatch(Accept(),300)['sent'],1)
            self.assertEqual(box.dispatch(Accept(),400)['sent'],1)

    def test_24_bridge_bootstrap_continuous_events_tls_retry_and_recovery(self):
        collector=self.state;sender=self.root/'sender';sender.mkdir(mode=0o700)
        handoff=self.root/'handoff';handoff.mkdir(mode=0o750)
        events=self.root/'original-events';events.write_bytes(b'')
        latest=self.root/'original-latest';latest.write_text(json.dumps({'state':{'SQLITE':{'alerted':True,'since':100}},'details':{'secret':'DO_NOT_COPY'}}))
        access=self.root/'access';app=self.root/'application';access.write_bytes(b'');app.write_bytes(b'')
        with self.receiver('reject') as receiver,m.Outbox(collector) as bridge,m.Outbox(sender) as box:
            m.bridge_cycle(bridge,events,latest,access,app,handoff,1000,1,1,.1,8192)
            self.assertEqual(box.ingest(handoff/'events.jsonl',from_start=True)['inserted'],1)
            self.assertEqual(box.bootstrap_current(handoff/'latest.json',1000)['active_incidents_inserted'],0)
            transport=self.transport(self.config(receiver.server_address[1]))
            self.assertEqual(box.dispatch(transport,1000)['retry'],1)
            with events.open('a')as stream:stream.write(json.dumps(dict(kind='INCIDENT_RECOVERY',check='SQLITE',since_epoch=100,recovered_epoch=1200,private='DO_NOT_COPY'))+'\n')
            latest.write_text('{"state":{}}')
            m.bridge_cycle(bridge,events,latest,access,app,handoff,1200,1,1,.1,8192)
            self.assertEqual(box.ingest(handoff/'events.jsonl',from_start=True)['inserted'],1)
            receiver.failure=''
            self.assertEqual(box.dispatch(transport,1029)['sent'],0)
            self.assertEqual(box.dispatch(transport,1030)['sent'],1)
            self.assertEqual(box.dispatch(transport,1200)['sent'],1)
            self.assertEqual(box.dispatch(transport,1300)['sent'],0)
            self.assertEqual(len(receiver.messages),2)
            self.assertIn(b'INCIDENT_OPEN',receiver.messages[0]);self.assertIn(b'INCIDENT_RECOVERY',receiver.messages[1])
        for file in handoff.iterdir():self.assertNotIn(b'DO_NOT_COPY',file.read_bytes())
        self.assertEqual((handoff/'events.jsonl').stat().st_mode&0o777,0o640)

    def test_25_handoff_crash_after_fsync_and_truncation_replays_without_loss(self):
        handoff=self.root/'handoff';handoff.mkdir(mode=0o750)
        sender=self.root/'sender';sender.mkdir(mode=0o700)
        def crash():raise RuntimeError('FICTIONAL_CRASH_AFTER_FSYNC')
        with m.Outbox(self.state)as bridge:
            bridge.enqueue(event());bridge.db.commit()
            with self.assertRaises(RuntimeError):m.export_handoff(bridge,handoff,8192,{},after_fsync=crash)
        with m.Outbox(self.state)as bridge,m.Outbox(sender)as box:
            m.export_handoff(bridge,handoff,8192,{})
            self.assertEqual(box.ingest(handoff/'events.jsonl',from_start=True)['inserted'],1)
            bridge.enqueue(event('INCIDENT_RECOVERY',epoch=200));bridge.db.commit()
            m.export_handoff(bridge,handoff,8192,{})
            (handoff/'events.jsonl').write_bytes(b'')
            result=m.export_handoff(bridge,handoff,8192,{})
            self.assertEqual(result['mode'],'REBUILT_FROM_DURABLE_EVENTS')
            self.assertEqual(box.ingest(handoff/'events.jsonl',from_start=True)['inserted'],1)
            self.assertEqual(box.summary(),{'PENDING':2})

    def test_26_handoff_budget_failure_preserves_queued_events_and_existing_file(self):
        handoff=self.root/'handoff';handoff.mkdir(mode=0o750)
        with m.Outbox(self.state)as bridge:
            bridge.enqueue(event());bridge.db.commit();m.export_handoff(bridge,handoff,1024,{})
            original=(handoff/'events.jsonl').read_bytes()
            for i in range(20):bridge.enqueue(event(since=1000+i,epoch=2000))
            bridge.db.commit()
            with self.assertRaises(m.SafeError):m.export_handoff(bridge,handoff,1024,{})
            self.assertEqual((handoff/'events.jsonl').read_bytes(),original)
            self.assertEqual(bridge.summary()['PENDING'],20)

    def test_27_fixed_privileged_input_never_returns_raw_logs_or_paths(self):
        source=self.root/'source';source.mkdir();events=source/'events';events.write_bytes(b'')
        latest=source/'latest';latest.write_text(json.dumps({'utc':dt.datetime.fromtimestamp(1000,dt.timezone.utc).isoformat(),'state':{'SQLITE':{'alerted':True,'since':100}},'details':{'secret':'PRIVATE'}}))
        access=source/'access';access.write_bytes(b'')
        actual_path=m.Path
        fixed={'/var/lib/nuaafa-ops-monitor/events.jsonl':events,'/var/lib/nuaafa-ops-monitor/latest.json':latest,'/var/log/nginx/access.log':access}
        def path(value):return fixed.get(str(value),actual_path(value))
        with mock.patch.object(m,'Path',path):
            initial=m.read_fixed_input('monitor',None,1000)
            with events.open('a')as stream:stream.write(json.dumps(dict(event(),secret='PRIVATE_TOKEN_SQL_NAME'))+'\n')
            value=m.read_fixed_input('monitor',initial['cursor'],1100)
            self.assertEqual(len(value['events']),1);self.assertNotIn('PRIVATE',json.dumps(value))
            initial=m.read_fixed_input('access',None,1000)
            access.write_bytes(b'1000.123 503\n')
            value=m.read_fixed_input('access',initial['cursor'],1100)
            self.assertEqual(sum(v['server_errors']for v in value['buckets'].values()),1)
            self.assertNotIn('SHOULD_NOT_SAVE',json.dumps(value))

    def test_28_fixed_helper_forbids_arbitrary_paths_and_nonroot(self):
        helper=ROOT/'ops/monitoring/readonly-inputs.py'
        result=subprocess.run([sys.executable,'-I','-B',str(helper),'--source','monitor','--file','/etc/passwd'],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn('root:',result.stdout)

    def test_29_fixed_bridge_initial_active_and_new_recovery_handoff(self):
        handoff=self.root/'handoff';handoff.mkdir(mode=0o750)
        cursor={'identity':[1,1],'offset':0,'prefix':'a'*64,'prefix_len':0,'backlog_bytes':0,'coverage_gap':False}
        active=True
        def reader(source,old):
            if source=='monitor':return {'cursor':cursor,'events':([]if active else[dict(kind='INCIDENT_RECOVERY',check='SQLITE',since_epoch=100,recovered_epoch=1200)]),'active':({'SQLITE':{'alerted':True,'since':100}}if active else{}),'invalid':0}
            if source=='access':return {'cursor':cursor,'buckets':{},'malformed':0}
            return {'cursor':'s=fiction;i=1','buckets':{}}
        with m.Outbox(self.state)as bridge:
            m.fixed_bridge_cycle(bridge,handoff,1000,1,1,.1,8192,reader=reader)
            active=False
            m.fixed_bridge_cycle(bridge,handoff,1200,1,1,.1,8192,reader=reader)
            rows=[json.loads(x)for x in(handoff/'events.jsonl').read_text().splitlines()]
            self.assertEqual([x['kind']for x in rows],['INCIDENT_OPEN','INCIDENT_RECOVERY'])

    def test_30_optional_privacy_format_and_fixed_current_global_source(self):
        buckets,total=m.aggregate([b'1000.123 200',b'1000.456 503',b'1000.789 404',self.access_line(502),b'1000.123 503 private-token'],{},1100,'access_minimal')
        self.assertEqual(total['requests'],3);self.assertEqual(total['server_errors'],1);self.assertEqual(total['malformed_lines'],2)
        actual_path=m.Path
        global_log=self.root/'current-global';global_log.write_bytes(b'')
        def path(value):
            if str(value)=='/var/log/nginx/access.log':return global_log
            return actual_path(value)
        with mock.patch.object(m,'Path',path):
            initial=m.read_fixed_input('access',None,1000)
            global_log.write_bytes(self.access_line(503)+b'\n')
            result=m.read_fixed_input('access',initial['cursor'],1100)
            self.assertEqual(sum(x['server_errors']for x in result['buckets'].values()),1)

    def test_31_sender_detects_stale_empty_collector_and_sends_linked_recovery(self):
        handoff=self.root/'handoff';handoff.mkdir(mode=0o750)
        (handoff/'events.jsonl').write_bytes(b'')
        (handoff/'latest.json').write_text('{"state":{},"collected_epoch":1}')
        class Accept:
            def __init__(self):self.payloads=[]
            def send(self,event_id,payload):self.payloads.append(payload)
        transport=Accept()
        with m.Outbox(self.state)as box:
            for epoch in [1000,1300,1600]:value=m.consume_handoff(box,handoff,epoch,600)
            self.assertFalse(value['collector_input_ok']);self.assertEqual(box.summary(),{'PENDING':1})
            self.assertEqual(box.dispatch(transport,1600)['sent'],1)
            for epoch in [1900,2200]:
                (handoff/'latest.json').write_text(json.dumps({'state':{},'collected_epoch':epoch}))
                m.consume_handoff(box,handoff,epoch,600)
            self.assertEqual(box.dispatch(transport,2200)['sent'],1)
            self.assertEqual([p['kind']for p in transport.payloads],['INCIDENT_OPEN','INCIDENT_RECOVERY'])
            self.assertEqual(transport.payloads[0]['since_epoch'],transport.payloads[1]['since_epoch'])

    def test_32_missing_collector_cannot_prevent_sender_own_failure_event(self):
        missing=self.root/'never-created'
        with m.Outbox(self.state)as box:
            for epoch in [1000,1300,1600]:value=m.consume_handoff(box,missing,epoch,600)
            self.assertFalse(value['collector_input_ok']);self.assertEqual(value['health_events'],1)
            self.assertEqual(box.summary(),{'PENDING':1})

    def test_33_fifo_input_is_rejected_immediately(self):
        import time
        fifo=self.root/'fifo';os.mkfifo(fifo)
        started=time.monotonic()
        for operation in [lambda:m.read_file(fifo),lambda:m.read_prefix(fifo),lambda:m._read_chunk(fifo,[fifo.stat().st_dev,fifo.stat().st_ino],0,1024)]:
            with self.assertRaises(m.SafeError):operation()
        self.assertLess(time.monotonic()-started,.5)

    def test_34_original_monitor_stale_cannot_be_rewrapped_as_fresh(self):
        original=self.root/'original';original.mkdir()
        events=original/'events';events.write_bytes(b'')
        latest=original/'latest';latest.write_text('{"utc":"1970-01-01T00:00:01+00:00","state":{}}')
        actual_path=m.Path
        fixed={'/var/lib/nuaafa-ops-monitor/events.jsonl':events,'/var/lib/nuaafa-ops-monitor/latest.json':latest}
        def path(value):return fixed.get(str(value),actual_path(value))
        with mock.patch.object(m,'Path',path):
            with self.assertRaisesRegex(m.SafeError,'ORIGINAL_MONITOR_SOURCE_STALE'):m.read_fixed_input('monitor',None,2000)
            latest.write_text('{"state":{}}')
            with self.assertRaisesRegex(m.SafeError,'ORIGINAL_MONITOR_SOURCE_STALE'):m.read_fixed_input('monitor',None,2000)
            latest.write_text('{"utc":"1970-01-01T01:00:00+00:00","state":{}}')
            with self.assertRaisesRegex(m.SafeError,'ORIGINAL_MONITOR_SOURCE_STALE'):m.read_fixed_input('monitor',None,2000)

    def test_35_first_handoff_claim_never_overwrites_unknown_latest(self):
        handoff=self.root/'handoff';handoff.mkdir(mode=0o750)
        unknown=handoff/'latest.json';unknown.write_bytes(b'UNKNOWN_KEEP_ORIGINAL')
        with m.Outbox(self.state)as box:
            box.enqueue(event());box.db.commit()
            with self.assertRaisesRegex(m.SafeError,'UNRECOGNIZED_HANDOFF_NOT_OVERWRITTEN'):m.export_handoff(box,handoff,8192,{})
            self.assertEqual(unknown.read_bytes(),b'UNKNOWN_KEEP_ORIGINAL');self.assertFalse((handoff/'events.jsonl').exists())


if __name__=='__main__':
    unittest.main(verbosity=2)
