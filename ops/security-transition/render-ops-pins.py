#!/usr/bin/env python3
"""Read local staged source copies; create-only output. Never install or run jobs.

Only replace the one exact stale EXPECTED constant. Preserve all existing
PID/cwd/cgroup/generation, maintenance and backup-integrity checks byte-for-byte.
"""
import argparse, hashlib, json, re
from pathlib import Path
STALE='2a28184b89157e08c19988b100274be9e187f3cb'
TARGETS=('b68797c2e28e9dfdec215c460243628d1f0a4f6a','6db56b94c25ca3ce1376dabbda74714448decf53')
def render(source, target):
    if target not in TARGETS:raise ValueError('unreviewed ops pin')
    old="EXPECTED='"+STALE+"'"
    if len(re.findall(r'^EXPECTED=.*$',source,flags=re.M))!=1 or source.count(old)!=1:raise ValueError('unexpected baseline pin')
    if 'def deployed_identity():' not in source or 'DEPLOYED_PROCESS_CHANGED' not in source:raise ValueError('missing stable process guard')
    return source.replace(old,"EXPECTED='"+target+"'")
def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if str(a.source.resolve()).startswith(('/srv/','/usr/local/lib/')):raise ValueError('use staged local source copies only')
    a.output.mkdir(mode=0o700);evidence=[]
    for name in ('monitor.py','backup.py'):
        source=(a.source/name).read_text()
        for target in TARGETS:
            out=a.output/target;out.mkdir(exist_ok=True)
            text=render(source,target)
            with (out/name).open('x') as f:f.write(text)
            evidence.append(dict(name=name,target=target,input_sha256=hashlib.sha256(source.encode()).hexdigest(),output_sha256=hashlib.sha256(text.encode()).hexdigest(),changed_expected_constant_only=True))
    (a.output/'pin-manifest.json').write_text(json.dumps(evidence,indent=2)+'\n')
if __name__=='__main__':main()
