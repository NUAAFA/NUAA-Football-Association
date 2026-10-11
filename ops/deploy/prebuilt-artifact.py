#!/usr/bin/env python3
"""Trusted, stdlib-only pack/import verifier. Never execute files from an archive."""
import argparse
import hashlib
import io
import gzip
import tempfile
import sqlite3
import pwd
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile

FORMAT = 1
MANIFEST = "nuaafa-artifact.json"
REPOSITORY = "NUAAFA/NUAA-Football-Association"
VERSIONS = {"node": "22.23.2", "next": "16.3.8", "prisma": "7.9.1"}
SOURCE_ROOTS = {"src", "scripts", "prisma", "public"}
SOURCE_FILES = {".gitignore", "package.json", "package-lock.json", "next.config.ts", "prisma.config.ts", "tsconfig.json"}
REQUIRED = SOURCE_FILES | {
    "prisma/schema.prisma", "src/generated/prisma-v29/index.js",
    "node_modules/next/package.json", "node_modules/next/dist/bin/next",
    "node_modules/prisma/package.json", "node_modules/prisma/build/index.js",
    "node_modules/tsx/dist/cli.mjs", "node_modules/.bin/tsx", "node_modules/.bin/prisma",
    ".next/BUILD_ID", ".next/required-server-files.json", ".next/routes-manifest.json",
    ".next/prerender-manifest.json", ".next/server/app/api/health/route.js",
}
MAX_FILES = 100000
MAX_BYTES = 3 * 1024 ** 3
MAX_FILE = 512 * 1024 ** 2
RESERVE = 512 * 1024 ** 2


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def capacity(path, required):
    require(shutil.disk_usage(path).free >= required + RESERVE, "insufficient free space with safety reserve")



def open_regular(path):
    path = Path(path)
    require(path.is_absolute() and ".." not in path.parts, "file path must be absolute and canonical")
    parent = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for name in path.parts[1:-1]:
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent); parent = child
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            os.close(fd); raise ValueError("unsafe regular file descriptor")
        return os.fdopen(fd, "rb")
    finally: os.close(parent)

def _snapshot(source, destination, checksum):
    exact_sha(checksum, 64)
    # Bounded copy from one regular-file descriptor; concurrent growth cannot fill the disk.
    with open_regular(source) as src:
        info = os.fstat(src.fileno())
        require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= MAX_BYTES, "unsafe or oversized input archive")
        capacity(destination.parent, info.st_size)
        h, size = hashlib.sha256(), 0
        with open(destination, "xb") as out:
            for chunk in iter(lambda: src.read(1024 * 1024), b""):
                size += len(chunk)
                require(size <= info.st_size, "archive grew during private copy")
                h.update(chunk)
                out.write(chunk)
        require(size == info.st_size and h.hexdigest() == checksum, "independent SHA-256 mismatch during private copy")


def snapshot(source, destination, checksum):
    require(not os.path.lexists(destination), "snapshot output already exists")
    try:
        _snapshot(source, destination, checksum)
    except Exception:
        if destination.is_file() and not destination.is_symlink(): destination.unlink()
        raise


def exact_sha(value, length=40):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{%d}" % length, value), "invalid exact SHA")


def safe_path(name):
    require(isinstance(name, str) and name and len(name.encode()) <= 4096, "invalid archive path")
    require(not name.startswith("/") and "\\" not in name and ":" not in name, "absolute or ambiguous path")
    require(all(ord(c) >= 32 and ord(c) != 127 for c in name), "control character in path")
    require(all(p not in ("", ".", "..") for p in name.split("/")), "path traversal or noncanonical path")
    parts = name.split("/")
    require(".git" not in parts, "Git metadata is not accepted from an artifact")
    require(not any(p.startswith(".env") or p.lower().endswith((".db", ".db-wal", ".db-shm", ".db-journal", ".sqlite", ".sqlite3", ".pem", ".key", ".p12", ".pfx")) for p in parts), "secret or database path")
    require(not any(p in ("uploads", "backups", "id_rsa", "id_ed25519", ".npmrc") for p in parts), "mutable or credential path")
    root = parts[0]
    require(name == MANIFEST or root in SOURCE_ROOTS | {"node_modules", ".next"} or name in SOURCE_FILES, "unapproved artifact path")
    require(not name.startswith((".next/cache/", ".next/dev/", ".next/standalone/", "node_modules/.cache/")), "build cache or unsupported standalone layout")
    return name


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def load_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate JSON key")
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique)


GIT_USER = None


