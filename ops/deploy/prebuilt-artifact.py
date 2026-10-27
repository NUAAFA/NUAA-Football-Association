#!/usr/bin/env python3
"""Trusted, stdlib-only pack/import verifier. Never execute files from an archive."""
import argparse
import contextlib
import functools
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
import time

FORMAT = 1
MANIFEST = "nuaafa-artifact.json"
REPOSITORY = "NUAAFA/NUAA-Football-Association"
VERSIONS = {"node": "22.23.4", "next": "16.4.1", "prisma": "7.9.1"}
SOURCE_ROOTS = {"src", "scripts", "prisma", "public"}
SOURCE_FILES = {".gitignore", "package.json", "package-lock.json", "next.config.ts", "prisma.config.ts", "tsconfig.json"}
REQUIRED = SOURCE_FILES | {
    "src/lib/restore-target.py",
    "prisma/schema.prisma", "src/generated/prisma-v29/index.js",
    "node_modules/next/package.json", "node_modules/next/dist/bin/next",
    "node_modules/prisma/package.json", "node_modules/prisma/build/index.js",
    "node_modules/tsx/dist/cli.mjs", "node_modules/.bin/tsx", "node_modules/.bin/prisma",
    ".next/BUILD_ID", ".next/required-server-files.json", ".next/routes-manifest.json",
    ".next/prerender-manifest.json", ".next/server/app/api/health/route.js",
}
# Historical sealed receipts retain their exact commit-derived source set.
# Only the trusted previous-release verification path uses this base inventory;
# pack/extract/materialize and ordinary candidate verification remain strict.
RECOVERY_REQUIRED = REQUIRED - {"src/lib/restore-target.py"}
MAX_FILES = 100000
MAX_BYTES = 3 * 1024 ** 3
MAX_FILE = 512 * 1024 ** 2
RESERVE = 512 * 1024 ** 2
TIMING_ENABLED = False
TIMING_AGGREGATES = {}


def timing_record(value):
    # Diagnostics contain phase metadata only, never paths, arguments or env.
    try:
        print("NUAAFA_PREBUILT_TIMING " + json.dumps(value, sort_keys=True), file=sys.stderr, flush=True)
    except OSError:
        pass  # A diagnostic sink must not change a validation result.


@contextlib.contextmanager
def measured_phase(phase, aggregate=False):
    if not TIMING_ENABLED:
        yield
        return
    started = time.perf_counter()
    failed = False
    if not aggregate:
        timing_record(dict(phase=phase, event="start", pid=os.getpid(), clock="perf_counter",
                           monotonic_seconds=started))
    try:
        yield
    except BaseException:
        failed = True
        raise
    finally:
        elapsed = time.perf_counter() - started
        if aggregate:
            total = TIMING_AGGREGATES.setdefault(phase, dict(calls=0, failed_calls=0, elapsed_seconds=0.0))
            total["calls"] += 1
            total["failed_calls"] += int(failed)
            total["elapsed_seconds"] += elapsed
        else:
            timing_record(dict(phase=phase, event="end", pid=os.getpid(), clock="perf_counter",
                               elapsed_seconds=elapsed, status="FAIL" if failed else "PASS"))


def measured(phase, aggregate=False):
    def decorate(function):
        @functools.wraps(function)
        def wrapped(*args, **kwargs):
            with measured_phase(phase, aggregate):
                return function(*args, **kwargs)
        return wrapped
    return decorate


def flush_timings():
    if TIMING_ENABLED:
        for phase, value in sorted(TIMING_AGGREGATES.items()):
            timing_record(dict(phase=phase, event="aggregate", pid=os.getpid(), clock="perf_counter", **value))
    TIMING_AGGREGATES.clear()


@contextlib.contextmanager
def timing_session():
    global TIMING_ENABLED, TIMING_AGGREGATES
    previous_enabled, previous_aggregates = TIMING_ENABLED, TIMING_AGGREGATES
    TIMING_ENABLED, TIMING_AGGREGATES = True, {}
    try:
        yield
    finally:
        flush_timings()
        TIMING_ENABLED, TIMING_AGGREGATES = previous_enabled, previous_aggregates


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


@measured("file_sha256_including_io", aggregate=True)
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


@measured("snapshot_copy_and_sha256")
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


@measured("git_source_checks", aggregate=True)
def git(root, *args, stdin_data=None):
    # Execute all repository operations as the application identity, including
    # repeat validation. Never opt out globally from Git ownership protection.
    command = ["/usr/bin/git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null",
               "-c", "core.fsmonitor=false", "-c", "core.attributesFile=/dev/null"]
    if GIT_USER:
        command += ["-c", "safe.directory=" + str(root)]
        command = ["/usr/sbin/runuser", "-u", GIT_USER, "--", *command]
    env = {"PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
           "GIT_TERMINAL_PROMPT": "0", "GIT_NO_REPLACE_OBJECTS": "1", "GIT_OPTIONAL_LOCKS": "0"}
    return subprocess.check_output([*command, "-C", str(root), *args], env=env, input=stdin_data)



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



