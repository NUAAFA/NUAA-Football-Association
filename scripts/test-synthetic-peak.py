#!/usr/bin/env python3
"""Bounded capacity measurements against the unchanged original repair archive.

Called only by the disposable native-systemd fixture. All rows, passwords,
sessions, source IPs and media belong to this invocation and are fictional.
"""
import base64, collections, concurrent.futures, hashlib, http.client, importlib.util
import json, math, os, pathlib, shutil, socket, sqlite3, subprocess, threading, time
P=pathlib.Path

def exercise(root, database, unit, output):
    assert os.getuid()==0 and os.environ.get('GITHUB_ACTIONS')=='true'
    assert root.name.startswith('nuaafa-') and database.is_relative_to(root)
    assert unit.startswith('nuaafa-rehearsal-')
    candidate='6db56b94c25ca3ce1376dabbda74714448decf53'
    assert (root/'current').resolve().name==candidate
    password='Synthetic-Peak-Only-Password-2026!'
    salt=b'SYNTHETIC-ONLY26'
    enc=lambda b:base64.urlsafe_b64encode(b).decode().rstrip('=')
    derived=hashlib.scrypt(password.encode(),salt=salt,n=16384,r=8,p=1,dklen=64)
    stored='scrypt$'+enc(salt)+'$'+enc(derived)
    with sqlite3.connect(database,timeout=10) as db:
        db.execute('PRAGMA foreign_keys=ON')
        db.executemany('INSERT INTO Referee (id,publicCode,name,studentId,status,passwordHash,mustChangePassword,publicDirectoryEnabled,updatedAt) VALUES (?,?,?,?,?,?,0,?,CURRENT_TIMESTAMP)',
            [('synthetic-peak-'+str(i),'SYNTHETIC-PEAK-'+str(i),'Fictional capacity account '+str(i),'SYNTHETIC-PEAK-'+str(i),'ACTIVE' if i<256 else 'ARCHIVED',stored if i<256 else None,1 if i<200 else 0) for i in range(50000)])
        db.execute("INSERT INTO AdminAccount (id,username,displayName,passwordHash,role,updatedAt) VALUES ('synthetic-peak-admin','synthetic-peak-admin','Fictional capacity administrator',?,'SUPER_ADMIN',CURRENT_TIMESTAMP)",(stored,))
        assert db.execute('PRAGMA integrity_check').fetchall()==[('ok',)] and not db.execute('PRAGMA foreign_key_check').fetchall()
        baseline=db.execute('SELECT COUNT(*) FROM Referee').fetchone()[0]
    nginx=shutil.which('nginx');assert nginx
    edge=root/'peak-edge';edge.mkdir(mode=0o755)
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    source=P(__file__).resolve().parents[1]
    zones=(source/'ops/security-transition/nginx-http.conf').read_text()
    locations=(source/'ops/security-transition/nginx-server.conf').read_text()
    config=edge/'nginx.conf'
    config.write_text('pid '+str(edge/'nginx.pid')+';\nerror_log '+str(edge/'error.log')+' warn;\nevents { worker_connections 1024; }\nhttp { access_log off; client_body_temp_path '+str(edge/'body')+'; '+zones+'\nserver { listen 127.0.0.1:'+str(port)+'; server_name synthetic.invalid; '+locations+'\nlocation / { proxy_pass http://127.0.0.1:3001; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-For $remote_addr; } } }\n')
    subprocess.run([nginx,'-p',str(edge)+'/', '-c',str(config),'-t'],check=True,capture_output=True)
    server=subprocess.Popen([nginx,'-p',str(edge)+'/', '-c',str(config),'-g','daemon off;'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    def props():
        raw=subprocess.check_output(['systemctl','show',unit,'--property=ActiveState,MainPID,ControlGroup,NRestarts,Result'],text=True)
        return dict(x.split('=',1) for x in raw.splitlines())
    state=props();group=P('/sys/fs/cgroup')/state['ControlGroup'].lstrip('/')
    def measure():
        value={n:(group/n).read_text().strip() for n in ('memory.current','memory.peak','memory.events','cpu.stat','cpu.max','pids.current','pids.max','memory.max','memory.high')}
        value['cpu_usage_usec']=int(dict(x.split() for x in value['cpu.stat'].splitlines())['usage_usec'])
        return value
    def request(path,body=None,address='127.0.0.1',cookie=None):
        started=time.monotonic();c=http.client.HTTPConnection('127.0.0.1',port,timeout=8,source_address=(address,0))
        try:
            headers={'Host':'synthetic.invalid'}
            if body is not None:headers.update({'Content-Type':'application/json','Origin':'https://nuaafa.cn'})
            if cookie:headers['Cookie']=cookie
            c.request('POST' if body is not None else 'GET',path,None if body is None else json.dumps(body).encode(),headers)
            response=c.getresponse();data=response.read(4*1024**2+1)
            assert len(data)<=4*1024**2
            return response.status,time.monotonic()-started,len(data),{**{k.lower():v for k,v in response.getheaders()},'set-cookie':[v for k,v in response.getheaders() if k.lower()=='set-cookie']}
        except (OSError,http.client.HTTPException,AssertionError):return 0,time.monotonic()-started,0,{}
        finally:c.close()
    def scheduled_request(path,scheduled):
        result=request(path)
        return result[0],time.monotonic()-scheduled,result[2],result[3]
    def percentile(values,p):
        values=sorted(values);return round(values[min(len(values)-1,math.ceil(p*len(values))-1)]*1000,2)
    results=[]
    report=dict(status='RUNNING',candidate=candidate,production_access=False,fictional_only=True,dataset=dict(referees=baseline,active_new_accounts=256,public_new_accounts=200),request_mix={'/':25,'/news':25,'/referees/directory':25,'/api/health':25},latency_includes_scheduler_queue=True,limits=measure(),planning_slo=dict(target_rps=25,p95_ms=2000,unexpected_errors=0),staircase=results)
    def save():
        (output/'peak-results.json').write_text(json.dumps(report,indent=2)+'\n')
    save()
    try:
        for _ in range(50):
            if request('/api/health')[0]==200:break
            time.sleep(.1)
        else:raise AssertionError('private fictional edge unavailable')
        paths=['/','/news','/referees/directory','/api/health']
        for path in paths:assert request(path)[0]==200,(path,'fixture warmup')
        for rate in (5,15,25,50,100,200,400):
            duration=20;count=rate*duration;start=time.monotonic();before=measure();futures=[]
            with concurrent.futures.ThreadPoolExecutor(max_workers=128) as pool:
                for i in range(count):
                    remaining=start+i/rate-time.monotonic()
                    if remaining>0:time.sleep(remaining)
                    futures.append(pool.submit(scheduled_request,paths[i%len(paths)],start+i/rate))
                samples=[f.result() for f in futures]
            elapsed=time.monotonic()-start;after=measure();latencies=[x[1] for x in samples]
            entry=dict(target_rps=rate,scheduled=count,duration_seconds=round(elapsed,3),completed_rps=round(count/elapsed,2),status_counts=dict(collections.Counter(str(x[0]) for x in samples)),p50_ms=percentile(latencies,.5),p95_ms=percentile(latencies,.95),p99_ms=percentile(latencies,.99),cpu_core_fraction=round((after['cpu_usage_usec']-before['cpu_usage_usec'])/1e6/elapsed,3),memory_peak_bytes=int(after['memory.peak']),max_outstanding_workers=128,unexpected_errors=sum(x[0]!=200 for x in samples))
            entry['within_planning_slo']=entry['p95_ms']<=2000 and entry['unexpected_errors']==0 and entry['completed_rps']>=rate*.95
            results.append(entry);save();print('capacity '+str(rate)+' rps '+json.dumps(entry),flush=True)
            time.sleep(1)
            if rate>=25 and not entry['within_planning_slo']:
                report['first_observed_over_slo_rps']=rate
                break
        # Real password hashing, quota writes and session issuance through the
        # exact proposed Nginx rules. The origin is a header only: no outbound
        # request to this name or to any production service is performed.
        good=request('/api/referees/login',{'studentId':'SYNTHETIC-PEAK-255','password':password},address='127.0.0.250')
        assert good[0]==200,'normal fictional login before burst'
        cookie=next((value.split(';',1)[0] for value in good[3].get('set-cookie',[]) if value.startswith('nuaa_referee_member=')),'')
        assert cookie.startswith('nuaa_referee_member=')
        assert request('/referees/workspace/account',cookie=cookie)[0]==200
        started=time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
            samples=list(pool.map(lambda i:request('/api/referees/login',{'studentId':'SYNTHETIC-PEAK-'+str(i%128),'password':password if i%2==0 else 'Fictional-wrong-password'},address='127.0.0.'+str(2+i%64)),range(160)))
        counts=dict(collections.Counter(str(x[0]) for x in samples))
        health=request('/api/health');profile=request('/referees/workspace/account',cookie=cookie)
        assert 429 in [x[0] for x in samples] and set(x[0] for x in samples)<={200,401,429}
        assert health[0]==profile[0]==200
        time.sleep(2)
        after_login=request('/api/referees/login',{'studentId':'SYNTHETIC-PEAK-254','password':password},address='127.0.0.251')
        assert after_login[0]==200,'normal login recovers after burst'
        report['login_burst']=dict(requests=160,parallel=64,source_addresses=64,status_counts=counts,seconds=round(time.monotonic()-started,3),health_status=health[0],health_ms=round(health[1]*1000,2),existing_session_profile_status=profile[0],post_burst_login=after_login[0],password_verification_and_session_writes=True,private_cookie_exported=False)
        report['limits_after']=measure();report['service_after']=props()
        with sqlite3.connect(database,timeout=10) as db:
            assert db.execute('PRAGMA integrity_check').fetchall()==[('ok',)] and not db.execute('PRAGMA foreign_key_check').fetchall()
            assert db.execute('SELECT COUNT(*) FROM Referee').fetchone()[0]==baseline
            report['sessions_created']=db.execute('SELECT COUNT(*) FROM RefereeSession').fetchone()[0]
            report['integrity_foreign_keys_records']='PASS'
        assert report['service_after']['NRestarts']=='0' and report['service_after']['MainPID']==state['MainPID']
        assert dict(x.split() for x in report['limits_after']['memory.events'].splitlines())['oom_kill']=='0'
        assert report['limits_after']['memory.max']=='1610612736' and report['limits_after']['pids.max']=='128'
        observed=[x['target_rps'] for x in results if x['within_planning_slo']]
        report['highest_observed_slo_rps']=max(observed,default=0)
        report['planning_slo_status']='PASS' if any(x['target_rps']==25 and x['within_planning_slo'] for x in results) else 'FAIL'
        report['status']='PASS' if report['planning_slo_status']=='PASS' else 'FAIL';save()
        assert report['status']=='PASS','planning capacity SLO not met; retain actual measurements'
        return report
    finally:
        if report['status']=='RUNNING':report['status']='FAIL';save()
        server.terminate();server.wait(timeout=10)