def git(root, *args):
    # Execute all repository operations as the application identity, including
    # repeat validation. Never opt out globally from Git ownership protection.
    command = ["/usr/bin/git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null",
               "-c", "core.fsmonitor=false", "-c", "core.attributesFile=/dev/null"]
    if GIT_USER:
        command += ["-c", "safe.directory=" + str(root)]
        command = ["/usr/sbin/runuser", "-u", GIT_USER, "--", *command]
    env = {"PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
           "GIT_TERMINAL_PROMPT": "0", "GIT_NO_REPLACE_OBJECTS": "1", "GIT_OPTIONAL_LOCKS": "0"}
    return subprocess.check_output([*command, "-C", str(root), *args], env=env)



def source_paths(root):
    return sorted(p for p in git(root, "ls-tree", "-r", "--name-only", "-z", "HEAD").decode().split("\0") if p and
                  (p.split("/")[0] in SOURCE_ROOTS or p in SOURCE_FILES))


def platform_info():
    versions = load_json(subprocess.check_output(["node", "-p", "JSON.stringify(process.versions)"]))
    release = {}
    if Path("/etc/os-release").is_file():
        for line in Path("/etc/os-release").read_text().splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                release[k] = v.strip('"')
    import platform
    return {"system": platform.system(), "machine": platform.machine(),
            "os_id": release.get("ID"), "os_version": release.get("VERSION_ID"),
            "libc": list(platform.libc_ver()), "node": versions["node"],
            "node_abi": versions["modules"], "openssl": versions["openssl"]}


def validate_platform(p):
    require(p["system"] == "Linux" and p["machine"] == "x86_64" and
            p["os_id"] == "ubuntu" and p["os_version"] == "24.04" and
            p["libc"][0] == "glibc" and p["libc"][1] == "2.39" and
            p["node"] == VERSIONS["node"] and p["node_abi"] == "127", "unsupported artifact platform")



def validate_installed(root, lock):
    installed = load_json((root / "node_modules/.package-lock.json").read_bytes())
    for name, value in installed["packages"].items():
        expected = lock["packages"].get(name)
        require(expected is not None and all(value.get(k) == expected.get(k) for k in ("version", "integrity", "resolved")), "installed dependency metadata differs: " + name)
        safe_path(name + "/package.json")
        package = root / name / "package.json"
        require(package.is_file() and not package.is_symlink() and load_json(package.read_bytes())["version"] == expected["version"], "actual installed package version differs: " + name)
    for name, expected in lock["packages"].items():
        if not name or expected.get("optional") or expected.get("devOptional"): continue
        require(name in installed["packages"], "required locked dependency missing: " + name)


def exclusive_output(path, owned):
    output = open(path, "xb")
    info = os.fstat(output.fileno())
    owned.append((path, info.st_dev, info.st_ino))
    return output


def _pack(root, output, commit, owned):
    exact_sha(commit)
    require(git(root, "rev-parse", "HEAD").decode().strip() == commit, "source SHA mismatch")
    require(not git(root, "status", "--porcelain"), "pack requires a clean exact checkout")
    platform = platform_info()
    validate_platform(platform)
    lock = load_json((root / "package-lock.json").read_bytes())
    for name, version in (("next", VERSIONS["next"]), ("prisma", VERSIONS["prisma"]), ("@prisma/client", VERSIONS["prisma"])):
        require(lock["packages"]["node_modules/" + name]["version"] == version, "locked version mismatch")
        require(load_json((root / "node_modules" / name / "package.json").read_bytes())["version"] == version, "installed version mismatch")
    validate_installed(root, lock)
    sources = source_paths(root)
    paths = list(sources)
    for directory in ("node_modules", ".next", "src/generated/prisma-v29"):
        require((root / directory).is_dir() and not (root / directory).is_symlink(), "missing or unsafe build directory")
        for base, dirs, files in os.walk(root / directory, followlinks=False):
            rel = Path(base).relative_to(root).as_posix()
            dirs[:] = sorted(d for d in dirs if rel + "/" + d not in (".next/cache", ".next/dev", ".next/diagnostics", ".next/standalone", "node_modules/.cache"))
            for name in dirs:
                require(not (Path(base) / name).is_symlink(), "directory symlink in build")
            paths.extend(Path(base, name).relative_to(root).as_posix() for name in sorted(files))
    paths = sorted(set(paths))
    entries = {}
    for name in paths:
        safe_path(name)
        path = root / name
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode):
            entries[name] = {"type": "link", "target": os.readlink(path)}
        else:
            require(stat.S_ISREG(mode) and path.stat().st_size <= MAX_FILE, "unsafe build file")
            entries[name] = {"type": "file", "size": path.stat().st_size, "mode": 0o755 if mode & 0o111 else 0o644, "sha256": file_digest(path)}
    validate_entries(entries)
    native = sorted(name for name in entries if name.endswith(".node") or PurePosixPath(name).name.startswith("schema-engine-"))
    require(any(name.endswith(".node") for name in native) and any("schema-engine-" in name for name in native), "native runtime or migration engine missing")
    for name in native:
        with open(root / name, "rb") as f:
            require(f.read(4) == b"\x7fELF", "non-Linux native binary")
    manifest = {"format": FORMAT, "repository": REPOSITORY, "commit": commit,
                "runtime": "next-start", "versions": VERSIONS, "platform": platform,
                "lock_sha256": entries["package-lock.json"]["sha256"], "sources": sources,
                "native_files": native, "release_allowed": False, "files": entries}
    require(not output.exists(), "artifact output already exists")
    output.parent.mkdir(parents=True, exist_ok=True)
    with exclusive_output(output, owned) as out, tarfile.open(fileobj=out, mode="w:gz", format=tarfile.USTAR_FORMAT, dereference=False) as tar:
        raw = json_bytes(manifest)
        info = tarfile.TarInfo(MANIFEST)
        info.size, info.mode = len(raw), 0o644
        tar.addfile(info, io.BytesIO(raw))
        for name in paths:
            info = tar.gettarinfo(str(root / name), arcname=name)
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = ""
            info.mode = entries[name].get("mode", 0o777)
            if info.isfile():
                with open(root / name, "rb") as f:
                    tar.addfile(info, f)
            else:
                tar.addfile(info)
    checksum = file_digest(output)
    read_archive(output, checksum, commit)
    with exclusive_output(output.with_suffix(output.suffix + ".sha256"), owned) as sidecar:
        sidecar.write((checksum + "  " + output.name + "\n").encode())
    print(json.dumps({"commit": commit, "sha256": checksum, "bytes": output.stat().st_size, "files": len(entries), "release_allowed": False}))


