import importlib.util,unittest,http.server,threading,tempfile,json,hashlib
from pathlib import Path
s=importlib.util.spec_from_file_location('monitor',Path(__file__).with_name('monitor.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class IncidentTests(unittest.TestCase):
    def test_single_restart_opens_once_and_recovers_after_two_stable_observations(self):
        prior=m.application_status({'ActiveState':'active','MainPID':'100','NRestarts':'0'});state={};events=[]
        for t,n,pid in [(0,1,101),(300,1,101),(600,1,101),(900,1,101)]:
            current=m.application_status({'ActiveState':'active','MainPID':str(pid),'NRestarts':str(n)})
            self.assertTrue(current['ok'])
            state,e=m.advance(state,{'APPLICATION_RESTARTS':m.application_restarts(current,prior)},t);events+=e;prior=current
        self.assertEqual([e['kind'] for e in events],['INCIDENT_OPEN','INCIDENT_RECOVERY'])
        self.assertEqual(events[0]['detected_epoch'],0);self.assertEqual(events[1]['duration_seconds'],600)
        self.assertEqual(events[1]['duration_basis'],'OBSERVED_RESTART_INSTABILITY_WINDOW')
    def test_pid_generation_change_without_restart_count_increase_opens_event(self):
        prior={'restart_count':0,'pid':100};current={'restart_count':0,'pid':101}
        result=m.application_restarts(current,prior);self.assertTrue(result['pid_changed'])
        state,events=m.advance({}, {'APPLICATION_RESTARTS':result},10)
        self.assertEqual(len(events),1);self.assertEqual(events[0]['check'],'APPLICATION_RESTARTS')
    def test_first_or_unchanged_process_observation_does_not_alert(self):
        current={'restart_count':7,'pid':101}
        for prior in [{},current]:
            state,events=m.advance({}, {'APPLICATION_RESTARTS':m.application_restarts(current,prior)},10)
            self.assertEqual(events,[])
    def test_brief_recovery_does_not_reset_open_incident_start(self):
        state={};events=[]
        for t,ok in [(0,False),(300,False),(600,False),(900,True),(1200,False),(1500,True),(1800,True)]:
            state,e=m.advance(state,{'HTTPS':{'ok':ok}},t);events+=e
        self.assertEqual([e['kind'] for e in events],['INCIDENT_OPEN','INCIDENT_RECOVERY'])
        self.assertEqual(events[-1]['since_epoch'],0);self.assertEqual(events[-1]['duration_seconds'],1800)
    def test_real_backup_payload_corruption_detected(self):
        with tempfile.TemporaryDirectory(prefix='NUAAFA-FICTITIOUS-MONITOR-') as name:
            root=Path(name).resolve();p=root/'online-FICTITIOUS';p.mkdir();(p/'payload').write_bytes(b'FICTITIOUS_DATA')
            content=b'FICTITIOUS_DATA';manifest={'checksums':{'payload':{'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content)}}};raw=json.dumps(manifest).encode();(p/'manifest.json').write_bytes(raw)
            (p/'COMPLETED.json').write_text(json.dumps({'manifest_sha256':hashlib.sha256(raw).hexdigest()}));(root/'last-success.json').write_text(json.dumps({'path':str(p)}))
            self.assertTrue(m.check_backup_files(root)['ok']);(p/'payload').write_bytes(b'FICTITIOUS_CORRUPTION');self.assertFalse(m.check_backup_files(root)['ok'])
    def test_actual_http_health_request_without_application_process(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200);self.end_headers();self.wfile.write(b'{"status":"ok"}')
            def log_message(self,*args):pass
        server=http.server.HTTPServer(('127.0.0.1',0),Handler)
        t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
        try:self.assertTrue(m.check_http('127.0.0.1','/api/health',False,server.server_port)['ok'])
        finally:server.shutdown();server.server_close();t.join()
    def test_http_error_detection_drives_alert_and_recovery(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            response_status=503
            def do_GET(self):
                self.send_response(self.response_status);self.end_headers();self.wfile.write(b'{"status":"ok"}' if self.response_status==200 else b'{"status":"unavailable"}')
            def log_message(self,*args):pass
        server=http.server.HTTPServer(('127.0.0.1',0),Handler);t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
        try:
            state={};events=[]
            for i in range(3):
                result=m.check_http('127.0.0.1','/api/health',False,server.server_port);state,e=m.advance(state,{'HTTP_FIXTURE':result},i*300);events+=e
            self.assertEqual([e['kind'] for e in events],['INCIDENT_OPEN'])
            Handler.response_status=200
            for i in range(2):
                result=m.check_http('127.0.0.1','/api/health',False,server.server_port);state,e=m.advance(state,{'HTTP_FIXTURE':result},900+i*300);events+=e
            self.assertEqual([e['kind'] for e in events],['INCIDENT_OPEN','INCIDENT_RECOVERY'])
        finally:server.shutdown();server.server_close();t.join()
    def test_threshold_dedup_and_recovery(self):
        state={};events=[]
        for t in [0,300]:
            state,e=m.advance(state,{'HTTPS':{'ok':False}},t);self.assertEqual(e,[])
        state,e=m.advance(state,{'HTTPS':{'ok':False}},600);self.assertEqual(e[0]['kind'],'INCIDENT_OPEN');events+=e
        for i in range(100):
            state,e=m.advance(state,{'HTTPS':{'ok':False}},900+i*300);self.assertEqual(e,[])
        state,e=m.advance(state,{'HTTPS':{'ok':True}},31000);self.assertEqual(e,[])
        state,e=m.advance(state,{'HTTPS':{'ok':True}},31300);self.assertEqual(e[0]['kind'],'INCIDENT_RECOVERY');self.assertEqual(e[0]['duration_seconds'],31300)
    def test_short_fluctuation_is_not_incident(self):
        state,e=m.advance({}, {'HTTP':{'ok':False}},1);state,e=m.advance(state,{'HTTP':{'ok':True}},2);self.assertEqual(e,[])
    def test_new_incident_after_recovery(self):
        state={};opened=0;recovered=0;events=[]
        for t,ok in enumerate([False]*3+[True]*2+[False]*3):
            state,e=m.advance(state,{'BACKUP_FAILURE':{'ok':ok}},t*300);opened+=sum(x['kind']=='INCIDENT_OPEN' for x in e);recovered+=sum(x['kind']=='INCIDENT_RECOVERY' for x in e);events+=e
        self.assertEqual((opened,recovered),(2,1))
        self.assertEqual([x['since_epoch'] for x in events if x['kind']=='INCIDENT_OPEN'],[0,1500])
    def test_backup_failure_generates_named_alarm(self):
        state={};e=[]
        for t in [0,300,600]:state,e=m.advance(state,{'BACKUP_FRESHNESS_AND_FAILURE':{'ok':False}},t)
        self.assertEqual(e[0]['check'],'BACKUP_FRESHNESS_AND_FAILURE')
    def test_certificate_expiry_boundaries(self):
        self.assertFalse(m.certificate(-1));self.assertFalse(m.certificate(0));self.assertFalse(m.certificate(21));self.assertTrue(m.certificate(21.01))
if __name__=='__main__':unittest.main(verbosity=2)
