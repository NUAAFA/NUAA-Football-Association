#!/usr/bin/env python3
"""Prepare an exact, root-controlled auxiliary executable outside sealed releases.

No archive or imported release is modified. Only a staged old deployer copy is
adapted; its backup path validates the auxiliary file before executing TSX.
"""
import hashlib
from pathlib import Path
import os
SHA='0c6588b092a2c291a72bab90659f3c9e0e25e0fe59c9ac12b4dae4d945e5548c'
def prepare(slot, release):
    source=release/'node_modules/@esbuild/linux-x64/bin/esbuild'
    raw=source.read_bytes()
    assert hashlib.sha256(raw).hexdigest()==SHA
    destination=slot/'recovery-esbuild'
    with destination.open('xb') as out:out.write(raw)
    destination.chmod(0o755)
    path=slot/'deployer';text=path.read_text()
    start=text.index('run_prebuilt_backup() (');end=text.index('\nactivation_database_digest=',start)
    section=text[start:end]
    assert section.count('env -i PATH=/usr/bin:/bin')==2
    header='run_prebuilt_backup() (\n'
    guard='  local recovery_esbuild_path='+repr(str(destination))+'\n  verify_root_metadata "$recovery_esbuild_path" || return $?\n  [ -x "$recovery_esbuild_path" ] && [ "$(/usr/bin/sha256sum "$recovery_esbuild_path" | /usr/bin/cut -d " " -f 1)" = "'+SHA+'" ] || { die "old recovery auxiliary executable differs"; return 1; }\n'
    section=section.replace(header,header+guard).replace('env -i PATH=/usr/bin:/bin','env -i ESBUILD_BINARY_PATH="$recovery_esbuild_path" PATH=/usr/bin:/bin')
    text=text[:start]+section+text[end:];path.write_text(text);path.chmod(0o755)
    return dict(original_sha256=SHA,auxiliary_sha256=hashlib.sha256(destination.read_bytes()).hexdigest(),original_mode=oct(source.stat().st_mode & 0o777),auxiliary_mode=oct(destination.stat().st_mode & 0o777),sealed_release_changed=False,adaptation='old backup function validates and supplies ESBUILD_BINARY_PATH only')