def pack(root, output, commit):
    require(not os.path.lexists(output), "artifact output already exists")
    sidecar = output.with_suffix(output.suffix + ".sha256")
    require(not os.path.lexists(sidecar), "artifact digest output already exists")
    owned = []
    try:
        _pack(root, output, commit, owned)
    except Exception:
        # Output creation is exclusive. Only this operation's own regular files
        # may be removed; a preexisting output/sidecar is never overwritten.
        for path, device, inode in owned:
            if os.path.lexists(path):
                info = path.lstat()
                if stat.S_ISREG(info.st_mode) and (info.st_dev, info.st_ino) == (device, inode): path.unlink()
        raise


def validate_entries(entries):
    require(isinstance(entries, dict) and REQUIRED <= entries.keys() and len(entries) <= MAX_FILES, "missing required file or too many entries")
    total = 0
    for name, entry in entries.items():
        safe_path(name)
        require(name != MANIFEST, "reserved manifest path")
        for parent in PurePosixPath(name).parents:
            require(str(parent) not in entries, "file or link used as a parent")
        if entry.get("type") == "file":
            require(set(entry) == {"type", "size", "mode", "sha256"}, "invalid file metadata")
            require(type(entry["size"]) is int and 0 <= entry["size"] <= MAX_FILE and entry["mode"] in (0o644, 0o755), "unsafe size or mode")
            exact_sha(entry["sha256"], 64)
            total += entry["size"]
        else:
            require(set(entry) == {"type", "target"} and entry["type"] == "link", "unsupported archive entry")
            require(name.startswith("node_modules/") and "/.bin/" in name, "only npm bin symlinks are supported")
            target = entry["target"]
            require(isinstance(target, str) and target and not target.startswith("/") and "\\" not in target and ":" not in target, "unsafe symlink target")
            resolved = os.path.normpath(str(PurePosixPath(name).parent / target))
            safe_path(resolved)
            require(resolved.startswith("node_modules/") and entries.get(resolved, {}).get("type") == "file", "symlink escapes or targets a link/missing file")
    require(total <= MAX_BYTES, "artifact exceeds unpacked size limit")


def validate_manifest(m, commit):
    require(set(m) == {"format", "repository", "commit", "runtime", "versions", "platform", "lock_sha256", "sources", "native_files", "release_allowed", "files"}, "invalid manifest shape")
    require(type(m["format"]) is int and m["format"] == FORMAT and m["repository"] == REPOSITORY and m["commit"] == commit and
            m["runtime"] == "next-start" and m["versions"] == VERSIONS and m["release_allowed"] is False, "manifest identity mismatch or release claim")
    validate_platform(m["platform"])
    validate_entries(m["files"])
    require(m["lock_sha256"] == m["files"]["package-lock.json"]["sha256"], "lockfile digest mismatch")
    require(isinstance(m["sources"], list) and len(set(m["sources"])) == len(m["sources"]) and
            all(p in m["files"] for p in m["sources"]), "invalid source inventory")
    native = sorted(p for p in m["files"] if p.endswith(".node") or PurePosixPath(p).name.startswith("schema-engine-"))
    require(m["native_files"] == native and any(p.endswith(".node") for p in native) and any("schema-engine-" in p for p in native), "missing native inventory")



