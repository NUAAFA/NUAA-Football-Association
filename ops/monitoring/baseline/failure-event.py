import datetime,json,os,re,sys
from pathlib import Path
unit=sys.argv[1]
assert re.fullmatch(r'nuaafa-ops-(backup|monitor|restore|nginxlog|fixture)',unit)
root=Path('/var/lib/nuaafa-ops-monitor')
assert root.resolve()==root and root.stat().st_uid==os.getuid()
fd=os.open(root/'events.jsonl',os.O_WRONLY|os.O_CREAT|os.O_APPEND|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'w') as f:
    f.write(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':'SYSTEMD_SERVICE_FAILURE','service':unit,'simulation':unit.endswith('fixture'),'delivery':'PENDING_TRANSPORT_CONFIGURATION'})+'\n');f.flush();os.fsync(f.fileno())
print('NUAAFA_OPS_LOCAL_FAILURE_EVENT_RECORDED')
