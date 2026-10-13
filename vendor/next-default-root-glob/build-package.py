#!/usr/bin/env python3
"""Deterministically package the reviewed internal adapter source."""
import gzip
import hashlib
import io
from pathlib import Path
import tarfile

root = Path(__file__).resolve().parent
tar_bytes = io.BytesIO()
with tarfile.open(fileobj=tar_bytes, mode="w", format=tarfile.USTAR_FORMAT) as archive:
    for name in sorted(("README.md", "index.cjs", "package.json")):
        data = (root / name).read_bytes()
        info = tarfile.TarInfo("package/" + name)
        info.size, info.mode, info.uid, info.gid, info.mtime = len(data), 0o644, 0, 0, 0
        archive.addfile(info, io.BytesIO(data))
compressed = io.BytesIO()
with gzip.GzipFile(fileobj=compressed, filename="", mode="wb", mtime=0, compresslevel=9) as output:
    output.write(tar_bytes.getvalue())
data = compressed.getvalue()
target = root / "next-default-root-glob-1.0.0.tgz"
if target.exists():
    if target.read_bytes() != data:
        raise SystemExit("STOP: generated package differs; preserve and review the existing archive")
else:
    with target.open("xb") as output:
        output.write(data)
print(hashlib.sha256(data).hexdigest() + "  " + target.name)