class BoundedGzip:
    def __init__(self, source):
        self.stream = gzip.GzipFile(fileobj=source)
        self.limit = MAX_BYTES + (MAX_FILES + 1) * 1024 + 32 * 1024 ** 2
    def read(self, size=-1):
        remaining = self.limit - self.stream.tell()
        require(remaining >= 0, "decompressed archive limit")
        data = self.stream.read(min(size if size >= 0 else remaining + 1, remaining + 1))
        require(self.stream.tell() <= self.limit, "decompressed archive limit")
        return data
    def seekable(self): return True
    def tell(self): return self.stream.tell()
    def seek(self, offset, whence=0):
        target = offset if whence == 0 else self.tell() + offset if whence == 1 else -1
        require(0 <= target <= self.limit, "decompressed seek limit")
        return self.stream.seek(target)


def read_archive(archive, checksum, commit, destination=None):
    exact_sha(commit)
    exact_sha(checksum, 64)
    require(archive.is_file() and not archive.is_symlink() and archive.stat().st_size <= MAX_BYTES, "unsafe archive file")
    # Keep this descriptor open through verification and extraction: no path reopen race.
    with open_regular(archive) as source:
        h = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
        require(h.hexdigest() == checksum, "external SHA-256 mismatch")
        source.seek(0)
        with tarfile.open(fileobj=BoundedGzip(source), mode="r:") as tar:
            members = {}
            total = 0
            for member in tar:
                safe_path(member.name)
                require(member.name not in members and len(members) < MAX_FILES + 1, "duplicate archive path or too many members")
                require(member.isfile() or member.issym(), "directories, hardlinks, devices and special entries are forbidden")
                require(not member.pax_headers and not member.mode & 0o7000, "extended headers or privileged mode")
                require(0 <= member.size <= MAX_FILE, "oversized member")
                total += member.size
                require(total <= MAX_BYTES + 32 * 1024 ** 2, "archive exceeds unpacked limit")
                members[member.name] = member
            require(MANIFEST in members and members[MANIFEST].isfile() and members[MANIFEST].size <= 32 * 1024 ** 2, "missing or oversized manifest")
            require(members[MANIFEST].mode == 0o644, "unsafe manifest mode")
            m = load_json(tar.extractfile(members[MANIFEST]).read())
            validate_manifest(m, commit)
            require(set(members) == set(m["files"]) | {MANIFEST}, "missing or extra archive file")
            for name, entry in m["files"].items():
                member = members[name]
                if entry["type"] == "link":
                    require(member.issym() and member.linkname == entry["target"] and member.size == 0, "symlink metadata mismatch")
                else:
                    require(member.isfile() and member.size == entry["size"] and member.mode == entry["mode"], "file metadata mismatch")
                    h = hashlib.sha256()
                    with tar.extractfile(member) as f:
                        if name in m["native_files"]:
                            require(f.read(4) == b"\x7fELF", "non-Linux native binary")
                            f.seek(0)
                        for chunk in iter(lambda: f.read(1024 * 1024), b""):
                            h.update(chunk)
                    require(h.hexdigest() == entry["sha256"], "member digest mismatch")
            if destination is not None:
                require(destination.is_dir() and not destination.is_symlink(), "unsafe extraction root")
                # Caller gives a new, private empty directory. No tar.extract/all is used.
                require(not list(destination.iterdir()), "extraction root must be empty")
                capacity(destination, sum(e.get("size", 0) for e in m["files"].values()))
                for name, entry in m["files"].items():
                    path = destination / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    for parent in path.parents:
                        if parent == destination: break
                        parent.chmod(0o755)
                    if entry["type"] == "file":
                        with tar.extractfile(members[name]) as f, open(path, "xb") as out:
                            shutil.copyfileobj(f, out)
                        path.chmod(entry["mode"])
                for name, entry in m["files"].items():
                    if entry["type"] == "link":
                        os.symlink(entry["target"], destination / name)
                (destination / MANIFEST).write_bytes(json_bytes(m))
    return m


