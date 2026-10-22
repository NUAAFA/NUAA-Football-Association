#!/usr/bin/env python3
"""Bounded alert bridge, durable delivery, HTTPS probe and dead-man contract.

No application database access. Deployment configuration is disabled by default;
all tests use loopback TLS endpoints, fictional events and .invalid addresses.
"""
import argparse,base64,contextlib,datetime,email.message,email.policy,fcntl,hashlib,hmac,http.client,ipaddress,json,math,os,pathlib,re,signal,smtplib,socket,ssl,stat,sys,time,uuid
P=pathlib.Path
SOURCE_CHECKS={'PUBLIC_HTTPS_HOME','PUBLIC_HTTPS_HEALTH','LOCAL_APPLICATION_HEALTH','APPLICATION','APPLICATION_RESTARTS','VERSION','NGINX','NGINX_CONFIG','NGINX_ERROR_LOG','SQLITE','DISK_INODES','MEMORY','CPU','HTTPS_CERTIFICATE','CERTIFICATE_RENEWAL','BACKUP_FRESHNESS_AND_FAILURE','BACKUP_COMPLETION','ISOLATED_RESTORE_FRESHNESS',*['SCHEDULE_'+x for x in ['nuaafa-ops-backup.timer','nuaafa-ops-monitor.timer','nuaafa-ops-restore.timer','nuaafa-ops-nginx-log.timer']]}
CHECKS=SOURCE_CHECKS|{'EXTERNAL_HEARTBEAT','OFFSITE_STORAGE','ALERT_TRANSPORT'}
MAX_SOURCE=8*1024**2
MAX_STATE=20*1024**2
class Refused(Exception):pass
# BaseException deliberately avoids smtplib wrapping OSError into a retryable
# disconnect and thereby swallowing the process-wide deadline.
class Deadline(BaseException):pass
def need(ok,code='REJECTED_INPUT'):
    if not ok:raise Refused(code)
