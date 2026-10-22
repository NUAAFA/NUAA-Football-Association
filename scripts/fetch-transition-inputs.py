#!/usr/bin/env python3
"""Download two original CI archives and pinned official Linux runtimes only."""
import hashlib, json, os
from pathlib import Path
import shutil, tarfile, urllib.request, urllib.parse, zipfile

ARTIFACTS = [
    (12389415594, 'b68797c2e28e9dfdec215c460243628d1f0a4f6a', '8f298aa973f79500d92251c237757163e3b49d69cac15311488926d6bffd9c5f', '7ab7b87387363fb91ba9787eabd64f80c9ba76f1ded9b6fcf6915fb3f0de70b0'),
    (12422858676, '6db56b94c25ca3ce1376dabbda74714448decf53', '66345b7d25f6271f5dd0e608efd00ccffe6c465582bcde0760b1e8ad54f6a01f', '20aa86143e1e65553fa37d27e3e67258f4e55136ccc4adc7d8bcb317a34f5ba1'),
]
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def download(url, target, token=None):
    class Redirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, message, headers, new_url):
            redirected=super().redirect_request(request,fp,code,message,headers,new_url)
            if urllib.parse.urlsplit(request.full_url).netloc!=urllib.parse.urlsplit(new_url).netloc:
                redirected.remove_header('Authorization')
            return redirected
    headers={'Accept':'application/vnd.github+json'}
    if token:headers['Authorization']='Bearer '+token
    request=urllib.request.Request(url,headers=headers)
    with urllib.request.build_opener(Redirect()).open(request,timeout=60) as source,target.open('xb') as out:shutil.copyfileobj(source,out)

def main():
    root=Path(os.environ['RUNNER_TEMP'])/'transition-inputs';root.mkdir(mode=0o700)
    evidence=[];api='https://api.github.com/repos/NUAAFA/NUAA-Football-Association/actions/artifacts/'
    for ident,commit,zip_digest,archive_digest in ARTIFACTS:
        metadata=root/(commit+'-github.json');download(api+str(ident),metadata,os.environ['GH_TOKEN'])
        m=json.loads(metadata.read_bytes())
        assert m['id']==ident and not m['expired'] and m['workflow_run']['head_sha']==commit and m['digest']=='sha256:'+zip_digest
        outer=root/(commit+'.zip');download(api+str(ident)+'/zip',outer,os.environ['GH_TOKEN'])
        assert digest(outer)==zip_digest
        with zipfile.ZipFile(outer) as z:
            assert z.testzip() is None
            candidates=[i for i in z.infolist() if i.filename=='nuaafa-'+commit+'.tar.gz']
            assert len(candidates)==1 and candidates[0].file_size<1024**3
            archive=root/(commit+'.tar.gz')
            with z.open(candidates[0]) as source,archive.open('xb') as out:shutil.copyfileobj(source,out)
        assert digest(archive)==archive_digest
        evidence.append(dict(commit=commit,artifact_id=ident,zip_sha256=zip_digest,archive_sha256=archive_digest,status='PASS'))
    for version in ('22.23.2','22.23.4'):
        filename='node-v'+version+'-linux-x64.tar.xz';base='https://nodejs.org/dist/v'+version+'/'
        sums=root/('node-'+version+'-SHASUMS256.txt');download(base+'SHASUMS256.txt',sums)
        expected=[line.split()[0] for line in sums.read_text().splitlines() if line.split()[-1]==filename]
        assert len(expected)==1
        archive=root/filename;download(base+filename,archive);assert digest(archive)==expected[0]
        runtime=root/('node-'+version);runtime.mkdir(mode=0o755)
        with tarfile.open(archive) as t:
            entry=t.getmember('node-v'+version+'-linux-x64/bin/node');assert entry.isfile() and entry.size<200*1024**2
            with t.extractfile(entry) as source,(runtime/'node').open('xb') as out:shutil.copyfileobj(source,out)
        (runtime/'node').chmod(0o755)
        evidence.append(dict(node=version,official_url=base+filename,archive_sha256=expected[0],binary_sha256=digest(runtime/'node'),status='PASS'))
    (root/'input-identities.json').write_text(json.dumps(evidence,indent=2)+'\n')
    print(json.dumps(evidence,indent=2))
if __name__=='__main__':main()