def verify_tree(root, m, commit):
    validate_manifest(m, commit)
    validate_installed(root, load_json((root / "package-lock.json").read_bytes()))
    require(git(root, "rev-parse", "HEAD").decode().strip() == commit, "trusted checkout SHA mismatch")
    require(source_paths(root) == sorted(m["sources"]), "trusted source inventory mismatch")
    generated = "src/generated/prisma-v29/"
    for name, entry in m["files"].items():
        require(name.startswith(("node_modules/", ".next/", generated)) or name in m["sources"], "untrusted source addition")
        path = root / name
        for parent in path.parents:
            if parent == root:
                break
            require(parent.is_dir() and not parent.is_symlink(), "unsafe imported parent")
        if entry["type"] == "link":
            require(path.is_symlink() and os.readlink(path) == entry["target"], "imported link differs")
        else:
            require(path.is_file() and not path.is_symlink() and path.stat().st_nlink == 1, "imported file missing or unsafe")
            require(path.stat().st_size == entry["size"] and file_digest(path) == entry["sha256"] and
                    stat.S_IMODE(path.stat().st_mode) == entry["mode"], "imported file differs")
        if name in m["sources"]:
            require(digest(git(root, "show", commit + ":" + name)) == entry["sha256"], "source differs from trusted commit")
    expected_files = set(m["files"])
    actual = set()
    expected_dirs = {str(parent) for name in expected_files for parent in PurePosixPath(name).parents if str(parent) != "."}
    for base, dirs, files in os.walk(root, followlinks=False):
        rel = Path(base).relative_to(root)
        if rel == Path("."):
            dirs[:] = [d for d in dirs if d != ".git"]
        if rel == Path(".next") and "cache" in dirs:
            require(not (root / ".next/cache").is_symlink(), "cache root must not be a link")
            for cache_base, cache_dirs, cache_files in os.walk(root / ".next/cache", followlinks=False):
                for cache_name in cache_dirs + cache_files:
                    cache_entry = Path(cache_base, cache_name)
                    require(not cache_name.startswith(".env") and not cache_entry.is_symlink(), "unexpected environment or link in runtime cache")
            dirs.remove("cache")
        for name in list(dirs):
            path = Path(base, name)
            require(not path.is_symlink() and not name.startswith(".env") and
                    path.relative_to(root).as_posix() in expected_dirs, "unexpected directory or environment path")
        for name in files:
            path = Path(base, name)
            relative = path.relative_to(root).as_posix()
            if relative in (".env.production", "prisma/dev.db"):
                # The caller separately verifies the exact shared targets/metadata.
                require(path.is_symlink(), "shared entry must be a verified link")
                continue
            actual.add(relative)
    require(actual == expected_files, "missing or extra runtime/source/configuration file")
    for name, expected in (("next", VERSIONS["next"]), ("prisma", VERSIONS["prisma"]), ("@prisma/client", VERSIONS["prisma"])):
        require(load_json((root / "node_modules" / name / "package.json").read_bytes())["version"] == expected, "runtime package version mismatch")



def verify_shared(root, shared, allow_absent=False):
    # Metadata only: do not open or hash the production environment/database.
    for name, target in ((".env.production", shared / ".env.production"),
                         ("prisma/dev.db", shared / "prisma/dev.db")):
        path = root / name
        if allow_absent and not os.path.lexists(path):
            continue
        require(path.is_symlink() and os.readlink(path) == str(target), "unexpected shared configuration link")
        require(target.resolve(strict=True) == target and target.is_file() and not target.is_symlink(), "unsafe shared target")
        info = target.stat()
        require(info.st_nlink == 1 and not info.st_mode & 0o022 and info.st_uid in (0, pwd.getpwnam(GIT_USER).pw_uid if GIT_USER else os.getuid()), "unsafe shared file metadata")
        if name == ".env.production":
            require(not info.st_mode & 0o007 and (not GIT_USER or info.st_uid == 0), "shared environment must be root-owned and not world accessible")
        for parent in target.parents:
            if parent == shared.parent: break
            require(parent.is_dir() and not parent.is_symlink() and not parent.stat().st_mode & 0o022 and
                    (name != ".env.production" or not GIT_USER or parent.stat().st_uid == 0), "unsafe shared parent")


def copy_regular(source, destination, mode):
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as src:
        info = os.fstat(src.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= MAX_FILE, "unsafe copy source")
        with open(destination, "xb") as out:
            shutil.copyfileobj(src, out)
        require(os.fstat(src.fileno()).st_size == info.st_size, "copy source changed")
    destination.chmod(mode)


