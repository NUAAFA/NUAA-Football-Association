#!/usr/bin/env python3
"""Run actual Nginx with loopback-only fictional upstream and private prefix."""
import concurrent.futures, http.client, http.server, json, os
from pathlib import Path
import shutil, socket, subprocess, tempfile, threading, time
def main():
    source=Path(__file__).resolve().parents[1];output=Path(os.environ['RUNNER_TEMP'])/'backout-output'
    nginx=shutil.which('nginx');assert nginx
    with tempfile.TemporaryDirectory(prefix='nuaafa-edge-',dir=os.environ['RUNNER_TEMP']) as folder:
        root=Path(folder);root.chmod(0o755)
        maintenance=root/'web-maintenance.flag';upstream_requests=[]
        class Upstream(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers.get('Content-Length','0')))
                upstream_requests.append(self.path)
                payload=json.dumps(dict(real=self.headers.get('X-Real-IP'),forwarded=self.headers.get('X-Forwarded-For'),proto=self.headers.get('X-Forwarded-Proto'))).encode()
                self.send_response(200);self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
            do_GET=do_POST
            def log_message(self,*args):pass
        backend=http.server.ThreadingHTTPServer(('127.0.0.1',0),Upstream)
        thread=threading.Thread(target=backend.serve_forever,daemon=True);thread.start()
        with socket.socket() as probe:probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
        snippet=(source/'ops/security-transition/nginx-server.conf').read_text().replace('127.0.0.1:3001','127.0.0.1:'+str(backend.server_port)).replace('/etc/nuaafa-b0-web-maintenance.flag',str(maintenance))
        zone=(source/'ops/security-transition/nginx-http.conf').read_text()
        config=root/'nginx.conf';config.write_text('pid '+str(root/'nginx.pid')+';\nerror_log '+str(root/'error.log')+' notice;\nevents {}\nhttp { access_log off; client_body_temp_path '+str(root/'body')+'; '+zone+'\nserver { listen 127.0.0.1:'+str(port)+'; server_name synthetic.invalid; client_max_body_size 25m; '+snippet+'\nlocation = /__fictional_vpn { return 204; }\nlocation / { if (-f '+str(maintenance)+') { return 503; } proxy_pass http://127.0.0.1:'+str(backend.server_port)+'; } } }\n')
        subprocess.run([nginx,'-p',str(root)+'/', '-c',str(config),'-t'],check=True,capture_output=True)
        process=subprocess.Popen([nginx,'-p',str(root)+'/', '-c',str(config),'-g','daemon off;'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        def request(path='/api/referees/login',body=b'{}',address='127.0.0.1',spoof=False):
            c=http.client.HTTPConnection('127.0.0.1',port,timeout=5,source_address=(address,0))
            try:
                c.request('POST',path,body,headers={'Content-Type':'application/json',**({'X-Forwarded-For':'203.0.113.77','X-Real-IP':'203.0.113.88'} if spoof else {})});r=c.getresponse();return r.status,r.read()
            finally:c.close()
        try:
            for i in range(50):
                try:assert request('/api/health')[0]==200;break
                except (OSError,AssertionError):time.sleep(.1)
            else:raise AssertionError('private nginx failed to start')
            for path in ['/api/referees/login','/api/referees/admin/login','/api/referees/account/password','/api/referees/admin/account/password','/api/referees/admission-applications']:
                status,data=request(path,spoof=True);assert status==200
                assert json.loads(data)==dict(real='127.0.0.1',forwarded='127.0.0.1',proto='http')
            assert request(body=b'x'*16385,address='127.0.0.2')[0]==413
            assert request('/api/referees/admin/admission-applications',b'x'*17000)[0]==200
            assert request('/api/health')[0]==200
            protected=['/api/referees/login','/api/referees/admin/login','/api/referees/account/password','/api/referees/admin/account/password','/api/referees/admission-applications']
            before=len(upstream_requests);maintenance.write_text('fictional maintenance only\n')
            for path in protected+['/api/health','/api/referees/login?next=synthetic']:
                assert request(path)[0]==503,('MAINTENANCE_BYPASS',path)
            assert request('/__fictional_vpn')[0]==204
            assert len(upstream_requests)==before,'maintenance request reached fictional upstream'
            maintenance.unlink()
            for path in protected:assert request(path)[0]==200
            assert request('/api/health')[0]==200
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:statuses=list(pool.map(lambda _:request()[0],range(60)))
            assert 429 in statuses and 200 in statuses and set(statuses)<={200,429},statuses
            assert request('/api/health')[0]==200
            result=dict(status='PASS',nginx_version=subprocess.run([nginx,'-v'],capture_output=True,text=True).stderr.strip(),matched_routes=5,spoofed_forwarding_overwritten=True,oversize_status=413,burst_status_counts={str(v):statuses.count(v) for v in set(statuses)},health_unaffected=True,admin_admission_management_not_limited=True,production_access=False,maintenance_routes_blocked=7,maintenance_upstream_requests=0,vpn_route_preserved=True,post_maintenance_recovery=True)
            (output/'edge-results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
        finally:
            process.terminate();process.wait(timeout=10);backend.shutdown();backend.server_close()
if __name__=='__main__':main()
