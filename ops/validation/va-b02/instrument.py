"""Diagnostic copy only. Shipping scripts and service limits are not modified."""
import ast,hashlib,sys
from pathlib import Path

def instrument(source):
    ast.parse(source)
    injected=r'''
# BEGIN VA-B02 DIAGNOSTIC ONLY
import resource,signal,traceback
_profile_path=ROOT/'profile.jsonl'
_profile_start=time.monotonic()
_profile_check='IMPORTS_COMPLETE'
def _profile(kind,**fields):
    mine=resource.getrusage(resource.RUSAGE_SELF);kids=resource.getrusage(resource.RUSAGE_CHILDREN)
    data=dict(kind=kind,monotonic=time.monotonic(),process_cpu=time.process_time(),user=mine.ru_utime,system=mine.ru_stime,child_user=kids.ru_utime,child_system=kids.ru_stime,check=_profile_check,**fields)
    fd=os.open(_profile_path,os.O_WRONLY|os.O_CREAT|os.O_APPEND|os.O_NOFOLLOW,0o600)
    try:os.write(fd,(json.dumps(data,sort_keys=True)+'\n').encode())
    finally:os.close(fd)
_profile('PROFILE_BEGIN',pid=os.getpid())
_original_run=subprocess.run
_original_popen=subprocess.Popen
class _ProfilePopen(_original_popen):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        _profile('SUBPROCESS_PID',child_pid=self.pid)
subprocess.Popen=_ProfilePopen
def _profile_run(*args,**kwargs):
    _profile('SUBPROCESS_BEGIN',argv=args[0] if args else kwargs.get('args'))
    started=time.monotonic()
    try:
        result=_original_run(*args,**kwargs)
        _profile('SUBPROCESS_END',seconds=time.monotonic()-started,rc=result.returncode)
        return result
    except BaseException as error:
        _profile('SUBPROCESS_EXCEPTION',seconds=time.monotonic()-started,error=type(error).__name__)
        raise
subprocess.run=_profile_run
def _profile_term(number,frame):
    _profile('SIGTERM_POSITION',stack=traceback.format_stack(frame))
    signal.signal(signal.SIGTERM,signal.SIG_DFL)
    os.kill(os.getpid(),signal.SIGTERM)
signal.signal(signal.SIGTERM,_profile_term)
# END VA-B02 DIAGNOSTIC ONLY
'''
    loc=source.index('def now():')
    # All ROOT/EXPECTED definitions exist at this position in both versions.
    source=source[:loc]+injected+'\n'+source[loc:]
    source=source.replace("    def check(name,fn):\n        try:","    def check(name,fn):\n        global _profile_check\n        _profile_check=name\n        _profile('CHECK_BEGIN')\n        try:")
    needle="        except Exception as e:checks[name]={'ok':False};details[name]={'ok':False,'error_type':type(e).__name__}"
    assert source.count(needle)==1
    source=source.replace(needle,needle+"\n        finally:_profile('CHECK_END',ok=checks.get(name,{}).get('ok'))")
    ast.parse(source)
    return source

if __name__=='__main__':
    src=Path(sys.argv[1]);dst=Path(sys.argv[2]);dst.write_text(instrument(src.read_text()))
