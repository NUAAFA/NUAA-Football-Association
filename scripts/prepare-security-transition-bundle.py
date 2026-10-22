#!/usr/bin/env python3
"""Create a reviewable LOCAL payload; never install, approve or contact a host."""
import argparse, hashlib, importlib.util, json
from pathlib import Path
import re, shutil, subprocess, tarfile
OLD='b68797c2e28e9dfdec215c460243628d1f0a4f6a'
NEW='6db56b94c25ca3ce1376dabbda74714448decf53'
ARCHIVES={OLD:'7ab7b87387363fb91ba9787eabd64f80c9ba76f1ded9b6fcf6915fb3f0de70b0',NEW:'20aa86143e1e65553fa37d27e3e67258f4e55136ccc4adc7d8bcb317a34f5ba1'}
NODES={OLD:('22.23.2','3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327'),NEW:('22.23.4','94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90')}
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for data in iter(lambda:f.read(1024*1024),b''):h.update(data)
    return h.hexdigest()
def main():
    p=argparse.ArgumentParser()
    for name in ('repository','old-node','new-node','old-archive','output'):p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args();repo=a.repository.resolve(strict=True);out=a.output
    assert out.is_absolute() and out.parent.resolve(strict=True)==out.parent and not out.exists()
    assert not str(out).startswith(('/srv/','/usr/','/opt/','/etc/','/var/')), 'local review output only'
    out.mkdir(mode=0o700);payload=out/'payload';payload.mkdir()
    installed=Path('/opt/nuaafa/security-transition');toolroot=Path('/usr/local/lib/nuaafa')
    origin=[];contracts={}
    def put(target,data,mode=0o644):
        dest=payload/str(target).lstrip('/');dest.parent.mkdir(parents=True,exist_ok=True)
        with dest.open('xb') as f:f.write(data if isinstance(data,bytes) else data.encode())
        dest.chmod(mode);return dest
    def source(commit,path):
        data=subprocess.check_output(['git','-C',str(repo),'show',commit+':'+path])
        origin.append(dict(commit=commit,source=path,source_sha256=hashlib.sha256(data).hexdigest()))
        return data
    for commit,runtime in ((OLD,a.old_node),(NEW,a.new_node)):
        version,binary_digest=NODES[commit];assert digest(runtime)==binary_digest
        slot=installed/commit;put(slot/'node',runtime.read_bytes(),0o755)
        put(slot/'prebuilt-artifact.py',source(commit,'ops/deploy/prebuilt-artifact.py'))
        put(slot/'student-id-release-preflight.mjs',source(commit,'scripts/student-id-release-preflight.mjs'))
        wrapper=source(commit,'ops/deploy/start-prebuilt').decode()
        for key,value in {'NODE':str(slot/'node'),'HELPER':str(slot/'prebuilt-artifact.py')}.items():
            wrapper,count=re.subn(r'^'+key+r' = .+$',key+' = '+repr(value),wrapper,flags=re.M);assert count==1
        put(slot/'start-prebuilt',wrapper,0o755)
        deployer=source(commit,'ops/deploy/nuaafa-deploy').decode()
        for key,value in {'prebuilt_helper':str(toolroot/'helper-transition.py'),'prebuilt_start':str(toolroot/'start-transition'),'student_id_preflight_node':str(slot/'node'),'student_id_preflight_command':str(slot/'student-id-release-preflight.mjs')}.items():
            deployer,count=re.subn(r'^'+key+r'="[^"]+"$',key+'="'+value+'"',deployer,flags=re.M);assert count==1
        put(slot/'deployer',deployer,0o755)
        contracts[commit]=dict(sha256=ARCHIVES[commit])
        for name,filename in [('node','node'),('helper','prebuilt-artifact.py'),('start','start-prebuilt')]:
            contracts[commit][name]=str(slot/filename);contracts[commit][name+'_sha256']=digest(payload/str(slot/filename).lstrip('/'))
    assert digest(a.old_archive)==ARCHIVES[OLD]
    build_input=out/'auxiliary-input';file=build_input/'node_modules/@esbuild/linux-x64/bin/esbuild';file.parent.mkdir(parents=True)
    with tarfile.open(a.old_archive,'r|gz') as archive:
        for entry in archive:
            if entry.name=='node_modules/@esbuild/linux-x64/bin/esbuild':
                assert entry.isfile() and entry.size<20*1024**2
                with archive.extractfile(entry) as src,file.open('xb') as dst:shutil.copyfileobj(src,dst)
                file.chmod(entry.mode);break
        else:raise ValueError('old auxiliary executable absent')
    spec=importlib.util.spec_from_file_location('prepare_aux',repo/'ops/security-transition/prepare-recovery-esbuild.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    auxiliary=module.prepare(payload/str(installed/OLD).lstrip('/'),build_input,installed/OLD/'recovery-esbuild')
    router=(repo/'ops/security-transition/contract-router.py').read_bytes()
    for name in ('helper-transition.py','start-transition'):put(toolroot/name,router,0o755)
    config=dict(format=1,current='/srv/nuaafa/current',releases='/srv/nuaafa/releases',contracts=contracts)
    put(Path('/etc/nuaafa/security-transition.json'),json.dumps(config,indent=2)+'\n')
    for name in ('94-security-transition-start.conf','95-security-resources.conf'):
        put(Path('/etc/systemd/system/nuaafa.service.d')/name,(repo/'ops/security-transition'/name).read_bytes())
    put(Path('/etc/nginx/conf.d/nuaafa-security-auth.conf'),(repo/'ops/security-transition/nginx-http.conf').read_bytes())
    put(Path('/etc/nginx/snippets/nuaafa-security-auth-locations.conf'),(repo/'ops/security-transition/nginx-server.conf').read_bytes())
    files=[dict(target='/'+str(f.relative_to(payload)),sha256=digest(f),mode=oct(f.stat().st_mode & 0o777),owner='root:root') for f in sorted(payload.rglob('*')) if f.is_file()]
    (out/'payload-manifest.json').write_text(json.dumps(dict(format=1,files=files,source_origins=origin,auxiliary=auxiliary,production_installation='NOT RUN',human_approval='NOT GENERATED',release_allowed=False),indent=2)+'\n')
    print(json.dumps(dict(status='PASS',files=len(files),output=str(out),production_writes=False,approval_generated=False)))
if __name__=='__main__':main()