def build_json(path):
    with open_regular(path) as source:
        before = build_identity(os.fstat(source.fileno()))
        require(before[4] <= 32 * 1024 ** 2, "oversized build metadata")
        data = source.read(32 * 1024 ** 2 + 1)
        require(len(data) == before[4] and build_identity(os.fstat(source.fileno())) == before, "build metadata changed")
    return load_json(data)


def validate_installed(root, lock):
    installed = build_json(root / "node_modules/.package-lock.json")
    for name, value in installed["packages"].items():
        expected = lock["packages"].get(name)
        require(expected is not None and all(value.get(k) == expected.get(k) for k in ("version", "integrity", "resolved")), "installed dependency metadata differs: " + name)
        safe_path(name + "/package.json")
        package = root / name / "package.json"
        require(build_json(package)["version"] == expected["version"], "actual installed package version differs: " + name)
    for name, expected in lock["packages"].items():
        if not name or expected.get("optional") or expected.get("devOptional"): continue
        require(name in installed["packages"], "required locked dependency missing: " + name)


def exclusive_output(path, owned):
    output = open(path, "xb")
    info = os.fstat(output.fileno())
    owned.append((path, info.st_dev, info.st_ino))
    return output


def build_identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def open_build_directory(path):
    """Open every component without following links, including the checkout root."""
    path = Path(path)
    require(path.is_absolute() and ".." not in path.parts, "unsafe build directory path")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for name in path.parts[1:]:
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