def encode(d):return (json.dumps(d,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def digest(b):return hashlib.sha256(b).hexdigest()
def pairs(items):
    out={}
    for k,v in items:need(k not in out,'DUPLICATE_KEY');out[k]=v
    return out
def bad_number(_):raise Refused('NONFINITE_NUMBER')
def decode(raw):return json.loads(raw,object_pairs_hook=pairs,parse_constant=bad_number)
def epoch(v):
    need(type(v) in (int,float) and math.isfinite(v) and 0<=v<4102444800,'BAD_EPOCH');return float(v)
def utc(v):
    need(isinstance(v,str) and len(v)<=40 and not any(ord(c)<32 for c in v),'BAD_TIMESTAMP')
    d=datetime.datetime.fromisoformat(v[:-1]+'+00:00' if v.endswith('Z') else v)
    need(d.utcoffset()==datetime.timedelta(0),'NOT_UTC');return d
def stamp(now):return datetime.datetime.fromtimestamp(now,datetime.timezone.utc).isoformat()
def sanitize(d,source_only=False):
    need(type(d) is dict and d.get('kind') in {'INCIDENT_OPEN','INCIDENT_RECOVERY','DAILY_HEALTH_SUMMARY'},'EVENT_KIND')
    out={'kind':d['kind'],'utc':utc(d['utc']).isoformat()}
    if d['kind']=='DAILY_HEALTH_SUMMARY':
        need(type(d.get('checks')) is int and d['checks']==22 and type(d.get('unhealthy')) is int and 0<=d['unhealthy']<=22,'SUMMARY_COUNTS');out.update(checks=22,unhealthy=d['unhealthy'])
    else:
        need(d.get('check') in (SOURCE_CHECKS if source_only else CHECKS),'CHECK_ID');out['check']=d['check'];out['since_epoch']=epoch(d['since_epoch'])
        need(d.get('duration_basis') in {'OBSERVED_RESTART_INSTABILITY_WINDOW','OBSERVED_CHECK_FAILURE_WINDOW'},'DURATION_KIND');out['duration_basis']=d['duration_basis']
        if d['kind']=='INCIDENT_OPEN':
            need(type(d.get('failures')) is int and 1<=d['failures']<=1000000,'FAILURE_COUNT');out.update(detected_epoch=epoch(d['detected_epoch']),failures=d['failures']);need(out['detected_epoch']>=out['since_epoch'])
        else:
            out.update(recovered_epoch=epoch(d['recovered_epoch']),duration_seconds=epoch(d['duration_seconds']));need(out['recovered_epoch']>=out['since_epoch'])
        out['incident_id']=digest(encode([out['check'],out['since_epoch']]))
    out['event_id']=digest(encode(out));need(len(encode(out))<=4096,'EVENT_SIZE');return out
def identity(s):return (s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def read_file(path,bound,uid=None,private=True):
    need(path.is_absolute() and path.resolve()==path,'PATH_ALIAS');s=path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and (uid is None or s.st_uid==uid),'FILE_IDENTITY')
    need(not stat.S_IMODE(s.st_mode)&(0o077 if private else 0o022),'FILE_PERMISSION');need(s.st_size<=bound,'FILE_BOUND')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        need(identity(os.fstat(fd))==identity(s),'FILE_RACE');chunks=[];left=s.st_size
        while left:
            b=os.read(fd,min(left,65536));need(b,'SHORT_READ');chunks.append(b);left-=len(b)
        need(identity(os.fstat(fd))==identity(s)==identity(path.lstat()),'FILE_CHANGED');return b''.join(chunks)
    finally:os.close(fd)
def directory(path,mode=0o700,uid=None):
    need(path.is_absolute() and path.resolve()==path,'DIRECTORY_ALIAS');s=path.lstat();need(stat.S_ISDIR(s.st_mode) and stat.S_IMODE(s.st_mode)==mode and s.st_uid==(os.getuid() if uid is None else uid),'DIRECTORY_PERMISSION')
def syncdir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
def atomic(path,data,mode=0o600,create_only=False):
    need(len(data)<=MAX_STATE,'STATE_BOUND')
    if os.path.lexists(path):
        need(not path.is_symlink() and path.is_file() and path.stat().st_nlink==1,'STATE_LINK')
        if create_only:need(read_file(path,MAX_STATE,private=mode==0o600)==data,'ID_COLLISION');return
    temp=path.parent/('.'+uuid.uuid4().hex+'.tmp');fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    try:
        with os.fdopen(fd,'wb') as f:os.fchmod(f.fileno(),mode);f.write(data);f.flush();os.fsync(f.fileno())
        if create_only:
            try:os.link(temp,path)
            except FileExistsError:need(read_file(path,MAX_STATE,private=mode==0o600)==data,'ID_COLLISION')
            temp.unlink()
        else:os.replace(temp,path)
        syncdir(path.parent)
    finally:
        if temp.exists():temp.unlink()
@contextlib.contextmanager
def locked(root,mode=0o700):
    directory(root,mode);fd=os.open(root/'.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        need(stat.S_ISREG(os.fstat(fd).st_mode) and os.fstat(fd).st_nlink==1,'LOCK_IDENTITY')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);yield
    finally:os.close(fd)
def load(path,default):return decode(read_file(path,MAX_STATE)) if os.path.lexists(path) else default
def heartbeat_observation(latest,storage,now):
    need(type(latest) is dict and set(latest.get('checks',{}))==SOURCE_CHECKS,'MONITOR_CHECK_SET')
    checks=latest['checks'];need(all(type(v) is dict and type(v.get('ok')) is bool for v in checks.values()),'MONITOR_FLAGS')
    observed=utc(latest['utc']).timestamp();need(-120<=now-observed<=420,'STALE_OBSERVATION')
    unhealthy=sum(not x['ok'] for x in checks.values());need(latest.get('status')==('DEGRADED' if unhealthy else 'PASS'),'MONITOR_STATUS_MISMATCH')
    need(storage in {'PASS','FAIL','BLOCKED','UNKNOWN'},'STORAGE_STATUS')
    return dict(site='NUAAFA',observed_epoch=observed,status='PASS' if not unhealthy and storage=='PASS' else 'DEGRADED',unhealthy=unhealthy,version_ok=checks['VERSION']['ok'],storage=storage)
def storage_status(receipt,now):
    need(type(receipt) is dict and set(receipt)=={'status','backup_id','backup_utc','verified_utc'},'STORAGE_RECEIPT_SHAPE')
    need(receipt['status'] in {'PASS','FAIL','BLOCKED','UNKNOWN'} and isinstance(receipt['backup_id'],str) and re.fullmatch(r'\d{8}T\d{6}Z-[a-f0-9]{12}',receipt['backup_id']),'STORAGE_RECEIPT_FIELDS')
    ages=[now-utc(receipt[k]).timestamp() for k in ('backup_utc','verified_utc')]
    return receipt['status'] if all(-120<=age<=27*3600 for age in ages) else 'FAIL'
def bridge(events,latest,storage_file,output,source_uid,now=None):
    now=time.time() if now is None else now
    with locked(output,0o750):
        raw=read_file(events,MAX_SOURCE,source_uid);s=events.stat();cursor=load(output/'cursor.json',{'offset':0,'prefix_sha256':digest(b''),'device':s.st_dev,'inode':s.st_ino})
        need((cursor['device'],cursor['inode'])==(s.st_dev,s.st_ino),'SOURCE_ROTATED');off=cursor['offset'];need(type(off) is int and 0<=off<=len(raw) and digest(raw[:off])==cursor['prefix_sha256'],'SOURCE_TRUNCATED_OR_REWRITTEN')
        end=min(len(raw),off+1024*1024);count=0;start=off
        while off<end and count<200:
            newline=raw.find(b'\n',off,end)
            if newline<0:need(end-off<=8192,'EVENT_LINE_BOUND');break
            line=raw[off:newline];need(0<len(line)<=8192,'EVENT_LINE_BOUND');d=decode(line)
            if d.get('kind')=='MONITOR_SKIPPED_APPROVED_MAINTENANCE':utc(d['utc'])
            else:
                event=sanitize(d,source_only=True);atomic(output/(event['event_id']+'.json'),encode(event),0o640,True)
            off=newline+1;count+=1
        # Read heartbeat before advancing cursor. Failure preserves replayable events.
        latest_value=decode(read_file(latest,MAX_SOURCE,source_uid));storage=decode(read_file(storage_file,8192,os.getuid()))
        observation=heartbeat_observation(latest_value,storage_status(storage,now),now)
        atomic(output/'observation.json',encode(observation),0o640)
        atomic(output/'cursor.json',encode(dict(offset=off,prefix_sha256=digest(raw[:off]),device=s.st_dev,inode=s.st_ino)))
        return dict(status='PASS',events_processed=count,source_bytes_advanced=off-start,observation_status=observation['status'])
@contextlib.contextmanager
def deadline(seconds):
    need(0<seconds<=25,'DEADLINE_RANGE')
    old=signal.getsignal(signal.SIGALRM)
    def expired(*_):raise Deadline('TRANSPORT_DEADLINE')
    signal.signal(signal.SIGALRM,expired)
    timer=signal.setitimer(signal.ITIMER_REAL,seconds)
    try:yield
    finally:signal.setitimer(signal.ITIMER_REAL,*timer);signal.signal(signal.SIGALRM,old)
def address(value):
    need(isinstance(value,str) and len(value)<=254 and re.fullmatch(r'[A-Za-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+',value),'MAIL_ADDRESS');return value
def context(config):
    ctx=ssl.create_default_context(cafile=config.get('ca_file'));ctx.minimum_version=ssl.TLSVersion.TLSv1_2
    need(ctx.check_hostname and ctx.verify_mode==ssl.CERT_REQUIRED,'TLS_POLICY');return ctx
def endpoint(host,port,isolated):
    need(isinstance(host,str) and re.fullmatch(r'[A-Za-z0-9.-]{1,253}',host) and type(port) is int and 0<port<=65535,'ENDPOINT')
    resolved=socket.getaddrinfo(host,port,type=socket.SOCK_STREAM);need(resolved,'DNS_EMPTY')
    if isolated:need(all(ipaddress.ip_address(x[4][0]).is_loopback for x in resolved),'ISOLATED_EGRESS_DENIED')
    # Return one resolved IP; transport pins it, preventing a second DNS lookup.
    selected=next((x for x in resolved if x[0]==socket.AF_INET),resolved[0]);return selected[4][0]
def credentials(path):
    d=decode(read_file(path,4096,os.getuid()));need(set(d)=={'username','password'},'CREDENTIAL_SHAPE')
    for v in d.values():need(isinstance(v,str) and 0<len(v)<=256 and all(32<=ord(c)<=126 for c in v),'CREDENTIAL_VALUE')
    return d
def message(event,config,recipients):
    event=sanitize(event);sender=address(config['sender']);recipients=[address(x) for x in recipients]
    if config['isolated']:need(all(x.endswith('.invalid') for x in [sender,*recipients]),'ISOLATED_RECIPIENT_REQUIRED')
    msg=email.message.EmailMessage(policy=email.policy.SMTP);msg['From']=sender;msg['To']=', '.join(recipients);msg['Subject']='[NUAAFA] '+event['kind']+' '+event.get('check','DAILY_HEALTH_SUMMARY');msg['Date']=utc(event['utc']).strftime('%a, %d %b %Y %H:%M:%S +0000');msg['Message-ID']='<'+event['event_id']+'@'+sender.split('@')[1]+'>'
    msg.set_content(json.dumps(event,sort_keys=True,indent=2));need(len(msg.as_bytes())<=4096,'MAIL_SIZE');return msg
def smtp_send(event,config,creds,recipients):
    need(config.get('enabled') is True and type(config.get('isolated')) is bool,'DELIVERY_DISABLED')
    ctx=context(config);pinned=endpoint(config['host'],config['port'],config['isolated']);msg=message(event,config,recipients)
    class PinnedSMTP(smtplib.SMTP_SSL):
        def _get_socket(self,host,port,timeout):
            raw=socket.create_connection((pinned,port),timeout=timeout)
            try:return ctx.wrap_socket(raw,server_hostname=config['host'])
            except BaseException:raw.close();raise
    smtp=None
    try:
        smtp=PinnedSMTP(config['host'],config['port'],timeout=10,context=ctx,local_hostname='nuaafa-alert');smtp.set_debuglevel(0);smtp.login(creds['username'],creds['password'])
        refused=smtp.send_message(msg,from_addr=config['sender'],to_addrs=recipients)
        return {a:int(refused[a][0]) if a in refused else 250 for a in recipients}
    except smtplib.SMTPRecipientsRefused as error:return {a:int(error.recipients.get(a,(451,b''))[0]) for a in recipients}
    finally:
        if smtp is not None:smtp.close()
def classify(error):
    if isinstance(error,(ssl.SSLError,smtplib.SMTPAuthenticationError,Refused)):return 'QUARANTINED','TLS_AUTH_OR_POLICY'
    if isinstance(error,smtplib.SMTPResponseException):return ('PENDING','SMTP_4XX') if 400<=error.smtp_code<500 else ('QUARANTINED','SMTP_5XX')
    if isinstance(error,(OSError,TimeoutError,smtplib.SMTPException)):return 'PENDING','NETWORK_OR_DEADLINE'
    raise error
def new_job(event,recipients):return dict(event=event,recipients={a:{'status':'PENDING','attempts':0,'due':0,'last_code':None} for a in recipients})
def deliver(spool,state,config,credential_file,now=None,transport=smtp_send,after_accept=None):
    now=time.time() if now is None else now;need(config.get('enabled') is True,'DELIVERY_DISABLED');recipients=config['recipients'];need(type(recipients) is list and 1<=len(recipients)<=2 and len(set(recipients))==len(recipients),'RECIPIENT_SET')
    for a in recipients:address(a)
    directory(spool,0o750,config.get('spool_uid',0))
    with locked(state):
        journal=load(state/'outbox.json',{'jobs':{}});jobs=journal['jobs'];need(type(jobs) is dict and len(jobs)<=10000,'OUTBOX_COUNT')
        paths=sorted(spool.iterdir());need(len(paths)<=10010,'SPOOL_COUNT')
        for p in paths:
            if p.name in {'cursor.json','observation.json','.lock'}:continue
            need(re.fullmatch(r'[a-f0-9]{64}\.json',p.name),'SPOOL_ENTRY')
            d=decode(read_file(p,4096,config.get('spool_uid',0),private=False));event=sanitize(d);need(d==event and p.stem==event['event_id'],'SPOOL_EVENT_ID')
            if event['event_id'] not in jobs:need(len(jobs)<10000,'OUTBOX_COUNT');jobs[event['event_id']]=new_job(event,recipients)
        atomic(state/'outbox.json',encode(journal));creds=credentials(credential_file);attempted=0
        with deadline(config.get('deadline_seconds',25)):
            for ident,job in jobs.items():
                need(set(job['recipients'])==set(recipients),'RECIPIENT_CONFIGURATION_CHANGED')
                due=[a for a,d in job['recipients'].items() if d['status']=='PENDING' and d['due']<=now]
                if not due:continue
                if attempted>=50:break
                attempted+=1
                for a in due:
                    d=job['recipients'][a];d['attempts']+=1;d['due']=now+[60,300,900,3600][min(d['attempts']-1,3)]
                atomic(state/'outbox.json',encode(journal))
                try:
                    codes=transport(job['event'],config,creds,due)
                    if after_accept:after_accept()
                    for a in due:
                        code=codes[a];need(type(code) is int and 200<=code<=599,'SMTP_RESULT');job['recipients'][a].update(status='DELIVERED' if 200<=code<300 else 'PENDING' if 400<=code<500 else 'QUARANTINED',last_code=code)
                except Deadline:
                    for a in due:job['recipients'][a].update(last_code='TOTAL_DEADLINE')
                    atomic(state/'outbox.json',encode(journal));raise
                except Exception as error:
                    status,code=classify(error)
                    for a in due:job['recipients'][a].update(status=status,last_code=code)
                atomic(state/'outbox.json',encode(journal))
        states=[x['status'] for j in jobs.values() for x in j['recipients'].values()]
        return dict(status='PASS' if all(x=='DELIVERED' for x in states) else 'DEGRADED',attempted=attempted,delivered=states.count('DELIVERED'),pending=states.count('PENDING'),quarantined=states.count('QUARANTINED'))

def https_exchange(config,method,path,body=b'',headers=None,maximum=8192):
    need(re.fullmatch(r'/[A-Za-z0-9/_-]{0,180}',path),'HTTPS_PATH')
    pinned=endpoint(config['host'],config['port'],config['isolated']);ctx=context(config)
    class PinnedHTTPS(http.client.HTTPSConnection):
        def connect(self):
            raw=socket.create_connection((pinned,self.port),timeout=5)
            try:self.sock=ctx.wrap_socket(raw,server_hostname=config['host'])
            except BaseException:raw.close();raise
    conn=PinnedHTTPS(config['host'],config['port'],timeout=5,context=ctx)
    try:
        conn.request(method,path,body=body,headers={'Connection':'close',**(headers or {})});r=conn.getresponse();data=r.read(maximum+1);need(len(data)<=maximum,'HTTPS_RESPONSE_BOUND');return r.status,data
    finally:conn.close()
def heartbeat_payload(observation,delivery,now):
    need(type(observation) is dict and set(observation)=={'site','observed_epoch','status','unhealthy','version_ok','storage'},'HEARTBEAT_SHAPE')
    need(observation['site']=='NUAAFA' and type(observation['unhealthy']) is int and 0<=observation['unhealthy']<=22 and type(observation['version_ok']) is bool and observation['storage'] in {'PASS','FAIL','BLOCKED','UNKNOWN'},'HEARTBEAT_FIELDS')
    observed=epoch(observation['observed_epoch']);need(-120<=now-observed<=420,'STALE_OBSERVATION')
    healthy=not observation['unhealthy'] and observation['version_ok'] and observation['storage']=='PASS'
    need(observation['status']==('PASS' if healthy else 'DEGRADED'),'HEARTBEAT_STATUS')
    ok=delivery.get('status')=='PASS'
    return dict(**observation,delivery_ok=ok,sent_epoch=now,overall_status='PASS' if healthy and ok else 'DEGRADED')
def send_heartbeat(spool,state,config,credential_file,delivery,now=None):
    if config.get('enabled') is not True:return {'status':'NOT RUN'}
    now=time.time() if now is None else epoch(now)
    with locked(state):
        observation=decode(read_file(spool/'observation.json',4096,config.get('spool_uid',0),private=False));payload=heartbeat_payload(observation,delivery,now);old=load(state/'heartbeat-ack.json',{'observed_epoch':-1})
        if payload['observed_epoch']<=old['observed_epoch']:return {'status':'SKIPPED','reason':'NO_NEW_OBSERVATION'}
        key=read_file(credential_file,256,os.getuid());need(32<=len(key)<=128,'HEARTBEAT_KEY_SIZE');body=encode(payload);signature=hmac.new(key,body,hashlib.sha256).hexdigest()
        with deadline(config.get('deadline_seconds',10)):
            status,data=https_exchange(config,'POST',config['path'],body,{'Content-Type':'application/json','X-NUAAFA-Signature':signature},4096)
        need(status==200 and decode(data)=={'accepted':True},'HEARTBEAT_NOT_ACCEPTED');atomic(state/'heartbeat-ack.json',encode({'observed_epoch':payload['observed_epoch']}));return {'status':'PASS','health':payload['overall_status']}
def accept_heartbeat(raw,signature,key,previous,now):
    need(len(raw)<=4096 and isinstance(signature,str) and re.fullmatch(r'[a-f0-9]{64}',signature),'HEARTBEAT_INPUT')
    need(hmac.compare_digest(signature,hmac.new(key,raw,hashlib.sha256).hexdigest()),'HEARTBEAT_SIGNATURE')
    d=decode(raw);expected={'site','observed_epoch','status','unhealthy','version_ok','storage','delivery_ok','sent_epoch','overall_status'};need(type(d) is dict and set(d)==expected,'HEARTBEAT_SCHEMA')
    need(type(d['delivery_ok']) is bool and -120<=now-epoch(d['sent_epoch'])<=120,'HEARTBEAT_SEND_TIME');base={k:v for k,v in d.items() if k not in {'delivery_ok','sent_epoch','overall_status'}};rebuilt=heartbeat_payload(base,{'status':'PASS' if d['delivery_ok'] else 'DEGRADED'},d['sent_epoch']);need(rebuilt==d,'HEARTBEAT_INCONSISTENT')
    need(-120<=now-epoch(d['observed_epoch'])<=420 and d['observed_epoch']>previous.get('observed_epoch',-1),'HEARTBEAT_STALE_OR_REPLAY')
    return dict(observed_epoch=d['observed_epoch'],received_epoch=now,health=d['overall_status'])
def record_heartbeat(state,raw,signature,key,now):
    # Independent receiver adapter: persist before acknowledging HTTP200. A
    # restart retains replay protection and the dead-man's last observation.
    with locked(state):
        previous=load(state/'received-heartbeat.json',{})
        result=accept_heartbeat(raw,signature,key,previous,now)
        atomic(state/'received-heartbeat.json',encode(result));return result
def advance(previous,check,ok,now,threshold=3):
    epoch(now);need(check in CHECKS and type(ok) is bool,'EXTERNAL_CHECK')
    bad=0 if ok else previous.get('failures',0)+1;good=previous.get('successes',0)+1 if ok else 0;alerted=previous.get('alerted',False);since=previous.get('since_epoch',now)
    if not ok and not previous.get('failures',0) and not alerted:since=now
    out=[]
    if bad>=threshold and not alerted:
        out.append(sanitize(dict(kind='INCIDENT_OPEN',utc=stamp(now),check=check,since_epoch=since,detected_epoch=now,failures=bad,duration_basis='OBSERVED_CHECK_FAILURE_WINDOW')));alerted=True
    if ok and good>=2 and alerted:
        out.append(sanitize(dict(kind='INCIDENT_RECOVERY',utc=stamp(now),check=check,since_epoch=since,recovered_epoch=now,duration_seconds=now-since,duration_basis='OBSERVED_CHECK_FAILURE_WINDOW')));alerted=False
    return dict(failures=bad,successes=good,alerted=alerted,since_epoch=since),out
def external_check(config,state,spool,now=None):
    need(config.get('enabled') is True,'EXTERNAL_MONITOR_DISABLED');now=time.time() if now is None else epoch(now);directory(spool,0o750)
    with locked(state):
        journal=load(state/'external.json',{'checks':{},'last_probe_epoch':-1})
        need(now-journal['last_probe_epoch']>=60,'PROBE_INTERVAL')
        with deadline(config.get('deadline_seconds',15)):
            observations={}
            for check,path in [('PUBLIC_HTTPS_HOME','/'),('PUBLIC_HTTPS_HEALTH','/api/health')]:
                try:
                    code,raw=https_exchange(config,'GET',path);ok=code==200
                    if path=='/api/health':ok=ok and decode(raw).get('status')=='ok'
                except Deadline:raise
                except (OSError,ValueError,Refused,http.client.HTTPException):ok=False
                observations[check]=ok
        hb=load(state/'received-heartbeat.json',{})
        observations['EXTERNAL_HEARTBEAT']=bool(hb) and 0<=now-hb.get('received_epoch',0)<=720 and hb.get('health')=='PASS'
        events=[]
        for check,ok in observations.items():
            entry,out=advance(journal['checks'].get(check,{}),check,ok,now,1 if check=='EXTERNAL_HEARTBEAT' else 3);journal['checks'][check]=entry;events+=out
        for event in events:atomic(spool/(event['event_id']+'.json'),encode(event),0o640,True)
        journal['last_probe_epoch']=now;atomic(state/'external.json',encode(journal));return dict(status='PASS' if all(observations.values()) else 'DEGRADED',events=len(events),checks=observations)
def config_file(path):
    # Configuration is public metadata, root-owned and never writable by the
    # sender. SMTP/heartbeat secrets are separate managed credentials.
    config=decode(read_file(path,16384,0,private=False));need(type(config) is dict,'CONFIG_SHAPE');return config
def main():
    os.umask(0o077);parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['bridge','send','probe']);parser.add_argument('--config',required=True,type=P);args=parser.parse_args();c=config_file(args.config)
    # Production enablement requires an explicit root-owned config, never env flags.
    need(c.get('enabled') is True,'CONFIG_DISABLED');now=time.time()
    if args.mode=='bridge':out=bridge(P(c['events']),P(c['latest']),P(c['storage_receipt']),P(c['spool']),c['source_uid'],now)
    elif args.mode=='send':
        credroot=P(os.environ['CREDENTIALS_DIRECTORY']);smtp=dict(c['smtp'],recipients=c['recipients'],spool_uid=c.get('spool_uid',0));out=deliver(P(c['spool']),P(c['state']),smtp,credroot/'smtp',now);out['heartbeat']=send_heartbeat(P(c['spool']),P(c['state']),dict(c['heartbeat'],spool_uid=c.get('spool_uid',0)),credroot/'heartbeat',out,now)
    else:out=external_check(c,P(c['state']),P(c['spool']),now)
    print(json.dumps(out));return 0 if out['status']=='PASS' else 1
if __name__=='__main__':
    try:raise SystemExit(main())
    except (Exception,Deadline) as error:print(json.dumps({'status':'FAIL','error_type':type(error).__name__,'code':str(error) if isinstance(error,Refused) else 'DETAIL_OMITTED'}));raise SystemExit(1)
