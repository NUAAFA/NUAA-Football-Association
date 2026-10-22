#!/usr/bin/env python3
"""Prepare a config candidate in an explicit fictional workspace only. No apply."""
import argparse,hashlib,json,os,pathlib,re
P=pathlib.Path
KEY=b'REFEREE_ADMIN_PASSWORD_HASH'
class Refused(Exception):pass
def retire(raw):
    if len(raw)>65536 or b'\0' in raw:raise Refused('CONFIG_BOUND_OR_NUL')
    raw.decode('utf-8');lines=raw.splitlines(keepends=True);hits=[]
    for index,line in enumerate(lines):
        clean=line.strip()
        if not clean or clean.startswith(b'#'):continue
        match=re.fullmatch(rb'(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(.*)',clean)
        if not match:raise Refused('UNREVIEWED_ENV_SYNTAX')
        value=match[2]
        # No multiline/ambiguous quoting may hide a matching key or a secret.
        if value.startswith((b'"',b"'",b'`')):
            quote=value[:1];end=None
            for pos in range(1,len(value)):
                escapes=len(value[:pos])-len(value[:pos].rstrip(b'\\'))
                if value[pos:pos+1]==quote and (quote!=b'"' or escapes%2==0):end=pos;break
            if end is None or value[end+1:].lstrip()[:1] not in (b'',b'#'):raise Refused('MULTILINE_OR_AMBIGUOUS_ENV')
        if match[1]==KEY:hits.append(index)
    if len(hits)!=1:raise Refused('REQUIRES_ONE_UNIQUE_LEGACY_KEY')
    return b''.join(line for index,line in enumerate(lines) if index!=hits[0])
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--fictional-workspace',required=True,type=P);args=parser.parse_args();root=args.fictional_workspace
    if root.resolve()!=root or (root/'.fictional-retirement-marker').read_bytes()!=b'FICTIONAL DATA ONLY\n':raise Refused('FICTIONAL_MARKER_REQUIRED')
    path=root/'fixture.env'
    if path.is_symlink() or not path.is_file() or path.stat().st_nlink!=1:raise Refused('SOURCE_ALIAS')
    raw=path.read_bytes();candidate=retire(raw);out=root/'retired-candidate.env';fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:f.write(candidate);f.flush();os.fsync(f.fileno())
    print(json.dumps({'status':'PASS','removed_keys':1,'all_other_bytes_preserved':True,'production_apply_supported':False,'candidate_sha256':hashlib.sha256(candidate).hexdigest()}))
if __name__=='__main__':
    try:main()
    except Exception as error:print(json.dumps({'status':'FAIL','error_type':type(error).__name__}));raise SystemExit(1)