class BuildInventory:
    """Virtual materialization: archive regular files at a verified Next alias.

    Never traverse a symlink. The sole accepted directory alias has an exact
    lexical target inside this checkout's locked node_modules package. Its
    target is opened component-by-component with O_NOFOLLOW; every descendant
    must be an ordinary directory or single-link regular file. No staging tree
    or modification of the source checkout is needed.
    """
    EXCLUDED = {".next/cache", ".next/dev", ".next/diagnostics", ".next/standalone", "node_modules/.cache"}
    ALIAS = re.compile(r"\.next/node_modules/@libsql/client-[0-9a-f]{16}")
    TARGET = "node_modules/@libsql/client"
    RAW_TARGET = "../../../node_modules/@libsql/client"
    ESBUILD_PLATFORMS = {("linux", "x86_64"): "linux-x64", ("darwin", "arm64"): "darwin-arm64"}

    def __init__(self, root, lock):
        self.root, self.lock = root, lock
        self.entries, self.origins, self.identities = {}, {}, {}
        self.directories, self.links, self.aliases = {}, {}, []
        self.hardlinks = {}
        self.total = 0

    def prepare_hardlinks(self):
        # esbuild's locked postinstall uses linkSync for this exact binary pair.
        # Pin BOTH internal names and require nlink == 2 BEFORE reading either.
        # A link to any outside/sensitive file necessarily adds a third name or
        # fails the inode-pair check. Tar always emits two independent files.
        platform = self.ESBUILD_PLATFORMS.get((sys.platform, os.uname().machine))
        if not platform or "node_modules/esbuild" not in self.lock["packages"]: return
        pair = ("node_modules/esbuild/bin/esbuild", "node_modules/@esbuild/" + platform + "/bin/esbuild")
        metadata = []
        for origin in pair:
            fd = open_build_directory((self.root / origin).parent)
            try: metadata.append(os.stat(Path(origin).name, dir_fd=fd, follow_symlinks=False))
            finally: os.close(fd)
        if all(info.st_nlink == 1 for info in metadata): return
        package = "node_modules/@esbuild/" + platform
        expected = self.lock["packages"].get(package)
        require(expected and expected["version"] == self.lock["packages"]["node_modules/esbuild"]["version"],
                "unlocked esbuild hardlink pair")
        require(all(stat.S_ISREG(info.st_mode) and info.st_nlink == 2 for info in metadata) and
                build_identity(metadata[0]) == build_identity(metadata[1]), "unsafe esbuild hardlink pair")
        self.hardlinks = {origin: build_identity(info) for origin, info in zip(pair, metadata)}

    def open_file(self, origin):
        if origin not in self.hardlinks: return open_regular(self.root / origin)
        # Validate both pinned names through no-follow parents on every open.
        selected = None
        try:
            for name, identity in self.hardlinks.items():
                parent = open_build_directory((self.root / name).parent)
                try: fd = os.open(Path(name).name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
                finally: os.close(parent)
                try:
                    require(build_identity(os.fstat(fd)) == identity, "esbuild hardlink pair changed: " + name)
                    if name == origin: selected, fd = fd, None
                finally:
                    if fd is not None: os.close(fd)
            return os.fdopen(selected, "rb")
        except BaseException:
            if selected is not None: os.close(selected)
            raise

    def add(self, name, origin, info, target=None):
        safe_path(name)
        safe_path(origin)
        require(name != MANIFEST, "reserved manifest path")
        if name in self.entries:
            require(self.origins[name] == origin and self.identities[name] == build_identity(info), "conflicting build entry")
            return
        require(len(self.entries) < MAX_FILES, "too many build entries")
        if stat.S_ISLNK(info.st_mode):
            require(name == origin and name.startswith("node_modules/") and "/.bin/" in name,
                    "unapproved build symlink: " + name)
            entry = {"type": "link", "target": target}
            self.links[origin] = (build_identity(info), target)
        else:
            require(stat.S_ISREG(info.st_mode) and (info.st_nlink == 1 or
                    self.hardlinks.get(origin) == build_identity(info)) and info.st_size <= MAX_FILE,
                    "unsafe build file or hardlink: " + name)
            require(self.total + info.st_size <= MAX_BYTES, "artifact exceeds unpacked size limit")
            h, size = hashlib.sha256(), 0
            with self.open_file(origin) as src:
                require(build_identity(os.fstat(src.fileno())) == build_identity(info), "build file replaced: " + name)
                while True:
                    chunk = src.read(min(1024 * 1024, info.st_size - size + 1))
                    if not chunk: break
                    size += len(chunk)
                    require(size <= info.st_size, "build file grew: " + name)
                    h.update(chunk)
                require(size == info.st_size and build_identity(os.fstat(src.fileno())) == build_identity(info),
                        "build file changed: " + name)
            entry = {"type": "file", "size": size, "mode": 0o755 if info.st_mode & 0o111 else 0o644, "sha256": h.hexdigest()}
            self.total += size
        self.entries[name], self.origins[name], self.identities[name] = entry, origin, build_identity(info)

    def directory(self, name, origin, fd, nested=False):
        info = os.fstat(fd)
        identity = build_identity(info)
        require(len(self.directories) < MAX_FILES or origin in self.directories, "too many build directories")
        require(origin not in self.directories or self.directories[origin] == identity, "build directory replaced: " + origin)
        self.directories[origin] = identity
        children = []
        with os.scandir(fd) as scan:
            for child in scan:
                require(len(children) < 2 * MAX_FILES + len(self.EXCLUDED), "too many build directory children")
                children.append(child.name)
        for child in sorted(children):
            alias_name, physical = name + "/" + child, origin + "/" + child
            metadata = os.stat(child, dir_fd=fd, follow_symlinks=False)
            if alias_name in self.EXCLUDED:
                require(stat.S_ISDIR(metadata.st_mode), "unsafe excluded build directory: " + alias_name)
                continue
            safe_path(alias_name)
            safe_path(physical)
            if stat.S_ISDIR(metadata.st_mode):
                child_fd = os.open(child, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    require(build_identity(os.fstat(child_fd)) == build_identity(metadata), "build directory replaced: " + physical)
                    self.directory(alias_name, physical, child_fd, nested)
                finally: os.close(child_fd)
            elif stat.S_ISLNK(metadata.st_mode):
                target = os.readlink(child, dir_fd=fd)
                if not nested and self.ALIAS.fullmatch(alias_name):
                    require(target == self.RAW_TARGET, "unsafe Next directory alias target: " + alias_name)
                    # Exactly this relative spelling is accepted; arbitrary '..',
                    # absolute paths and a second symlink hop are never resolved.
                    require(os.path.normpath(str(PurePosixPath(alias_name).parent / target)) == self.TARGET,
                            "Next alias escapes locked dependency")
                    expected = self.lock["packages"].get(self.TARGET)
                    require(expected and isinstance(expected.get("version"), str), "Next alias dependency is not locked")
                    target_fd = open_build_directory(self.root / self.TARGET)
                    try: self.directory(alias_name, self.TARGET, target_fd, nested=True)
                    finally: os.close(target_fd)
                    require(build_json(self.root / self.TARGET / "package.json")["version"] == expected["version"],
                            "Next alias package version mismatch")
                    self.links[physical] = (build_identity(metadata), target)
                    alias_entries = [entry for name, entry in self.entries.items() if name.startswith(alias_name + "/")]
                    self.aliases.append({"path": alias_name, "target": target, "canonical": str(self.root / self.TARGET),
                                         "regular_files": len(alias_entries), "bytes": sum(entry["size"] for entry in alias_entries),
                                         "nested_links": 0, "special_files": 0})
                else:
                    require(not nested, "nested link in Next dependency: " + physical)
                    self.add(alias_name, physical, metadata, target)
            else:
                self.add(alias_name, physical, metadata)
        require(build_identity(os.fstat(fd)) == identity, "build directory changed: " + origin)

    def collect(self, sources):
        self.prepare_hardlinks()
        for name in sources:
            safe_path(name)
            with open_regular(self.root / name) as src:
                self.add(name, name, os.fstat(src.fileno()))
        for directory in ("node_modules", ".next", "src/generated/prisma-v29"):
            fd = open_build_directory(self.root / directory)
            try: self.directory(directory, directory, fd)
            finally: os.close(fd)
        validate_entries(self.entries)
        # Detect USTAR limits before exclusively creating any output. Keep the
        # existing format and reject extended headers rather than relaxing import.
        raw = json_bytes(self.entries)
        require(len(raw) <= 32 * 1024 ** 2, "oversized file manifest")
        for name, entry in self.entries.items():
            self.tarinfo(name, entry).tobuf(format=tarfile.USTAR_FORMAT)
        self.verify()
        return self.entries

    @staticmethod
    def tarinfo(name, entry):
        info = tarfile.TarInfo(name)
        if entry["type"] == "file":
            info.size, info.mode = entry["size"], entry["mode"]
        else:
            info.type, info.linkname, info.mode = tarfile.SYMTYPE, entry["target"], 0o777
        return info

    def verify(self):
        for origin, identity in self.directories.items():
            fd = open_build_directory(self.root / origin)
            try: require(build_identity(os.fstat(fd)) == identity, "build directory changed: " + origin)
            finally: os.close(fd)
        for origin, (identity, target) in self.links.items():
            parent_fd = open_build_directory((self.root / origin).parent)
            try:
                require(build_identity(os.stat(Path(origin).name, dir_fd=parent_fd, follow_symlinks=False)) == identity and
                        os.readlink(Path(origin).name, dir_fd=parent_fd) == target, "build symlink changed: " + origin)
            finally: os.close(parent_fd)

    def write(self, tar):
        self.verify()
        for name, entry in sorted(self.entries.items()):
            info = self.tarinfo(name, entry)
            if entry["type"] == "file":
                with self.open_file(self.origins[name]) as src:
                    require(build_identity(os.fstat(src.fileno())) == self.identities[name], "build file replaced before archive: " + name)
                    tar.addfile(info, src)
                    require(build_identity(os.fstat(src.fileno())) == self.identities[name], "build file changed during archive: " + name)
            else: tar.addfile(info)
        self.verify()


def _pack(root, output, commit, owned):
    exact_sha(commit)
    require(git(root, "rev-parse", "HEAD").decode().strip() == commit, "source SHA mismatch")
    require(not git(root, "status", "--porcelain"), "pack requires a clean exact checkout")
    migration_inventory(root)
    platform = platform_info()
    validate_platform(platform)
    lock = build_json(root / "package-lock.json")
    for name, version in (("next", VERSIONS["next"]), ("prisma", VERSIONS["prisma"]), ("@prisma/client", VERSIONS["prisma"])):
        require(lock["packages"]["node_modules/" + name]["version"] == version, "locked version mismatch")
        require(build_json(root / "node_modules" / name / "package.json")["version"] == version, "installed version mismatch")
    validate_installed(root, lock)
    sources = source_paths(root)
    inventory = BuildInventory(root, lock)
    entries = inventory.collect(sources)
    print("Verified Next directory aliases: " + json.dumps(inventory.aliases), flush=True)
    require(build_json(root / "package-lock.json") == lock, "lockfile changed during pack preflight")
    validate_installed(root, lock)
    for name in sources:
        require(entries[name]["sha256"] == digest(git(root, "show", commit + ":" + name)), "source differs from exact commit: " + name)
    native = sorted(name for name in entries if name.endswith(".node") or PurePosixPath(name).name.startswith("schema-engine-"))
    require(any(name.endswith(".node") for name in native) and any("schema-engine-" in name for name in native), "native runtime or migration engine missing")
    for name in native:
        with open_regular(root / inventory.origins[name]) as f:
            require(build_identity(os.fstat(f.fileno())) == inventory.identities[name], "native build file replaced")
            require(f.read(4) == b"\x7fELF", "non-Linux native binary")
    manifest = {"format": FORMAT, "repository": REPOSITORY, "commit": commit,
                "runtime": "next-start", "versions": VERSIONS, "platform": platform,
                "lock_sha256": entries["package-lock.json"]["sha256"], "sources": sources,
                "native_files": native, "release_allowed": False, "files": entries}
    raw = json_bytes(manifest)
    require(len(raw) <= 32 * 1024 ** 2, "oversized manifest")
    require(git(root, "rev-parse", "HEAD").decode().strip() == commit and not git(root, "status", "--porcelain"),
            "source checkout changed during pack preflight")
    print("Pack preflight: " + json.dumps({"commit": commit, "files": len(entries), "bytes": inventory.total,
          "max_file_bytes": max(entry.get("size", 0) for entry in entries.values()),
          "file_links": [{"path": name, "target": entry["target"]} for name, entry in entries.items() if entry["type"] == "link"],
          "hardlink_pair": list(inventory.hardlinks), "native_files": native,
          "manifest_bytes": len(raw), "manifest_sha256": digest(raw)}), flush=True)
    require(not os.path.lexists(output), "artifact output already exists")
    output.parent.mkdir(parents=True, exist_ok=True)
    capacity(output.parent, inventory.total + (len(entries) + 1) * 1024 + len(raw))
    with exclusive_output(output, owned) as out, tarfile.open(fileobj=out, mode="w:gz", format=tarfile.USTAR_FORMAT, dereference=False) as tar:
        info = tarfile.TarInfo(MANIFEST)
        info.size, info.mode = len(raw), 0o644
        tar.addfile(info, io.BytesIO(raw))
        inventory.write(tar)
    checksum = file_digest(output)
    read_archive(output, checksum, commit)
    inventory.verify()
    require(git(root, "rev-parse", "HEAD").decode().strip() == commit and not git(root, "status", "--porcelain"),
            "source checkout changed during pack")
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
    except BaseException:
        # Output creation is exclusive. Only this operation's own regular files
        # may be removed; a preexisting output/sidecar is never overwritten.
        for path, device, inode in owned:
            if os.path.lexists(path):
                info = path.lstat()
                if stat.S_ISREG(info.st_mode) and (info.st_dev, info.st_ino) == (device, inode): path.unlink()
        raise


def validate_entries(entries, *, recovery=False):
    required = RECOVERY_REQUIRED if recovery else REQUIRED
    require(isinstance(entries, dict) and required <= entries.keys() and len(entries) <= MAX_FILES, "missing required file or too many entries")
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


def validate_manifest(m, commit, *, recovery=False):
    require(set(m) == {"format", "repository", "commit", "runtime", "versions", "platform", "lock_sha256", "sources", "native_files", "release_allowed", "files"}, "invalid manifest shape")
    require(type(m["format"]) is int and m["format"] == FORMAT and m["repository"] == REPOSITORY and m["commit"] == commit and
            m["runtime"] == "next-start" and m["versions"] == VERSIONS and m["release_allowed"] is False, "manifest identity mismatch or release claim")
    validate_platform(m["platform"])
    validate_entries(m["files"], recovery=recovery)
    require(m["lock_sha256"] == m["files"]["package-lock.json"]["sha256"], "lockfile digest mismatch")
    require(isinstance(m["sources"], list) and len(set(m["sources"])) == len(m["sources"]) and
            all(p in m["files"] for p in m["sources"]), "invalid source inventory")
    native = sorted(p for p in m["files"] if p.endswith(".node") or PurePosixPath(p).name.startswith("schema-engine-"))
    require(m["native_files"] == native and any(p.endswith(".node") for p in native) and any("schema-engine-" in p for p in native), "missing native inventory")



class BoundedGzip:
    def __init__(self, source):
        self.stream = gzip.GzipFile(fileobj=source)
        self.limit = MAX_BYTES + (MAX_FILES + 1) * 1024 + 32 * 1024 ** 2
    @measured("gzip_read_including_decompression", aggregate=True)
    def read(self, size=-1):
        remaining = self.limit - self.stream.tell()
        require(remaining >= 0, "decompressed archive limit")
        data = self.stream.read(min(size if size >= 0 else remaining + 1, remaining + 1))
        require(self.stream.tell() <= self.limit, "decompressed archive limit")
        return data
    def seekable(self): return True
    def tell(self): return self.stream.tell()
    @measured("gzip_seek_including_decompression", aggregate=True)
    def seek(self, offset, whence=0):
        target = offset if whence == 0 else self.tell() + offset if whence == 1 else -1
        require(0 <= target <= self.limit, "decompressed seek limit")
        if TIMING_ENABLED and target < self.tell():
            counter = TIMING_AGGREGATES.setdefault("gzip_backward_seek_requests", dict(calls=0, requested_rewind_bytes=0, kind="counter"))
            counter["calls"] += 1
            counter["requested_rewind_bytes"] += self.tell() - target
        return self.stream.seek(target)


@measured("archive_validation_and_extraction")
def read_archive(archive, checksum, commit, destination=None):
    exact_sha(commit)
    exact_sha(checksum, 64)
    require(archive.is_file() and not archive.is_symlink() and archive.stat().st_size <= MAX_BYTES, "unsafe archive file")
    # Keep this descriptor open through verification and extraction: no path reopen race.
    with open_regular(archive) as source:
        with measured_phase("archive_sha256_including_io"):
            h = hashlib.sha256()
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                h.update(chunk)
            require(h.hexdigest() == checksum, "external SHA-256 mismatch")
        source.seek(0)
        with tarfile.open(fileobj=BoundedGzip(source), mode="r:") as tar:
            members = {}
            total = 0
            with measured_phase("archive_member_inventory"):
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
            with measured_phase("manifest_validation"):
                m = load_json(tar.extractfile(members[MANIFEST]).read())
                validate_manifest(m, commit)
                require(set(members) == set(m["files"]) | {MANIFEST}, "missing or extra archive file")
            with measured_phase("member_digest_validation"):
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
                with measured_phase("payload_extraction"):
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


@measured("trusted_source_blob_verification")
def verify_source_blobs(root, m, commit):
    # Bound batch memory/process overhead while checking every exact source blob.
    # The caller already reconciled this source set with the trusted commit.
    pending, declared_bytes = [], 0

    def verify_batch(names):
        queries = "".join(commit + ":" + name + "\n" for name in names).encode()
        # Check actual Git sizes before requesting payload bytes, so a mismatched
        # manifest cannot turn a small declared batch into a large allocation.
        headers = git(root, "cat-file", "--batch-check", stdin_data=queries).splitlines(keepends=True)
        require(len(headers) == len(names), "incomplete trusted source batch metadata")
        for name, line in zip(names, headers):
            header = re.fullmatch(rb"[0-9a-f]{40} blob ([0-9]+)\n", line)
            require(header is not None and int(header.group(1)) == m["files"][name]["size"], "trusted source blob type or size mismatch")
        result = io.BytesIO(git(root, "cat-file", "--batch", stdin_data=queries))
        for name, expected_header in zip(names, headers):
            entry = m["files"][name]
            require(result.readline() == expected_header, "trusted source blob identity changed")
            data = result.read(entry["size"])
            require(len(data) == entry["size"] and result.read(1) == b"\n", "incomplete trusted source blob")
            require(digest(data) == entry["sha256"], "source differs from trusted commit")
        require(result.read(1) == b"", "unexpected trusted source batch output")

    for name in m["sources"]:
        entry = m["files"][name]
        require(entry["type"] == "file", "trusted source must be a regular file")
        if pending and (len(pending) >= 64 or declared_bytes + entry["size"] > 32 * 1024 ** 2):
            verify_batch(pending)
            pending, declared_bytes = [], 0
        pending.append(name)
        declared_bytes += entry["size"]
    if pending:
        verify_batch(pending)


@measured("final_tree_verification")
def verify_tree(root, m, commit, *, recovery=False):
    validate_manifest(m, commit, recovery=recovery)
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
    verify_source_blobs(root, m, commit)
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



@measured("file_and_git_materialization")
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


@measured("sealed_tree_verification")
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



# Root-installed policy: immutable V2.10 baseline plus ONE reviewed forward migration.
BASELINE_COMMIT = "704bf0af9e9b7f538cfbf6d3a76ec5f4148190e8"
BASELINE_MIGRATIONS = {
    "20260722013757_init_referee_center": "1589849243a5eb38854b4015451311902546efb2665a475ec2233ba666d115b8",
    "20260723124500_add_referee_sessions": "8f7d0cce36625dcdcbf7c513ace3df4705740e0de35b1a82a248fa30d3ca1ae9",
    "20260730090000_referee_operations_v24": "f9a05130ae5333f66c0e1d39782595c4938b8de7d753e9d0ec0de73a6b9e796e",
    "20260819120000_referee_admin_r1": "03a1478598974d78412f710c5c14fda6f76d2c042c46f047758ae6cc9d8d2f1a",
    "20260820120000_referee_business_model_fix2": "5560d9b278e13fd09ae31fdc5f6172b52b2dc6a80de38dea22a759ab1d1b7e00",
    "20260820160000_referee_acceptance_fix3": "86ef1830d4160a4d010768b9bfa3763924e4867292b9480c440e5fcb394b010a",
    "20260823091228_unified_admin_r1_foundation": "93b0cb1a2254e80c553cb0f078885732c7809d716c98e7a17d67aa84a2533a8b",
    "20260823160000_referee_admission_application_intake": "b00ddf247c2398658da90ac7d16faeb83207133c6eb4d36be46029cd2a09d6d3",
    "20260824120000_referee_admission_eligibility": "3294dda53b8eb406dc13207e8fee0f7bc247c63d87120f7d74374d4be91d1168",
    "20260913120000_public_competition_dynamic_r1": "9fe0f84bf59e9d28baf42185da5f1ccbabc72a00cc496b254753290c6d067273",
    "20260914210000_admin_operations_r2": "70d945d52fd8ade49a39a8a06b3c8a51c547c79e3df8c8629d7fa9a4a910d8e0",
    "20260922120000_public_competition_true_dynamic_r3": "e66406a77b1d8e138fecfced90e99c5a5cc56388676067fd757dacae4295b37c",
    "20260923120000_dynamic_public_team_directory_r1": "c198822e068474512ad83a548eb0d87d5c9c9c7b09ec08c6a5e40488067c8945",
    "20260928090000_ops_r3_1": "c111bc382b08aaf15871bc90c2d8c1ea3a3ff3c97d8eb60012af00e42b1b1e42",
    "20260929090000_ops_r3_1_1": "d45e7de7efbef60f170ac13a0f6b3a4f844c56cf1cd3060b648ecf0bb8eeff51",
    "20261001090000_ops_r3_1_2": "6a2864e28bc0f2ab5d15955fcedb7310a7e195dd6102556bd01f2d6db169d14c",
    "20261001120000_ops_r3_1_3": "1a565a27bb57165d2a9e7ec533ff2d3815bcba9544a4b24d9e491265b8b6fa8c"
}
FORWARD_MIGRATION = {"20261020120000_admin_history_grade": "c8b30b58016a3b8a4725bdfca205d021dbe6151e2dd339795d4713ca9e6fd1ee"}
COMPETITION_REPORT_MIGRATION = {"20261023090000_competition_reports": "fe425250684d011a6258434f16075b88365dc01302b61b241c94436f27645796"}
RESOURCE_DOCUMENT_MIGRATION = {"20261023230000_resource_documents": "8b15e5469261a3f02a2ea885bba372832d806cee8093bc192a0ae571f675f962"}
LEAGUE_MIGRATION = {"20261026120000_competition_league": "2e0bff73273147127a9043cde853c44e51c3ac98ff1ff97707c0d798c82afae1"}
SCHEMA_SHA256 = {17: "074cb16d0aab22b2561a5d173c8cff4e871dd53b43e5c95b36e00ac7148049e4",
                 18: "01d07a18e616190eb3b6676d09d7b1de72283d6ce1ed85c796a0aef232987cfa",
                 19: "29d0857a194c985541fa795b7d8638b4a837c41f3b9dccb177f9a7b25b75eec4",
                 20: "0f5fd3899bbf26d27067b313e59a7de93afdb003d51ede96d8d099aa5a6f0cdc",
                 21: "5814eb65387223432b2dccfb79da6ff4b95ab5a122f0f3c71aa9123ede5f4b37"}
PRE_MIGRATION_PHASES = {"PREPARED", "SERVICE_STOPPING", "SERVICE_STOPPED"}


def migration_inventory(root):
    require(root.is_absolute() and root.resolve(strict=True) == root, "noncanonical migration release")
    directory = root / "prisma/migrations"
    require(directory.is_dir() and not directory.is_symlink(), "unsafe migration directory")
    files = sorted(directory.glob("*/migration.sql"))
    expected = dict(BASELINE_MIGRATIONS)
    if len(files) in (18, 19, 20, 21):
        expected.update(FORWARD_MIGRATION)
    if len(files) in (19, 20, 21):
        expected.update(COMPETITION_REPORT_MIGRATION)
    if len(files) in (20, 21):
        expected.update(RESOURCE_DOCUMENT_MIGRATION)
    if len(files) == 21:
        expected.update(LEAGUE_MIGRATION)
    require(len(files) == len(expected), "only exact immutable 17 or reviewed 18/19/20/21 migrations accepted")
    require(sorted(p.name for p in directory.iterdir()) == sorted([*expected, "migration_lock.toml"]), "unknown or missing migration entry")
    require((directory / "migration_lock.toml").read_bytes() == b'# Please do not edit this file manually\n# It should be added in your version-control system (e.g., Git)\nprovider = "sqlite"\n', "migration provider lock differs")
    actual = {}
    for p in files:
        require(p.is_file() and not p.is_symlink() and not p.parent.is_symlink(), "unsafe migration member")
        actual[p.parent.name] = file_digest(p)
    require(actual == expected and list(actual) == list(expected), "unknown, reordered or modified immutable migration")
    require((root / "prisma/schema.prisma").is_file() and not (root / "prisma/schema.prisma").is_symlink(), "unsafe Prisma schema")
    require(file_digest(root / "prisma/schema.prisma") == SCHEMA_SHA256[len(expected)], "Prisma schema outside reviewed 17/18/19/20/21 delta")
    return actual


@contextlib.contextmanager
def readonly_database(database):
    require(database.resolve(strict=True) == database and database.is_file() and not database.is_symlink(), "unsafe migration database")
    db = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=0)
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        yield db
        require(db.total_changes == 0, "read-only database guard wrote data")
    finally:
        db.close()


def database_fingerprint(database):
    # Coherent transaction; retain only a digest, never dump production cells.
    h = hashlib.sha256()
    with readonly_database(database) as db:
        for line in db.iterdump():
            h.update(line.encode()); h.update(b"\n")
    return h.hexdigest()


def validate_database_structure(db, root, applied):
    # Derive the exact SQLite schema from checksum-verified SQL, not candidate metadata.
    with sqlite3.connect(":memory:") as expected:
        for name in applied:
            expected.executescript((root / "prisma/migrations" / name / "migration.sql").read_text())
        query = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY type,name"
        require(db.execute(query).fetchall() == expected.execute(query).fetchall(), "database structure outside exact applied migration inventory")
    require(db.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "database integrity failed")
    require(not db.execute("PRAGMA foreign_key_check").fetchall(), "database foreign keys failed")


def migration_ready(root, previous, database, complete=False):
    candidate, old = migration_inventory(root), migration_inventory(previous)
    require(len(candidate) >= len(old) and list(candidate.items())[:len(old)] == list(old.items()), "unreviewed migration transition or automatic downgrade")
    with readonly_database(database) as db:
        rows = db.execute('SELECT migration_name, checksum, started_at, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at,rowid').fetchall()
        names = []
        for name, checksum, started, finished, rolled_back in rows:
            require(started is not None and finished is not None and rolled_back is None and candidate.get(name) == checksum, "failed, unknown or altered applied migration")
            names.append(name)
        require(len(names) == len(set(names)) and names == list(candidate)[:len(names)], "non-prefix or reordered applied migration history")
        require(len(names) in {len(old), len(candidate)}, "database must have the COMPLETE previous or candidate history")
        if complete:
            require(names == list(candidate), "migration command did not apply the complete inventory")
        validate_database_structure(db, root, names)


def recovery_ready(path, previous, database, commit, phase):
    trusted_file(path)
    value = load_json(path.read_bytes())
    require(value.get("format") == 2 and value.get("phase") == phase and phase in PRE_MIGRATION_PHASES,
            "migration started, unknown or inconsistent durable activation state; old runtime forbidden")
    require(value.get("commit") == commit and value.get("previous") == previous.name, "recovery identity differs")
    exact_sha(value.get("database_sha256"), 64)
    migration_ready(previous, previous, database, complete=True)
    require(database_fingerprint(database) == value["database_sha256"], "database changed since pre-migration proof; old runtime forbidden")


def runtime_ready(root, database, state):
    # Root-owned, read-only-to-app journal exposes identities/phases, no configuration.
    trusted_file(state)
    value = load_json(state.read_bytes())
    keys = {"format", "commit", "previous", "phase"}
    require(type(value.get("format")) is int and ((value["format"] == 1 and set(value) == keys) or
            (value["format"] == 2 and set(value) == keys | {"database_sha256"})), "invalid startup journal")
    exact_sha(value["commit"]); exact_sha(value["previous"])
    phase = value["phase"]
    if phase in PRE_MIGRATION_PHASES:
        require(root.name == value["previous"], "candidate cannot start before migration")
        recovery_ready(state, root, database, value["commit"], phase)
    else:
        require(phase in {"HEALTHY", "ROLLED_BACK", "SWITCHED"}, "unfinished migration/manual state forbids startup")
        expected = value["previous"] if phase == "ROLLED_BACK" else value["commit"]
        require(root.name == expected, "startup journal/release identity differs")
    migration_ready(root, root, database, complete=True)


def write_state(path, commit, previous, phase, database_sha256=None):
    trusted_directory(path.parent)
    exact_sha(commit)
    exact_sha(previous)
    if os.path.lexists(path): trusted_file(path)
    require(phase in {"PREPARED", "SERVICE_STOPPING", "SERVICE_STOPPED", "MIGRATING", "MIGRATED", "SWITCHING", "SWITCHED", "HEALTHY", "ROLLED_BACK", "MANUAL_REQUIRED"}, "invalid activation phase")
    fd, name = tempfile.mkstemp(prefix=".activation-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            value = dict(format=1, commit=commit, previous=previous, phase=phase)
            if database_sha256 is not None:
                exact_sha(database_sha256, 64)
                value.update(format=2, database_sha256=database_sha256)
            f.write(json_bytes(value))
            os.fchmod(f.fileno(), 0o644)  # Identities/phase/digest only; root remains sole writer.
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
    keys = {"format", "commit", "previous", "phase"}
    require(type(value.get("format")) is int and ((value["format"] == 1 and set(value) == keys) or
            (value["format"] == 2 and set(value) == keys | {"database_sha256"})), "invalid activation state")
    if value["format"] == 2: exact_sha(value["database_sha256"], 64)
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
    global TIMING_ENABLED
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timings", action="store_true", help="Emit optional phase timings to stderr; validation is unchanged")
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
    p.add_argument("--recovery", action="store_true", help="Verify an existing previous sealed receipt against its own exact source history")
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
    p = sub.add_parser("database-fingerprint")
    p.add_argument("--database", type=Path, required=True)
    p = sub.add_parser("recovery-ready")
    p.add_argument("--path", type=Path, required=True)
    p.add_argument("--previous", type=Path, required=True)
    p.add_argument("--database", type=Path, required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--phase", required=True)
    p = sub.add_parser("runtime-ready")
    p.add_argument("--release", type=Path, required=True)
    p.add_argument("--database", type=Path, required=True)
    p.add_argument("--state", type=Path, required=True)
    p = sub.add_parser("state")
    p.add_argument("--path", type=Path, required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--previous", required=True)
    p.add_argument("--phase", required=True)
    p.add_argument("--database-sha256")
    p = sub.add_parser("check-state")
    p.add_argument("--path", type=Path, required=True)
    p.add_argument("--current", type=Path)
    p.add_argument("--target")
    p = sub.add_parser("platform")
    p.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    TIMING_ENABLED = args.timings
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
        # Mode is selected by the root-controlled deployer call site, never by
        # a manifest version/claim. Exact Git source inventory/blob verification
        # still rejects omission of a helper tracked by this release's commit.
        verify_tree(args.release, receipt["manifest"], args.commit, recovery=args.recovery)
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
    elif args.mode == "database-fingerprint":
        print(database_fingerprint(args.database))
    elif args.mode == "recovery-ready":
        recovery_ready(args.path, args.previous, args.database, args.commit, args.phase)
    elif args.mode == "runtime-ready":
        runtime_ready(args.release, args.database, args.state)
    elif args.mode == "state":
        write_state(args.path, args.commit, args.previous, args.phase, args.database_sha256)
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
    finally:
        flush_timings()