def _materialize(payload, checkout, destination, repository, runtime_user=None):
    # Never merge root writes into an application-owned checkout. Destination is
    # a new root-controlled tree; only verified payload and inert Git data enter.
    destination.chmod(0o755)
    m = load_json((payload / MANIFEST).read_bytes())
    validate_manifest(m, m["commit"])
    for name, entry in m["files"].items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        for parent in path.parents:
            if parent == destination: break
            parent.chmod(0o755)
        if entry["type"] == "file":
            copy_regular(payload / name, path, entry["mode"])
    for name, entry in m["files"].items():
        if entry["type"] == "link": os.symlink(entry["target"], destination / name)
    metadata = destination / ".git"
    metadata.mkdir(mode=0o755)
    metadata.chmod(0o755)
    # Deliberately omit hooks, config, alternates, replace refs and mutable logs.
    gitfd = os.open(checkout / ".git", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    counters = [0, 0]
    def copy_item(parent_fd, item, target, relative):
        require(item not in (".", "..") and "/" not in item and not any(ord(c) < 32 for c in item), "unsafe Git entry")
        info = os.stat(item, dir_fd=parent_fd, follow_symlinks=False)
        require(not stat.S_ISLNK(info.st_mode), "Git metadata symlink forbidden")
        if stat.S_ISDIR(info.st_mode):
            require(relative != "refs/replace", "Git replacement refs forbidden")
            child = os.open(item, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
            try:
                target.mkdir(mode=0o755); target.chmod(0o755)
                for name in os.listdir(child): copy_item(child, name, target / name, relative + "/" + name)
            finally: os.close(child)
        else:
            require(relative != "objects/info/alternates", "Git alternates forbidden")
            fd = os.open(item, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
            with os.fdopen(fd, "rb") as source:
                before = os.fstat(source.fileno())
                require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= MAX_FILE, "unsafe Git data")
                capacity(target.parent, before.st_size)
                counters[0] += 1; counters[1] += before.st_size
                require(counters[0] <= MAX_FILES and counters[1] <= MAX_BYTES, "oversized Git data")
                remaining = before.st_size
                with open(target, "xb") as out:
                    while remaining:
                        chunk = source.read(min(1024 * 1024, remaining))
                        require(chunk, "Git data truncated")
                        remaining -= len(chunk); out.write(chunk)
                    require(not source.read(1), "Git data grew")
                after = os.fstat(source.fileno())
                require((before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                        (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), "Git data changed during snapshot")
                target.chmod(0o644)
    try:
        for item in ("HEAD", "index", "packed-refs", "objects", "refs"):
            try: os.stat(item, dir_fd=gitfd, follow_symlinks=False)
            except FileNotFoundError: continue
            copy_item(gitfd, item, metadata / item, item)
    finally: os.close(gitfd)
    require("\n" not in repository and '"' not in repository and "\\" not in repository, "unsafe repository URL")
    (metadata / "config").write_text('[core]\nrepositoryformatversion = 0\nbare = false\nfilemode = true\n[remote "origin"]\nurl = ' + repository + '\n')
    (metadata / "config").chmod(0o644)
    for base, dirs, files in os.walk(metadata):
        Path(base).chmod(0o755)
    if runtime_user:
        cache = destination / ".next/cache"
        cache.mkdir(mode=0o700)
        account = pwd.getpwnam(runtime_user)
        os.chown(cache, account.pw_uid, account.pw_gid)
    if os.getuid() == 0:
        verify_sealed_tree(destination, runtime_user)
    return m



def materialize(payload, checkout, destination, repository, runtime_user=None):
    require(not os.path.lexists(destination), "staging collision")
    if os.getuid() == 0: trusted_directory(destination.parent)
    destination.mkdir(mode=0o755)
    try:
        return _materialize(payload, checkout, destination, repository, runtime_user)
    except Exception:
        shutil.rmtree(destination)
        raise

def trusted_directory(path):
    require(path.is_dir() and not path.is_symlink() and path.resolve(strict=True) == path, "unsafe trusted directory")
    for p in [path, *path.parents]:
        info = p.lstat()
        require(info.st_uid == 0 and not info.st_mode & 0o022 and not p.is_symlink(), "directory must be root-controlled")


def verify_sealed_tree(root, runtime_user=None):
    trusted_directory(root)
    for base, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            p = Path(base, name)
            info = p.lstat()
            if p == root / ".next/cache" or root / ".next/cache" in p.parents:
                require(runtime_user and info.st_uid == pwd.getpwnam(runtime_user).pw_uid and
                        not info.st_mode & 0o022 and not stat.S_ISLNK(info.st_mode) and
                        (stat.S_ISDIR(info.st_mode) or (stat.S_ISREG(info.st_mode) and info.st_nlink == 1)) and
                        not name.startswith(".env"), "unsafe runtime data cache")
                continue
            require(info.st_uid == 0, "prebuilt tree must be root-owned")
            if stat.S_ISLNK(info.st_mode): continue
            require(not info.st_mode & 0o022, "prebuilt tree writable by non-root")
            require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode), "special file in prebuilt tree")



def migration_inventory(root):
    files = sorted((root / "prisma/migrations").glob("*/migration.sql"))
    require(len(files) == 17, "expected exactly 17 immutable migrations")
    return {p.parent.name: file_digest(p) for p in files}


def migration_ready(root, previous, database, complete=False):
    candidate = migration_inventory(root)
    require(file_digest(root / "prisma/schema.prisma") == file_digest(previous / "prisma/schema.prisma"), "previous Prisma schema differs: explicit recovery assessment required")
    # Fail before writes when code rollback compatibility cannot be proven by
    # identical migration inventories. No automatic down-migration/restore.
    require(candidate == migration_inventory(previous), "previous code migration inventory differs: reviewed recovery plan required")
    require(database.resolve(strict=True) == database and database.is_file() and not database.is_symlink(), "unsafe migration database")
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as db:
        db.execute("PRAGMA query_only=ON")
        rows = db.execute('SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at').fetchall()
        names = []
        for name, checksum, finished, rolled_back in rows:
            require(finished is not None and rolled_back is None and candidate.get(name) == checksum, "failed, unknown or altered applied migration")
            names.append(name)
        require(len(names) == len(set(names)) and names == list(candidate)[:len(names)], "non-prefix applied migration history")
        if complete: require(names == list(candidate), "migration command did not apply the complete inventory")


def write_state(path, commit, previous, phase):
    trusted_directory(path.parent)
    exact_sha(commit)
    exact_sha(previous)
    if os.path.lexists(path): trusted_file(path)
    require(phase in {"PREPARED", "SERVICE_STOPPING", "SERVICE_STOPPED", "MIGRATING", "MIGRATED", "SWITCHING", "SWITCHED", "HEALTHY", "ROLLED_BACK", "MANUAL_REQUIRED"}, "invalid activation phase")
    fd, name = tempfile.mkstemp(prefix=".activation-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(json_bytes(dict(format=1, commit=commit, previous=previous, phase=phase)))
            f.flush(); os.fsync(f.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(name): os.unlink(name)


def check_state(path, current=None, target=None):
    if target: exact_sha(target)
    if not os.path.lexists(path): return
    trusted_file(path)
    value = load_json(path.read_bytes())
    require(set(value) == {"format", "commit", "previous", "phase"} and type(value["format"]) is int and value["format"] == 1, "invalid activation state")
    exact_sha(value["commit"]); exact_sha(value["previous"])
    require(value["phase"] in ("HEALTHY", "ROLLED_BACK"), "unfinished activation: inspect root state, database migration history, current and service before manual recovery")
    if current:
        expected = value["commit"] if value["phase"] == "HEALTHY" else value["previous"]
        require(current.is_symlink() and current.resolve(strict=True).name == expected, "journal/current mismatch: manual recovery required")
        if target:
            require(target == expected, "link-only activation would invalidate the confirmed journal: use the approved full activation lifecycle")


def trusted_file(path):
    require(path.is_file() and not path.is_symlink(), "missing or unsafe trusted metadata")
    for p in [path, *path.parents]:
        s = p.lstat()
        require(s.st_uid == 0 and not s.st_mode & 0o022 and not p.is_symlink(), "trusted metadata must have root-owned, non-writable canonical parents")


def validate_approval(approval, commit, checksum, ref):
    exact_sha(commit)
    exact_sha(checksum, 64)
    expected = {"format": FORMAT, "commit": commit, "artifact_sha256": checksum, "allowed_ref": ref,
                "security_gate": "PASS", "linux_artifact_validation": "PASS", "human_review": "APPROVED"}
    require(type(approval.get("format")) is int and approval == expected, "independent security/Linux/Human Review approval missing or blocked")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    p = sub.add_parser("pack")
    p.add_argument("--source", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--commit", required=True)
    p = sub.add_parser("extract")
    p.add_argument("--archive", type=Path, required=True)
    p.add_argument("--sha256", required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--destination", type=Path, required=True)
    p = sub.add_parser("snapshot")
    p.add_argument("--archive", type=Path, required=True)
    p.add_argument("--sha256", required=True)
    p.add_argument("--destination", type=Path, required=True)
    p = sub.add_parser("capacity")
    p.add_argument("--directory", type=Path, required=True)
    p.add_argument("--manifest", type=Path, required=True)
    p = sub.add_parser("materialize")
    p.add_argument("--payload", type=Path, required=True)
    p.add_argument("--checkout", type=Path, required=True)
    p.add_argument("--destination", type=Path, required=True)
    p.add_argument("--repository", required=True)
    p.add_argument("--runtime-user")
    p = sub.add_parser("verify")
    p.add_argument("--release", type=Path, required=True)
    p.add_argument("--receipt", type=Path, required=True)
    p.add_argument("--shared", type=Path)
    p.add_argument("--git-user")
    p.add_argument("--sha256", required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--allowed-ref", required=True)
    p = sub.add_parser("receipt-identity")
    p.add_argument("--receipt", type=Path, required=True)
    p = sub.add_parser("shared-links")
    p.add_argument("--release", type=Path, required=True)
    p.add_argument("--shared", type=Path, required=True)
    p.add_argument("--git-user")
    p = sub.add_parser("approve")
    p.add_argument("--approval", type=Path, required=True)
    p.add_argument("--sha256", required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--allowed-ref", required=True)
    p = sub.add_parser("legacy")
    p.add_argument("--approval", type=Path, required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--allowed-ref", required=True)
    p = sub.add_parser("migration-ready")
    p.add_argument("--release", type=Path, required=True)
    p.add_argument("--previous", type=Path, required=True)
    p.add_argument("--database", type=Path, required=True)
    p.add_argument("--complete", action="store_true")
    p = sub.add_parser("state")
    p.add_argument("--path", type=Path, required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--previous", required=True)
    p.add_argument("--phase", required=True)
    p = sub.add_parser("check-state")
    p.add_argument("--path", type=Path, required=True)
    p.add_argument("--current", type=Path)
    p.add_argument("--target")
    p = sub.add_parser("platform")
    p.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    if args.mode == "pack":
        pack(args.source, args.output, args.commit)
    elif args.mode == "extract":
        read_archive(args.archive, args.sha256, args.commit, args.destination)
    elif args.mode == "snapshot":
        snapshot(args.archive, args.destination, args.sha256)
    elif args.mode == "capacity":
        m = load_json(args.manifest.read_bytes())
        validate_entries(m["files"])
        capacity(args.directory, sum(e.get("size", 0) for e in m["files"].values()))
    elif args.mode == "materialize":
        materialize(args.payload, args.checkout, args.destination, args.repository, args.runtime_user)
    elif args.mode == "verify":
        global GIT_USER
        GIT_USER = args.git_user
        if GIT_USER:
            trusted_file(args.receipt)
            verify_sealed_tree(args.release, GIT_USER)
        if args.shared:
            verify_shared(args.release, args.shared, allow_absent=True)
        else:
            require(not os.path.lexists(args.release / ".env.production") and not os.path.lexists(args.release / "prisma/dev.db"), "shared links forbidden during import")
        exact_sha(args.commit)
        exact_sha(args.sha256, 64)
        receipt = load_json(args.receipt.read_bytes())
        require(set(receipt) == {"format", "commit", "sha256", "allowed_ref", "remote_head", "manifest"} and type(receipt["format"]) is int and receipt["format"] == FORMAT and
                receipt["commit"] == args.commit and receipt["sha256"] == args.sha256 and receipt["allowed_ref"] == args.allowed_ref, "external receipt mismatch")
        exact_sha(receipt["remote_head"])
        git(args.release, "cat-file", "-e", receipt["remote_head"] + "^{commit}")
        git(args.release, "merge-base", "--is-ancestor", args.commit, receipt["remote_head"])
        verify_tree(args.release, receipt["manifest"], args.commit)
    elif args.mode == "approve":
        trusted_file(args.approval)
        approval = load_json(args.approval.read_bytes())
        validate_approval(approval, args.commit, args.sha256, args.allowed_ref)
    elif args.mode == "receipt-identity":
        trusted_file(args.receipt)
        receipt = load_json(args.receipt.read_bytes())
        exact_sha(receipt["commit"]); exact_sha(receipt["sha256"], 64)
        require(re.fullmatch(r"refs/heads/[A-Za-z0-9][A-Za-z0-9._/-]*", receipt["allowed_ref"]) and
                ".." not in receipt["allowed_ref"] and "//" not in receipt["allowed_ref"] and
                not receipt["allowed_ref"].endswith("/"), "unsafe receipt ref")
        print(receipt["sha256"]); print(receipt["allowed_ref"])
    elif args.mode == "shared-links":
        GIT_USER = args.git_user
        verify_shared(args.release, args.shared)
    elif args.mode == "legacy":
        trusted_file(args.approval)
        exact_sha(args.commit)
        approval = load_json(args.approval.read_bytes())
        require(type(approval.get("format")) is int and approval == dict(format=1, commit=args.commit, allowed_ref=args.allowed_ref, legacy_host_build="APPROVED", human_review="APPROVED"), "legacy host build requires exact independent approval")
    elif args.mode == "migration-ready":
        migration_ready(args.release, args.previous, args.database, args.complete)
    elif args.mode == "state":
        write_state(args.path, args.commit, args.previous, args.phase)
    elif args.mode == "check-state":
        require(not args.target or args.current, "link-only state check requires current")
        check_state(args.path, args.current, args.target)
    else:
        actual = platform_info()
        validate_platform(actual)
        if args.receipt:
            trusted_file(args.receipt)
            require(actual == load_json(args.receipt.read_bytes())["manifest"]["platform"], "host platform/Node ABI/OpenSSL differs from validated artifact")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, tarfile.TarError, subprocess.CalledProcessError, EOFError, sqlite3.Error) as error:
        print("STOP: " + str(error), file=sys.stderr)
        sys.exit(1)
