#!/usr/bin/env python3
"""Real systemd condition guard; disposable GitHub VM and owned unit only."""
import json, os, pathlib, secrets, subprocess, tempfile
P=pathlib.Path
def main():
    assert os.getuid()==0 and os.environ.get('GITHUB_ACTIONS')=='true'
    assert P('/proc/1/comm').read_text().strip()=='systemd'
    unit='nuaafa-security-guard-'+secrets.token_hex(12)+'.service'
    path=P('/run/systemd/system')/unit
    with tempfile.TemporaryDirectory(prefix='nuaafa-guard-',dir='/var/lib') as directory:
        flag=P(directory)/'maintenance.flag';flag.touch()
        template=(P(__file__).resolve().parents[1]/'ops/security-transition/96-security-maintenance-guard.conf').read_text()
        content='[Unit]\nDescription=Fictional maintenance guard validation\n'+template.replace('/etc/nuaafa-b0-maintenance.flag',str(flag))+'\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=/usr/bin/true\nSendSIGKILL=no\nTimeoutStopSec=infinity\n'
        with path.open('x') as stream:stream.write(content)
        identity=(path.stat().st_dev,path.stat().st_ino)
        def run(*args):return subprocess.run(['systemctl',*args],check=True,capture_output=True,text=True,timeout=20)
        def properties():
            return dict(x.split('=',1) for x in run('show',unit,'--property=ConditionResult,ActiveState,ExecMainStartTimestampMonotonic,ExecMainStatus').stdout.splitlines())
        try:
            run('daemon-reload');run('start',unit);blocked=properties()
            assert blocked['ConditionResult']=='no' and blocked['ActiveState']=='inactive' and blocked['ExecMainStartTimestampMonotonic']=='0'
            flag.unlink();run('start',unit);allowed=properties()
            assert allowed['ConditionResult']=='yes' and int(allowed['ExecMainStartTimestampMonotonic'])>0 and allowed['ExecMainStatus']=='0',allowed
            result=dict(status='PASS',maintenance_flag_blocks_execution=blocked,flag_removed_allows_execution=allowed,production_access=False,production_approval=False)
        finally:
            run('stop',unit)
            assert (path.stat().st_dev,path.stat().st_ino)==identity and path.read_text()==content
            path.unlink();run('daemon-reload')
        result['owned_unit_removed']=not path.exists()
        out=P(os.environ['RUNNER_TEMP'])/'backout-output/maintenance-guard-results.json'
        out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main()
