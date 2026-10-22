#!/usr/bin/env python3
"""Small synthetic archives and real local Git/Bash; never touch /srv or live data."""
import contextlib
import copy
import ctypes
import errno
from datetime import datetime, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("artifact", REPO / "ops/deploy/prebuilt-artifact.py")
A = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(A)
PLATFORM = {"system": "Linux", "machine": "x86_64", "os_id": "ubuntu", "os_version": "24.04",
            "libc": ["glibc", "2.39"], "node": "22.23.2", "node_abi": "127", "openssl": "3.5.7"}
DEFAULT_EVIDENCE = None


def run(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, stderr=subprocess.STDOUT).decode().strip()


def case_evidence(case_name, result, inputs, started_at, script="", expected_status=0):
    """Reserve a new directory atomically; never replace an earlier invocation."""
    if not re.fullmatch(r"[A-Za-z0-9_-]+", case_name):
        raise ValueError("unsafe evidence case name")
    evidence = os.environ.get("NUAAFA_TEST_EVIDENCE")
    if not evidence:
        global DEFAULT_EVIDENCE
        if DEFAULT_EVIDENCE is None:
            DEFAULT_EVIDENCE = tempfile.mkdtemp(prefix="nuaafa-case-evidence-")
            Path(DEFAULT_EVIDENCE).chmod(0o755)
            print("Synthetic case evidence retained: " + DEFAULT_EVIDENCE, file=sys.stderr)
        evidence = DEFAULT_EVIDENCE
    Path(evidence).mkdir(parents=True, exist_ok=True)
    destination = Path(tempfile.mkdtemp(prefix=case_name + "-", dir=evidence))
    destination.chmod(0o755)  # CI runner can read root-created synthetic evidence.
    metadata = dict(case=case_name, started_at=started_at,
                    finished_at=datetime.now(timezone.utc).isoformat(),
                    exit_code=result.returncode, expected_exit_code=expected_status,
                    timed_out=getattr(result, "timed_out", False),
                    process_group=getattr(result, "process_group", None),
                    cleanup=getattr(result, "cleanup", None),
                    exception=getattr(result, "exception", None),
                    cleanup_exception=getattr(result, "cleanup_exception", None),
                    lifecycle=getattr(result, "lifecycle", None),
                    platform=sys.platform, uid=os.getuid(), inputs=inputs)
    for name, value in (("stdout.log", result.stdout), ("stderr.log", result.stderr),
                        ("input.sh", script), ("result.json", json.dumps(metadata, indent=2) + "\n")):
        with (destination / name).open("x") as output:
            output.write(value)
        (destination / name).chmod(0o644)
    return destination


def bounded_diagnostic(value, limit=2000):
    text = str(value)
    for key, secret in os.environ.items():
        if len(secret) >= 4 and re.search(r"SECRET|TOKEN|PASSWORD|KEY|COOKIE|AUTH|DATABASE_URL", key, re.I):
            text = text.replace(secret, "[REDACTED]")
    text = re.sub(r"(?i)((?:password|secret|token|authorization|api[_-]?key)\s*[:=]\s*)([^\s,;]+)",
                  r"\1[REDACTED]", text)
    text = re.sub(r"(https?://)[^/@\s]+@", r"\1[REDACTED]@", text)
    return text[:limit]


def emit_failure_diagnostic(case_name, result):
    lifecycle = copy.deepcopy(getattr(result, "lifecycle", {}))
    for key in ("before_cleanup", "reaped"):
        lifecycle[key] = lifecycle.get(key, [])[:8]
        for child in lifecycle[key]:
            child["name"] = bounded_diagnostic(child.get("name", ""), 80)
    summary = dict(case=case_name, evidence_path=bounded_diagnostic(getattr(result, "evidence_path", "NOT SAVED"), 512),
                   command=[bounded_diagnostic(arg, 160) for arg in result.args[:32]],
                   exit_code=result.returncode, cleanup=bounded_diagnostic(getattr(result, "cleanup", None), 500),
                   cleanup_exception=bounded_diagnostic(getattr(result, "cleanup_exception", None), 500),
                   lifecycle=lifecycle, stdout=bounded_diagnostic(result.stdout),
                   stderr=bounded_diagnostic(result.stderr))
    if len(json.dumps(summary)) > 7000:
        summary["command"] = summary["command"][:6] + ["..."] + summary["command"][-10:]
        summary["stdout"], summary["stderr"] = summary["stdout"][:500], summary["stderr"][:1000]
        lifecycle["before_cleanup"], lifecycle["reaped"] = lifecycle["before_cleanup"][:3], lifecycle["reaped"][:3]
        summary["truncated"] = True
    print("Test failure diagnostic: " + json.dumps(summary), file=sys.stderr)


@contextlib.contextmanager
def descendant_reaper():
    # Linux must reap orphaned grandchildren itself, rather than depending on
    # the runner's PID 1. Reap only owned children while the leader is pinned.
    previous = ctypes.c_int()
    libc = None
    if sys.platform == "linux":
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(37, ctypes.byref(previous), 0, 0, 0) != 0 or libc.prctl(36, 1, 0, 0, 0) != 0:
            raise OSError(ctypes.get_errno(), "cannot enable test descendant reaping")
    original_error = None
    try:
        yield
    except BaseException as error:
        original_error = error
        raise
    finally:
        if libc is not None and libc.prctl(36, previous.value, 0, 0, 0) != 0:
            restore_error = OSError(ctypes.get_errno(), "cannot restore descendant reaping")
            if original_error is not None:
                original_error.reaper_error = restore_error
                raise original_error from restore_error
            raise restore_error


def darwin_group_members(pgid, live_only=False):
    # Darwin killpg reports EPERM for an empty group whose zombie leader is
    # still waitable. Inspect this ONE pinned group; never global PID lookup.
    query = subprocess.run(["/bin/ps", "-g", str(pgid), "-o", "pid=,stat="],
                           env={"PATH": "/usr/bin:/bin"}, capture_output=True, text=True, timeout=5)
    if query.returncode not in (0, 1) or query.stderr:
        raise RuntimeError("cannot inspect owned Darwin group: " + query.stderr)
    members = [line.split() for line in query.stdout.splitlines()]
    return [int(pid) for pid, state in members if not live_only or not state.startswith("Z")]


def group_exists(pgid):
    if sys.platform == "darwin":
        return bool(darwin_group_members(pgid))
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False


def child_exited(pid):
    """Observe only our direct child without releasing its PID/PGID identity."""
    options = os.WEXITED | os.WNOHANG | os.WNOWAIT
    if hasattr(os, "waitid"):
        info = os.waitid(os.P_PID, pid, options)
        return info is not None and info.si_pid == pid
    if sys.platform != "darwin":
        raise RuntimeError("WNOWAIT child observation is unavailable")
    # Apple sys/signal.h: siginfo_t begins with signo, errno, code, pid,
    # uid and status. Use an oversized aligned buffer; only read the PID.
    info = (ctypes.c_int * 64)()
    libc = ctypes.CDLL(None, use_errno=True)
    waitid = libc.waitid
    waitid.argtypes = [ctypes.c_uint, ctypes.c_uint, ctypes.c_void_p, ctypes.c_int]
    waitid.restype = ctypes.c_int
    if waitid(os.P_PID, pid, ctypes.byref(info), options) != 0:
        number = ctypes.get_errno()
        if number == errno.ECHILD:  # Identity has already been released.
            raise ChildProcessError(number, os.strerror(number))
        raise OSError(number, os.strerror(number))
    return info[3] == pid


def wait_child_exit(process, timeout):
    deadline = time.monotonic() + timeout
    while not child_exited(process.pid):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise subprocess.TimeoutExpired(process.args, timeout)
        time.sleep(min(0.02, remaining))


def wait_after_fixture_ready(paths, readiness_timeout=10):
    """TEST ONLY: start an injected timeout after fixture initialization.

    Used only by the fault-injection tests below and the Linux harness test.
    recorded_run already owns the Popen/session before this callback runs.
    Keep the leader unreaped and leave all operational/cleanup budgets intact.
    """
    ready = tuple(map(Path, paths))
    if not ready or readiness_timeout <= 0:
        raise ValueError("bounded fixture readiness paths and timeout required")
    original_wait = wait_child_exit
    first = True
    def wait(process, timeout):
        nonlocal first
        if first:
            # Consume before waiting: setup errors must immediately enter the
            # real cleanup waits, never start another readiness wait there.
            first = False
            deadline = time.monotonic() + readiness_timeout
            while not all(path.is_file() for path in ready):
                if child_exited(process.pid):  # WNOWAIT; no poll/wait/reap.
                    raise RuntimeError("fixture exited before readiness")
                if time.monotonic() >= deadline:
                    raise RuntimeError("fixture readiness timeout")
                time.sleep(0.01)
        return original_wait(process, timeout)
    return wait


def owned_group_children(pgid):
    # Linux subreaper adoption is inspected only among OUR direct children.
    # Never enumerate global processes or reap by a possibly reused PGID.
    if sys.platform != "linux":
        return []
    children = Path("/proc/self/task") / str(os.getpid()) / "children"
    result = []
    for value in children.read_text().split():
        pid = int(value)
        if pid != pgid and os.getpgid(pid) == pgid:
            result.append(pid)
    return result


def owned_child_metadata(pgid, pid):
    # Only an unreaped child enumerated from OUR /proc task may be inspected.
    value = Path("/proc") / str(pid) / "stat"
    text = value.read_text()
    end = text.rindex(")")
    fields = text[end + 2:].split()
    metadata = dict(pid=int(text.split(" ", 1)[0]), name=text[text.index("(") + 1:end],
                    state=fields[0], ppid=int(fields[1]), pgid=int(fields[2]),
                    start_ticks=int(fields[19]))
    if metadata["pid"] != pid or pid == pgid or metadata["ppid"] != os.getpid() or metadata["pgid"] != pgid:
        raise RuntimeError("descendant identity differs from the owned child/group")
    return metadata


def terminate_group(process):
    """Last group signal precedes ANY leader wait/poll/communicate/reaping."""
    pgid = process.pid  # Popen(start_new_session=True) is owned by recorded_run.
    if getattr(process, "cleanup_started", False):
        raise RuntimeError("refusing repeated process group cleanup")
    process.cleanup_started = True
    process.lifecycle = dict(leader_pid=pgid, leader_pgid=pgid, leader_ppid=os.getpid(),
                             leader_exit_observed=False, before_cleanup=[], reaped=[],
                             signals=[], cleanup_complete=False, completed_descendants_proven=False)

    def trusted_leader():
        if pgid <= 1 or pgid == os.getpgrp() or process.returncode is not None:
            raise RuntimeError("refusing untrusted/reaped or runner process group")
        exited = child_exited(pgid)  # ECHILD refuses even with stale returncode.
        # Darwin no longer exposes getpgid/getsid for zombies. The unconsumed
        # direct-child wait identity still pins the start_new_session PID.
        if not exited:
            try:
                if os.getpgid(pgid) != pgid or os.getsid(pgid) != pgid:
                    raise RuntimeError("child is not the owned session/group leader")
            except ProcessLookupError:
                if not child_exited(pgid):
                    raise  # Darwin may transition to zombie during this check.

    def send(sig):
        trusted_leader()
        event = dict(signal=signal.Signals(sig).name, outcome="attempted")
        process.lifecycle["signals"].append(event)
        try:
            os.killpg(pgid, sig)
            event["outcome"] = "sent"
        except ProcessLookupError:
            event["outcome"] = "absent"  # The unreaped child still pins its ID.
        except PermissionError:
            if sys.platform != "darwin" or darwin_group_members(pgid, live_only=True):
                event["outcome"] = "failed"
                raise  # Never turn a real signaling failure into success.
            event["outcome"] = "empty Darwin group"

    trusted_leader()
    failures = []
    process.descendants_seen = False
    process.descendants_reaped = 0
    try:
        process.lifecycle["leader_exit_observed"] = child_exited(pgid)
        if process.lifecycle["leader_exit_observed"]:
            if sys.platform == "linux":
                process.lifecycle["before_cleanup"] = [owned_child_metadata(pgid, pid) for pid in owned_group_children(pgid)]
                process.descendants_seen = bool(process.lifecycle["before_cleanup"])
            else:
                process.descendants_seen = any(pid != pgid for pid in darwin_group_members(pgid))
        send(signal.SIGTERM)
        try:
            wait_child_exit(process, 2)
        except subprocess.TimeoutExpired:
            pass
    except BaseException as error:
        failures.append(error)
    finally:
        # An exited but UNREAPED child still reserves the numeric PGID. Even
        # interrupt/failure during the TERM grace period must attempt KILL.
        send(signal.SIGKILL)
        process.group_signals_finished = True

    wait_child_exit(process, 5)
    deadline = time.monotonic() + 5
    while True:
        children = (owned_group_children(pgid) if sys.platform == "linux"
                    else [pid for pid in darwin_group_members(pgid) if pid != pgid])
        if not children:
            break
        if sys.platform == "linux":
            for pid in children:
                metadata = owned_child_metadata(pgid, pid)
                reaped, status = os.waitpid(pid, os.WNOHANG)
                process.descendants_reaped += bool(reaped)
                if reaped:
                    metadata["wait_status"] = status
                    process.lifecycle["reaped"].append(metadata)
        # Darwin PID 1 reaps orphans. Keep our zombie leader pinned until the
        # targeted group contains no other member, including orphan zombies.
        if time.monotonic() >= deadline:
            raise RuntimeError("owned descendants remain after group KILL")
        time.sleep(0.02)
    # No group signal, group query or group-based wait follows leader reaping.
    process.wait(timeout=5)
    if failures:
        raise RuntimeError("process cleanup failed: " + "; ".join(map(str, failures))) from failures[0]
    process.lifecycle["cleanup_complete"] = True
    before, reaped = process.lifecycle["before_cleanup"], process.lifecycle["reaped"]
    # A zombie is already dead BEFORE TERM/KILL. Require every such identity
    # to be reaped, no newly discovered child, and a completed empty-group check.
    # Live/unknown descendants and all cleanup failures retain the failure gate.
    process.lifecycle["completed_descendants_proven"] = (
        sys.platform == "linux" and process.lifecycle["leader_exit_observed"]
        and all(child["state"] == "Z" for child in before)
        and len(before) == len(reaped) and all(child["state"] == "Z" for child in reaped)
        and {(child["pid"], child["start_ticks"]) for child in before}
        == {(child["pid"], child["start_ticks"]) for child in reaped})


def recorded_run(args, case_name, inputs, script="", expected_status=0, timeout=120, **kwargs):
    started_at = datetime.now(timezone.utc).isoformat()
    process = None
    result = subprocess.CompletedProcess(args, None, "", "")
    try:
        # File-backed output avoids pipe deadlocks without communicate()'s
        # implicit wait/reap (including its KeyboardInterrupt fast wait).
        with descendant_reaper(), tempfile.TemporaryFile(mode="w+", errors="replace") as stdout, \
             tempfile.TemporaryFile(mode="w+", errors="replace") as stderr:
            try:
                try:
                    process = subprocess.Popen(args, stdout=stdout, stderr=stderr,
                                               text=True, start_new_session=True, **kwargs)
                    result.process_group = process.pid
                    wait_child_exit(process, timeout)
                except BaseException as error:
                    result.timed_out = isinstance(error, subprocess.TimeoutExpired)
                    try:
                        if process is not None:
                            terminate_group(process)
                            result.cleanup = "process group removed and children reaped"
                    except BaseException as cleanup_error:
                        result.cleanup = "FAILED: " + str(cleanup_error)
                        result.cleanup_exception = type(cleanup_error).__name__ + ": " + str(cleanup_error)
                        error.cleanup_error = cleanup_error
                        raise error from cleanup_error  # Retain original type/identity.
                    raise
                else:
                    try:
                        terminate_group(process)
                        result.cleanup = "process group removed and children reaped"
                    except BaseException as cleanup_error:
                        result.cleanup = "FAILED: " + str(cleanup_error)
                        result.cleanup_exception = type(cleanup_error).__name__ + ": " + str(cleanup_error)
                        raise
                    if (process.descendants_seen or process.descendants_reaped) and not process.lifecycle["completed_descendants_proven"]:
                        raise RuntimeError("command left descendants after exit")
            finally:
                stdout.seek(0); stderr.seek(0)
                result.stdout, result.stderr = stdout.read(), stderr.read()
                result.returncode = process.returncode if process is not None else None
                result.lifecycle = getattr(process, "lifecycle", {})
    except BaseException as error:
        if process is not None:
            result.returncode = process.returncode
        result.exception = type(error).__name__ + ": " + str(error)
        result.stderr += "\n" + result.exception
        if getattr(result, "cleanup_exception", None):
            result.stderr += "\ncleanup failed: " + result.cleanup_exception
        if isinstance(error, subprocess.TimeoutExpired):
            error.output, error.stderr = result.stdout, result.stderr
        try:
            result.evidence_path = case_evidence(case_name, result, inputs, started_at, script, expected_status)
        except BaseException as evidence_error:
            error.evidence_error = evidence_error
            raise error from evidence_error
        try:
            emit_failure_diagnostic(case_name, result)
        except BaseException as diagnostic_error:
            error.diagnostic_error = diagnostic_error
            raise error from diagnostic_error
        raise
    result.evidence_path = case_evidence(case_name, result, inputs, started_at, script, expected_status)
    return result


def shared_snapshot(case):
    """Synthetic DB/env bytes, links, modes and owners, including SQLite sidecars."""
    root = case / "shared"
    paths = [root, *sorted(root.rglob("*"))] if root.exists() else []
    result = {}
    for path in paths:
        info = path.lstat()
        result[str(path.relative_to(case))] = dict(uid=info.st_uid, gid=info.st_gid,
            mode=info.st_mode, link=os.readlink(path) if path.is_symlink() else None,
            sha256=A.file_digest(path) if path.is_file() and not path.is_symlink() else None)
    return result


def initialize_legacy_database(db, source):
    for name in A.BASELINE_MIGRATIONS:
        db.executescript((source / "prisma/migrations" / name / "migration.sql").read_text())
    db.execute("CREATE TABLE _prisma_migrations (migration_name TEXT, checksum TEXT, started_at INTEGER, finished_at TEXT, rolled_back_at TEXT)")
    values = dict(id="synthetic-ref", name="Synthetic", publicCode="SYNTHETIC001", status="ACTIVE", studentId="SYNTHETIC001")
    for _,name,typ,required,default,pk in db.execute('PRAGMA table_info("Referee")'):
        if name not in values and required and default is None:
            values[name] = 0 if "INT" in typ or "BOOL" in typ else "synthetic"
    db.execute('INSERT INTO Referee (' + ','.join('"'+k+'"' for k in values) + ') VALUES (' + ','.join('?' for _ in values) + ')', list(values.values()))


class ArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="nuaafa-artifact-test-")
        cls.root = Path(cls.temp.name).resolve()
        cls.source = cls.root / "source"
        cls.source.mkdir()
        run("git", "init", "--initial-branch=main", str(cls.source))
        run("git", "-C", str(cls.source), "config", "user.name", "Synthetic Artifact Test")
        run("git", "-C", str(cls.source), "config", "user.email", "artifact@example.invalid")
        (cls.source / ".gitignore").write_text("node_modules/\n.next/\nsrc/generated/\n.env*\nprisma/*.db*\n")
        for name in (A.SOURCE_FILES - {".gitignore"}) | {"prisma/schema.prisma", "scripts/synthetic.mjs", "public/synthetic.txt", "src/synthetic.ts"}:
            p = cls.source / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("synthetic\n")
        packages = {"node_modules/" + n: {"version": v, "integrity": "synthetic-locked"} for n, v in (("next", "16.4.1"), ("prisma", "7.9.1"), ("@prisma/client", "7.9.1"))}
        (cls.source / "package-lock.json").write_bytes(A.json_bytes({"packages": packages}))
        (cls.source / "package.json").write_text('{"name":"synthetic","private":true}\n')
        # Real immutable SQL/schema, with wholly synthetic business rows.
        for name in A.BASELINE_MIGRATIONS:
            rel = "prisma/migrations/" + name + "/migration.sql"
            p = cls.source / rel
            p.parent.mkdir(parents=True)
            p.write_bytes(subprocess.check_output(["git", "-C", str(REPO), "show", A.BASELINE_COMMIT + ":" + rel]))
        for rel in ("prisma/schema.prisma", "prisma/migrations/migration_lock.toml"):
            (cls.source / rel).write_bytes(subprocess.check_output(["git", "-C", str(REPO), "show", A.BASELINE_COMMIT + ":" + rel]))
        # Real repositories also track files deliberately excluded from runtime.
        for name in ("README.md", "AGENTS.md", "docs/operations/example.md", ".github/workflows/example.yml", "ops/deploy/example"):
            p = cls.source / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("synthetic excluded tracked file\n")
        run("git", "-C", str(cls.source), "add", ".")
        run("git", "-C", str(cls.source), "commit", "-m", "synthetic prior release")
        cls.prior = run("git", "-C", str(cls.source), "rev-parse", "HEAD")
        (cls.source / "src/synthetic.ts").write_text("synthetic old release\n")
        run("git", "-C", str(cls.source), "add", ".")
        run("git", "-C", str(cls.source), "commit", "-m", "synthetic old release")
        cls.old = run("git", "-C", str(cls.source), "rev-parse", "HEAD")
        # The historical commits genuinely predate this source member.
        helper_source = cls.source / "src/lib/restore-target.py"
        helper_source.parent.mkdir(parents=True, exist_ok=True)
        helper_source.write_text("synthetic-runtime\n")
        (cls.source / "src/synthetic.ts").write_text("synthetic candidate\n")
        run("git", "-C", str(cls.source), "add", ".")
        run("git", "-C", str(cls.source), "commit", "-m", "synthetic candidate")
        cls.commit = run("git", "-C", str(cls.source), "rev-parse", "HEAD")
        for name in A.REQUIRED - A.SOURCE_FILES - {"src/lib/restore-target.py", "prisma/schema.prisma", "node_modules/.bin/tsx", "node_modules/.bin/prisma"}:
            p = cls.source / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("synthetic-runtime\n")
        for name in ("next", "prisma", "@prisma/client"):
            p = cls.source / "node_modules" / name / "package.json"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(A.json_bytes({"version": packages["node_modules/" + name]["version"]}))
        (cls.source / "node_modules/.package-lock.json").write_bytes(A.json_bytes({"packages": packages}))
        for name in ("node_modules/@libsql/linux-x64-gnu/index.node", "node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x"):
            p = cls.source / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b"\x7fELFsynthetic-not-executable\n")
        bins = cls.source / "node_modules/.bin"
        bins.mkdir(exist_ok=True)
        (bins / "tsx").symlink_to("../tsx/dist/cli.mjs")
        (bins / "prisma").symlink_to("../prisma/build/index.js")
        cls.archive = cls.root / "valid.tar.gz"
        with patch.object(A, "platform_info", return_value=PLATFORM), contextlib.redirect_stdout(io.StringIO()):
            A.pack(cls.source, cls.archive, cls.commit)
        cls.checksum = A.file_digest(cls.archive)
        cls.manifest = A.read_archive(cls.archive, cls.checksum, cls.commit)
        old_source = cls.root / "old-source"
        run("git", "clone", "--no-hardlinks", str(cls.source), str(old_source))
        run("git", "-C", str(old_source), "checkout", "--detach", cls.old)
        for directory in ("node_modules", ".next", "src/generated/prisma-v29"):
            shutil.copytree(cls.source / directory, old_source / directory, symlinks=True)
        cls.old_archive = cls.root / "old-valid.tar.gz"
        # Bootstrap the prior certified fixture with its historical inventory.
        # CURRENT verification is not patched during validate_recovery_release.
        cls.historical_helper = cls.root / "historical-prebuilt-artifact.py"
        historical_source = (REPO / "ops/deploy/prebuilt-artifact.py").read_text()
        assert historical_source.count('    "src/lib/restore-target.py",\n') == 1
        cls.historical_helper.write_text(historical_source.replace('    "src/lib/restore-target.py",\n', '', 1))
        with patch.object(A, "REQUIRED", A.RECOVERY_REQUIRED), patch.object(A, "platform_info", return_value=PLATFORM), contextlib.redirect_stdout(io.StringIO()):
            A.pack(old_source, cls.old_archive, cls.old)
        cls.old_checksum = A.file_digest(cls.old_archive)
        assert not (old_source / "src/lib/restore-target.py").exists()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def mutate(self, callback):
        out = self.root / "mutated.tar.gz"
        with tarfile.open(self.archive) as src, tarfile.open(out, "w:gz", format=tarfile.USTAR_FORMAT) as dst:
            for member in src:
                data = src.extractfile(member).read() if member.isfile() else None
                result = callback(member, data)
                if result is not None:
                    member, data = result
                    if data is not None:
                        member.size = len(data)
                    dst.addfile(member, io.BytesIO(data) if data is not None else None)
        return out

    def reject_mutation(self, callback):
        archive = self.mutate(callback)
        with self.assertRaises((ValueError, tarfile.TarError)):
            A.read_archive(archive, A.file_digest(archive), self.commit)

    def test_valid_extract_and_locked_source(self):
        dest = self.root / "valid-extraction"
        dest.mkdir()
        A.read_archive(self.archive, self.checksum, self.commit, dest)
        run("git", "clone", "--no-hardlinks", "--no-checkout", str(self.source), str(self.root / "git-copy"))
        shutil.move(str(self.root / "git-copy/.git"), dest / ".git")
        run("git", "-C", str(dest), "reset", "--mixed", self.commit)
        (dest / A.MANIFEST).unlink()
        A.verify_tree(dest, self.manifest, self.commit)
        (dest / ".next/extra.js").write_text("untrusted")
        with self.assertRaises(ValueError):
            A.verify_tree(dest, self.manifest, self.commit)
        (dest / ".next/extra.js").unlink()
        (dest / ".next/BUILD_ID").unlink()
        with self.assertRaises(ValueError):
            A.verify_tree(dest, self.manifest, self.commit)

    def test_wrong_sha(self):
        with self.assertRaises(ValueError):
            A.read_archive(self.archive, self.checksum, self.old)

    def test_prior_next_version_requires_sealed_recovery_not_new_import(self):
        source = self.root / "legacy-next-source"
        shutil.copytree(self.source, source, symlinks=True)
        lock = A.load_json((source / "package-lock.json").read_bytes())
        lock["packages"]["node_modules/next"]["version"] = "16.3.8"
        for name in ("package-lock.json", "node_modules/.package-lock.json"):
            (source / name).write_bytes(A.json_bytes(lock))
        (source / "node_modules/next/package.json").write_text('{"version":"16.3.8"}')
        run("git", "-C", str(source), "add", "package-lock.json")
        run("git", "-C", str(source), "commit", "-m", "synthetic sealed prior Next version")
        commit = run("git", "-C", str(source), "rev-parse", "HEAD")
        archive = self.root / "legacy-next.tar.gz"
        dest = self.root / "legacy-next-extracted"
        dest.mkdir()
        with patch.object(A, "VERSIONS", A.RECOVERY_VERSIONS), patch.object(A, "platform_info", return_value=PLATFORM), contextlib.redirect_stdout(io.StringIO()):
            A.pack(source, archive, commit)
            manifest = A.read_archive(archive, A.file_digest(archive), commit, dest)
        with self.assertRaises(ValueError):
            A.read_archive(archive, A.file_digest(archive), commit)
        git_copy = self.root / "legacy-next-git"
        run("git", "clone", "--no-hardlinks", "--no-checkout", str(source), str(git_copy))
        shutil.move(str(git_copy / ".git"), dest / ".git")
        run("git", "-C", str(dest), "reset", "--mixed", commit)
        (dest / A.MANIFEST).unlink()
        A.verify_tree(dest, manifest, commit, recovery=True)
        with self.assertRaises(ValueError):
            A.verify_tree(dest, manifest, commit)
        forged = copy.deepcopy(manifest)
        forged["versions"]["next"] = "16.4.0"
        with self.assertRaises(ValueError):
            A.validate_manifest(forged, commit, recovery=True)

    def test_independent_checksum_required(self):
        for value in ("", "f" * 64):
            with self.subTest(value=value), self.assertRaises(ValueError):
                A.read_archive(self.archive, value, self.commit)

    def test_bounded_snapshot_and_disk_reserve(self):
        out = self.root / "private-copy.tar.gz"
        A.snapshot(self.archive, out, self.checksum)
        self.assertEqual(A.file_digest(out), self.checksum)
        with self.assertRaises(ValueError): A.snapshot(self.archive, self.root / "wrong-copy.tar.gz", "f" * 64)
        with patch.object(A.shutil, "disk_usage", return_value=shutil._ntuple_diskusage(100, 99, 1)):
            with self.assertRaises(ValueError): A.capacity(self.root, 1)
        link = self.root / "input-link.tar.gz"
        link.symlink_to(self.archive)
        with self.assertRaises(OSError): A.snapshot(link, self.root / "unsafe-copy.tar.gz", self.checksum)

    def test_corruption(self):
        self.reject_mutation(lambda m, d: (m, b"corrupt") if m.name == ".next/BUILD_ID" else (m, d))

    def test_missing_file(self):
        self.reject_mutation(lambda m, d: None if m.name == ".next/BUILD_ID" else (m, d))

    def test_bad_paths(self):
        for bad in ("../escape", "/tmp/escape", "src/../../escape", "src//escape", "src/./escape", "C:\\escape", "src/evil\nname", ".git/config", ".env.production", "prisma/dev.db", "public/uploads/user.png", "node_modules/.npmrc"):
            with self.subTest(path=bad):
                def mutate(m, d):
                    if m.name == ".next/BUILD_ID": m.name = bad
                    return m, d
                self.reject_mutation(mutate)

    def test_bad_links_and_types(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE, tarfile.DIRTYPE):
            with self.subTest(kind=kind):
                def mutate(m, d):
                    if m.name == ".next/BUILD_ID":
                        m.type, m.linkname, m.size = kind, "../../outside", 0
                        return m, None
                    return m, d
                self.reject_mutation(mutate)

    def test_privileged_modes(self):
        def mutate(m, d):
            if m.name == ".next/BUILD_ID": m.mode |= 0o4000
            return m, d
        self.reject_mutation(mutate)

    def test_duplicate_member_and_json_key(self):
        out = self.root / "duplicate.tar.gz"
        with tarfile.open(self.archive) as src, tarfile.open(out, "w:gz", format=tarfile.USTAR_FORMAT) as dst:
            for member in src:
                data = src.extractfile(member).read() if member.isfile() else None
                dst.addfile(member, io.BytesIO(data) if data is not None else None)
                if member.name == ".next/BUILD_ID": dst.addfile(member, io.BytesIO(data))
        with self.assertRaises(ValueError): A.read_archive(out, A.file_digest(out), self.commit)
        self.reject_mutation(lambda m, d: (m, d.replace(b'"format":1', b'"format":1,"format":1')) if m.name == A.MANIFEST else (m, d))

    def test_manifest_release_claim_and_native_inventory(self):
        for field, value in (("release_allowed", True), ("native_files", []), ("runtime", "standalone")):
            with self.subTest(field=field):
                m = copy.deepcopy(self.manifest)
                m[field] = value
                with self.assertRaises(ValueError): A.validate_manifest(m, self.commit)

    def test_symlink_parent_and_escape(self):
        for target in ("/etc/passwd", "../../../../etc/passwd", "../.bin/prisma", "../missing"):
            m = copy.deepcopy(self.manifest)
            m["files"]["node_modules/.bin/tsx"]["target"] = target
            with self.subTest(target=target), self.assertRaises(ValueError): A.validate_manifest(m, self.commit)
        m = copy.deepcopy(self.manifest)
        m["files"]["node_modules/.bin/tsx/evil"] = m["files"][".next/BUILD_ID"]
        with self.assertRaises(ValueError): A.validate_manifest(m, self.commit)

    def test_platform_and_approval_fail_closed(self):
        for key, value in (("system", "Darwin"), ("machine", "aarch64"), ("node", "24.0.0"), ("node_abi", "999"), ("os_version", "22.04")):
            p = dict(PLATFORM, **{key: value})
            with self.subTest(key=key), self.assertRaises(ValueError): A.validate_platform(p)
        approval = dict(format=1, commit=self.commit, artifact_sha256=self.checksum, allowed_ref="refs/heads/main", security_gate="PASS", linux_artifact_validation="PASS", human_review="APPROVED")
        A.validate_approval(approval, self.commit, self.checksum, "refs/heads/main")
        for field, value in (("security_gate", "FAIL"), ("linux_artifact_validation", "NOT RUN"), ("human_review", "PENDING"), ("commit", self.old), ("artifact_sha256", "f" * 64)):
            with self.subTest(field=field), self.assertRaises(ValueError): A.validate_approval(dict(approval, **{field: value}), self.commit, self.checksum, "refs/heads/main")
        with self.assertRaises(ValueError): A.trusted_file(self.archive)

    def test_dirty_source_and_wrong_installed_version(self):
        with patch.object(A, "platform_info", return_value=PLATFORM):
            (self.source / "src/synthetic.ts").write_text("dirty source")
            try:
                with self.assertRaises(ValueError): A.pack(self.source, self.root / "bad-pack.tar.gz", self.commit)
            finally:
                run("git", "-C", str(self.source), "checkout", "--", "src/synthetic.ts")
            p = self.source / "node_modules/next/package.json"
            original = p.read_bytes()
            p.write_text('{"version":"wrong"}')
            try:
                with self.assertRaises(ValueError): A.pack(self.source, self.root / "bad-pack.tar.gz", self.commit)
            finally: p.write_bytes(original)

    def extracted_checkout(self, name):
        dest = self.root / name
        dest.mkdir()
        A.read_archive(self.archive, self.checksum, self.commit, dest)
        (dest / A.MANIFEST).unlink()
        meta = self.root / (name + "-git")
        run("git", "clone", "--no-hardlinks", "--no-checkout", str(self.source), str(meta))
        shutil.move(str(meta / ".git"), dest / ".git")
        run("git", "-C", str(dest), "reset", "--mixed", self.commit)
        return dest

    def test_all_environment_and_extra_paths_rejected(self):
        dest = self.extracted_checkout("environment-matrix")
        for name in (".env", ".env.local", ".env.production.local", ".env.test", "src/.env.local", "scripts/injected.mjs", "extra.config.js"):
            with self.subTest(name=name):
                p = dest / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text("synthetic only")
                try:
                    with self.assertRaises(ValueError): A.verify_tree(dest, self.manifest, self.commit)
                finally: p.unlink()
        p = dest / ".env.production.local"
        p.mkdir()
        with self.assertRaises(ValueError): A.verify_tree(dest, self.manifest, self.commit)
        p.rmdir()
        p.symlink_to(self.source / "package.json")
        with self.assertRaises(ValueError): A.verify_tree(dest, self.manifest, self.commit)
        p.unlink()
        shared = self.root / "shared-contract"
        (shared / "prisma").mkdir(parents=True)
        (shared / ".env.production").write_text("SYNTHETIC_CONFIG_ONLY=1")
        (shared / ".env.production").chmod(0o600)
        (shared / "prisma/dev.db").write_text("synthetic metadata only")
        for name in (".env.production", "prisma/dev.db"):
            (dest / name).symlink_to(shared / name)
        A.verify_shared(dest, shared)
        A.verify_tree(dest, self.manifest, self.commit)
        (shared / ".env.production").chmod(0o666)
        with self.assertRaises(ValueError): A.verify_shared(dest, shared)
        (shared / ".env.production").chmod(0o600)
        (dest / ".env.production").unlink()
        (dest / ".env.production").symlink_to(self.source / "package.json")
        with self.assertRaises(ValueError): A.verify_shared(dest, shared)

    def test_bash_real_validation_functions_in_conditions(self):
        # Portable stat shim reads REAL filesystem metadata. No root-validator mock.
        script = r'''source "$TEST_REPO/ops/deploy/nuaafa-deploy"
stat() {
 "$PYTHON" - "$2" "$3" <<'PY'
import os,sys,stat,pwd
s=os.lstat(sys.argv[2]);print({'%u':str(s.st_uid),'%a':oct(stat.S_IMODE(s.st_mode))[2:],'%U':pwd.getpwuid(s.st_uid).pw_name}[sys.argv[1]])
PY
}
verify_root_metadata /usr/bin/env || exit 80
prebuilt_helper="$UNTRUSTED"
if run_prebuilt_helper platform; then exit 81; fi
student_id_preflight_node="$UNTRUSTED_NODE"
if verify_prebuilt_platform; then exit 87; fi
if validate_exact_directory "$MISSING" missing; then exit 82; fi
if validate_allowed_ref refs/heads/../unsafe; then exit 83; fi
if validate_canonical_shared_file "$UNTRUSTED_LINK" unsafe; then exit 84; fi
if verify_build_artifact "$MISSING"; then exit 85; fi
if fetch_and_verify_reachability "$MISSING" bad refs/heads/main; then exit 86; fi
prebuilt_start=/usr/bin/env; current_link=/synthetic/current; deploy_user=synthetic
# This metadata test has no synthetic OS account. Isolate only the process
# invocation for the public contract marker; root metadata checks remain real.
# The installed-old-contract test exercises rejection by the actual deployer.
run_as_deploy_user() {
 [ "$#" = 4 ] && [ "$1" = "$prebuilt_python" ] && [ "$2" = -I ] &&
 [ "$3" = "$prebuilt_start" ] && [ "$4" = --contract-version ] || return 1
 echo NUAAFA_STARTUP_CONTRACT=V2.10X-PREBUILT-3
}
systemctl() {
 case "$4" in
  User) echo "$deploy_user";;
  WorkingDirectory) echo "$current_link";;
  FragmentPath) echo /usr/bin/env;;
  DropInPaths) echo "${DROPIN:-/usr/bin/env}";;
  ExecStart) echo "{ path=$prebuilt_start ; argv[]=$prebuilt_start ; ignore_errors=no ; }";;
  Environment) [ "${BAD_ENV:-}" != yes ] || echo 'LD_PRELOAD=/unreviewed';;
 esac
 return 0
}
verify_service_contract || exit 88
BAD_ENV=yes
if verify_service_contract; then exit 89; fi
BAD_ENV=no; DROPIN="$UNTRUSTED"
if verify_service_contract; then exit 90; fi
'''
        helper = self.root / "must-not-execute.py"
        sentinel = self.root / "helper-executed"
        helper.write_text("from pathlib import Path;Path(" + repr(str(sentinel)) + ").touch()")
        node = self.root / "must-not-execute-node"
        node.write_text('#!/bin/sh\ntouch "' + str(sentinel) + '"\necho v22.23.2\n')
        node.chmod(0o755)
        link = self.root / "untrusted-link"
        link.symlink_to(helper)
        env = dict(os.environ, TEST_REPO=str(REPO), PYTHON=sys.executable, UNTRUSTED=str(helper), UNTRUSTED_NODE=str(node), MISSING=str(self.root / "missing"), UNTRUSTED_LINK=str(link))
        result = subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(sentinel.exists())

    def test_decompressed_extensions_bounded_and_partial_copy_removed(self):
        with patch.object(A, "MAX_BYTES", 64), patch.object(A, "MAX_FILES", 0):
            import gzip
            bomb = self.root / "padding-bomb.gz"
            bomb.write_bytes(gzip.compress(b"x" * (33 * 1024 ** 2)))
            with open(bomb, "rb") as f, self.assertRaises(ValueError): A.BoundedGzip(f).read()
        out = self.root / "failed-private-copy.gz"
        with self.assertRaises(ValueError): A.snapshot(self.archive, out, "f" * 64)
        self.assertFalse(out.exists())

    def test_git_metadata_snapshot_rejects_escaping_links(self):
        payload = self.root / "git-link-payload"
        payload.mkdir()
        A.read_archive(self.archive, self.checksum, self.commit, payload)
        checkout = self.root / "git-link-checkout"
        run("git", "clone", "--no-hardlinks", str(self.source), str(checkout))
        outside = self.root / "outside-synthetic"
        outside.mkdir(); (outside / "canary").write_text("never import")
        (checkout / ".git/objects/injected").symlink_to(outside)
        with self.assertRaises(ValueError): A.materialize(payload, checkout, self.root / "git-link-stage", str(self.source))

    def test_failed_pack_cleanup_and_existing_output_preserved(self):
        output = self.root / "failed-pack.tar.gz"
        with patch.object(A, "platform_info", return_value=PLATFORM), patch.object(A, "read_archive", side_effect=ValueError("synthetic final verification failure")):
            with self.assertRaises(ValueError): A.pack(self.source, output, self.commit)
        self.assertFalse(output.exists())
        output.write_bytes(b"unknown preexisting output")
        with self.assertRaises(ValueError): A.pack(self.source, output, self.commit)
        self.assertEqual(output.read_bytes(), b"unknown preexisting output")
        output.unlink()
        sidecar = output.with_suffix(output.suffix + ".sha256")
        sidecar.write_text("unknown preexisting digest")
        with self.assertRaises(ValueError): A.pack(self.source, output, self.commit)
        self.assertEqual(sidecar.read_text(), "unknown preexisting digest")

    def test_migration_inventory_and_history_fail_closed(self):
        dest = self.extracted_checkout("migration-readiness")
        dbpath = self.root / "migration-readiness.db"
        with sqlite3.connect(dbpath) as db:
            initialize_legacy_database(db, self.source)
        with self.assertRaises(ValueError): A.migration_ready(dest, self.source, dbpath)
        with self.assertRaises(ValueError): A.migration_ready(dest, self.source, dbpath, complete=True)
        with sqlite3.connect(dbpath) as db:
            for i, (name, sha) in enumerate(A.migration_inventory(dest).items()):
                db.execute("INSERT INTO _prisma_migrations VALUES (?,?,?,'synthetic',NULL)", (name, sha, i))
        A.migration_ready(dest, self.source, dbpath, complete=True)
        with sqlite3.connect(dbpath) as db: db.execute("UPDATE _prisma_migrations SET finished_at=NULL WHERE started_at=0")
        with self.assertRaises(ValueError): A.migration_ready(dest, self.source, dbpath)
        first = next((dest / "prisma/migrations").glob("*/migration.sql"))
        first.write_text("modified migration")
        with self.assertRaises(ValueError): A.migration_ready(dest, self.source, dbpath)


    def deploy_case(self, case_name, extra, changed_fixture=False, initial_import=True, previous_commit=None,
                    deployer=None, helper=None, expected_status=0):
        case = Path(tempfile.mkdtemp(prefix=case_name + "-", dir=self.root))
        (case / "releases").mkdir()
        (case / "shared/prisma").mkdir(parents=True)
        (case / "shared/.env.production").write_text("SYNTHETIC=1\n")
        (case / "shared/.env.production").chmod(0o600)
        with sqlite3.connect(case / "shared/prisma/dev.db") as db:
            initialize_legacy_database(db, self.source)
            for i, (migration_name, checksum) in enumerate(A.migration_inventory(self.source).items()):
                db.execute("INSERT INTO _prisma_migrations VALUES (?,?,?,'synthetic',NULL)", (migration_name, checksum, i))
        previous_commit = previous_commit or self.old
        old = case / "releases" / previous_commit
        run("git", "clone", "--no-hardlinks", str(self.source), str(old))
        run("git", "-C", str(old), "checkout", "--detach", previous_commit)
        (old / ".next").mkdir()
        (old / ".next/BUILD_ID").write_text("synthetic old build")
        (old / ".env.production").symlink_to(case / "shared/.env.production")
        (old / "prisma/dev.db").symlink_to(case / "shared/prisma/dev.db")
        (case / "current").symlink_to(old)
        before = A.file_digest(case / "shared/prisma/dev.db")
        self.execute_case(case_name, case, extra, initial_import, deployer, helper, expected_status,
                          verify_shared_unchanged=not changed_fixture)
        if not changed_fixture:
            self.assertEqual(A.file_digest(case / "shared/prisma/dev.db"), before)
        self.assertEqual((case / "shared/.env.production").read_text(), "SYNTHETIC=1\n")
        self.assertEqual(list(case.glob(".prebuilt-import.*")), [])
        return case

    def execute_case(self, case_name, case, extra, initial_import=True, deployer=None, helper=None, expected_status=0,
                     verify_shared_unchanged=True):
        shared_before = shared_snapshot(case)
        script = r'''
set -Eeuo pipefail
source "$DEPLOYER"
release_root="$CASE/releases"; shared="$CASE/shared"; current_link="$CASE/current"
repository="$SEED"; deploy_user="$(id -un)"; prebuilt_state="$CASE/prebuilt"
activation_state="$CASE/activation.json"
prebuilt_approvals="$CASE/approvals"; prebuilt_helper="$HELPER"
prebuilt_python="$(command -v python3)"; student_id_preflight_node="$(command -v node)"
student_id_preflight_command="$TEST_REPO/scripts/student-id-release-preflight.mjs"
stat() {
 "$prebuilt_python" - "$2" "$3" <<'PY'
import os,sys,stat,pwd
s=os.lstat(sys.argv[2]);print({'%u':str(s.st_uid),'%a':oct(stat.S_IMODE(s.st_mode))[2:],'%U':pwd.getpwuid(s.st_uid).pw_name}[sys.argv[1]])
PY
}
require_root() { :; }; prepare_process() { umask 077; }; acquire_lock() { :; }
run_as_deploy_user() { "$@"; }; set_link_owner() { :; }; set_file_owner() { :; }
set_release_tree_owner() { :; }; verify_release_owner() { :; }; verify_root_metadata() { :; }
verify_prebuilt_platform() { :; }; verify_service_contract() { :; }
verify_recovery_startup() { :; }  # State-machine simulation, NOT real wrapper/UID proof.
atomic_replace_path() { "$student_id_preflight_node" -e 'require("fs").renameSync(process.argv[1],process.argv[2])' "$1" "$2"; }
run_prebuilt_helper() {
  # Same-user simulation: only root metadata and Linux runuser are substituted.
  "$prebuilt_python" - "$prebuilt_helper" "$@" <<'PY'
import importlib.util,sys
sys.dont_write_bytecode=True
s=importlib.util.spec_from_file_location('a',sys.argv[1]);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
a.trusted_file=lambda p: None
a.trusted_directory=lambda p: None
args=sys.argv[2:]
if '--git-user' in args:
 i=args.index('--git-user'); del args[i:i+2]
if '--runtime-user' in args:
 i=args.index('--runtime-user'); del args[i:i+2]
sys.argv=[sys.argv[1],*args]
a.main()
PY
}
run_release_static_checks() { echo forbidden-build >>"$CASE/events"; return 99; }
run_release_build() { echo forbidden-build >>"$CASE/events"; return 99; }
run_db_backup() { echo backup >>"$CASE/events"; }; run_prebuilt_backup() { run_db_backup; }
stop_service() { echo stop >>"$CASE/events"; }
run_migration() { echo migrate >>"$CASE/events"; }
restart_service() { echo restart >>"$CASE/events"; }
wait_for_health() { echo health >>"$CASE/events"; }
expect_fail() {
  local status
  set +e
  (set -Eeuo pipefail; main "$@")
  status=$?
  set -e
  [ "$status" -ne 0 ] || exit 90
}
main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"
'''
        if not initial_import:
            script = script.replace('main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"\n', '')
        env = dict(os.environ, TEST_REPO=str(REPO), CASE=str(case), SEED=str(self.source), ARCHIVE=str(self.archive), DIGEST=self.checksum, COMMIT=self.commit, OLD=self.old, PRIOR=self.prior,
                   DEPLOYER=str(deployer or REPO / "ops/deploy/nuaafa-deploy"), HELPER=str(helper or REPO / "ops/deploy/prebuilt-artifact.py"))
        inputs = dict(commit=self.commit, previous=self.old, prior=self.prior,
                      archive=str(self.archive), archive_sha256=A.file_digest(self.archive),
                      source=str(self.source), source_head=run("git", "-C", str(self.source), "rev-parse", "HEAD"),
                      deployer_sha256=A.file_digest(env["DEPLOYER"]), helper_sha256=A.file_digest(env["HELPER"]))
        result = recorded_run(["bash", "-c", script + extra], case_name, inputs, script + extra, expected_status, env=env)
        shared_after = shared_snapshot(case)
        with (result.evidence_path / "shared-postconditions.json").open("x") as output:
            json.dump(dict(before=shared_before, after=shared_after, equal=shared_before == shared_after,
                           equality_required=verify_shared_unchanged), output, indent=2)
        if verify_shared_unchanged:
            self.assertEqual(shared_after, shared_before, "synthetic shared DB/env metadata or bytes changed")
        self.assertEqual(result.returncode, expected_status, result.stdout + result.stderr)
        return result

    def test_case_evidence_preserves_repeated_names_and_failures(self):
        parent = Path(os.environ.get("NUAAFA_TEST_EVIDENCE", str(self.root)))
        parent.mkdir(parents=True, exist_ok=True)
        destination = Path(tempfile.mkdtemp(prefix="log-regression-", dir=parent))
        with patch.dict(os.environ, NUAAFA_TEST_EVIDENCE=str(destination)):
            for status in (0, 7, 0):
                recorded_run(["bash", "-c", 'printf "stdout\\n"; printf "stderr\\n" >&2; exit "$1"', "test", str(status)],
                             "same-case", dict(commit=self.commit, archive_sha256=self.checksum))
        records = sorted(destination.glob("*/result.json"))
        self.assertEqual(len(records), 3)
        self.assertEqual(sorted(json.loads(p.read_text())["exit_code"] for p in records), [0, 0, 7])
        for p in records:
            self.assertEqual((p.parent / "stdout.log").read_text(), "stdout\n")
            self.assertEqual((p.parent / "stderr.log").read_text(), "stderr\n")
        with patch.dict(os.environ, NUAAFA_TEST_EVIDENCE=str(destination)), self.assertRaises(subprocess.TimeoutExpired):
            recorded_run([sys.executable, "-u", "-c", "import time; print('partial-output'); time.sleep(5)"],
                         "timeout-case", dict(commit=self.commit), timeout=0.2)
        timed_out = json.loads(next(destination.glob("timeout-case-*/result.json")).read_text())
        self.assertTrue(timed_out["timed_out"])
        self.assertNotEqual(timed_out["exit_code"], 0)
        self.assertEqual(timed_out["cleanup"], "process group removed and children reaped")

    def test_timeout_reaps_descendant_process_tree(self):
        parent = Path(os.environ.get("NUAAFA_TEST_EVIDENCE", str(self.root)))
        destination = Path(tempfile.mkdtemp(prefix="process-tree-", dir=parent))
        script = destination / "tree.py"
        script.write_text('''import os,signal,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]); level=int(sys.argv[2])
signal.signal(signal.SIGTERM, signal.SIG_IGN)
(root/('pid-'+str(level))).write_text(str(os.getpid()))
if level < 2: subprocess.Popen([sys.executable,'-u',__file__,str(root),str(level+1)])
print('partial stdout '+str(level),flush=True)
print('partial stderr '+str(level),file=sys.stderr,flush=True)
(root/('ready-'+str(level))).write_text('ready')
while True: time.sleep(0.05)
''')
        runner_group = os.getpgrp()
        ready = [destination / ("ready-" + str(i)) for i in range(3)]
        with patch.dict(os.environ, NUAAFA_TEST_EVIDENCE=str(destination)), \
             patch(__name__ + ".wait_child_exit", side_effect=wait_after_fixture_ready(ready)), \
             self.assertRaises(subprocess.TimeoutExpired):
            recorded_run([sys.executable, "-u", str(script), str(destination), "0"],
                         "descendant-timeout", dict(synthetic=True), timeout=1)
        pids = [int((destination / ("pid-" + str(i))).read_text()) for i in range(3)]
        for pid in pids:
            with self.assertRaises(ProcessLookupError): os.kill(pid, 0)
        self.assertEqual(os.getpgrp(), runner_group)
        record = next(destination.glob("descendant-timeout-*/result.json"))
        metadata = json.loads(record.read_text())
        self.assertTrue(metadata["timed_out"])
        self.assertNotEqual(metadata["exit_code"], 0)
        self.assertNotEqual(metadata["process_group"], runner_group)
        self.assertIn("partial stdout 2", (record.parent / "stdout.log").read_text())
        self.assertIn("partial stderr 2", (record.parent / "stderr.log").read_text())
        self.assertIn("reaped", metadata["cleanup"])

    def test_timeout_cleanup_failure_is_visible(self):
        cleanup = terminate_group
        def fail_after_cleanup(process):
            cleanup(process)
            raise RuntimeError("injected cleanup failure")
        with patch(__name__ + ".terminate_group", side_effect=fail_after_cleanup) as cleanup_call, \
             self.assertRaises(subprocess.TimeoutExpired) as caught:
            recorded_run([sys.executable, "-c", "import time; time.sleep(10)"],
                         "cleanup-failure", dict(synthetic=True), timeout=0.1)
        self.assertEqual(cleanup_call.call_count, 1)
        self.assertIsInstance(caught.exception.cleanup_error, RuntimeError)
        self.assertIn("injected cleanup failure", str(caught.exception.cleanup_error))
        self.assertIs(caught.exception.__cause__, caught.exception.cleanup_error)
        self.assertIn("cleanup failed", caught.exception.stderr)

    def legacy_setup(self):
        # Only side-effectful build/service/database actions are synthetic.
        # Parsing, provenance, Git, migration-ready, state/check-state are real.
        return r'''
mkdir "$prebuilt_approvals"
for sha in "$OLD" "$COMMIT"; do
 "$prebuilt_python" - "$prebuilt_approvals/legacy-$sha.json" "$sha" <<'PY'
import json,sys
with open(sys.argv[1],'x') as f: json.dump(dict(format=1,commit=sys.argv[2],allowed_ref='refs/heads/main',legacy_host_build='APPROVED',human_review='APPROVED'),f)
PY
done
run_release_static_checks() { :; }
run_release_build() { mkdir -p "$1/.next"; printf synthetic-build > "$1/.next/BUILD_ID"; }
'''

    def test_trimmed_layout_actual_import_and_repeat(self):
        self.deploy_case("trimmed-layout-entry", r'''
test ! -e "$release_root/$COMMIT/README.md"
git_in_release "$release_root/$COMMIT" ls-files --error-unmatch README.md
main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"
test "$(git_in_release "$release_root/$COMMIT" rev-parse HEAD)" = "$COMMIT"
test "$(readlink "$current_link")" = "$release_root/$OLD"
test ! -e "$CASE/events"
''')

    def test_repeat_import_preserves_shared_metadata_receipt_and_links(self):
        case = self.deploy_case("repeat-postconditions-first", 'test ! -e "$CASE/events"\n')
        receipt = case / "prebuilt" / (self.commit + ".json")
        receipt_before = receipt.read_bytes()
        link_before = os.readlink(case / "current")
        shared_before = shared_snapshot(case)
        refs_before = run("git", "-C", str(self.source), "show-ref")
        self.execute_case("repeat-postconditions-second", case, r'''
main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"
test ! -e "$CASE/events"
test ! -e "$activation_state"
test ! -e "$prebuilt_approvals"
test ! -e "$release_root/$COMMIT/.env.production"
test ! -e "$release_root/$COMMIT/prisma/dev.db"
''', initial_import=False)
        self.assertEqual(receipt.read_bytes(), receipt_before)
        self.assertEqual(os.readlink(case / "current"), link_before)
        self.assertEqual(shared_snapshot(case), shared_before)
        self.assertEqual(run("git", "-C", str(self.source), "show-ref"), refs_before)
        self.assertEqual(A.file_digest(self.archive), self.checksum)

    def test_commit_source_omission_rejected_through_import_entry(self):
        manifest = copy.deepcopy(self.manifest)
        manifest["sources"].remove("src/synthetic.ts")
        del manifest["files"]["src/synthetic.ts"]
        archive = self.mutate(lambda member, data: None if member.name == "src/synthetic.ts" else
                              (member, A.json_bytes(manifest)) if member.name == A.MANIFEST else (member, data))
        extra = 'expect_fail --import-artifact ' + str(archive) + ' --artifact-sha256 ' + A.file_digest(archive) + ' "$COMMIT"\n'
        extra += 'test ! -e "$release_root/$COMMIT"\ntest ! -e "$prebuilt_state/$COMMIT.json"\ntest ! -e "$CASE/events"\n'
        self.deploy_case("commit-source-omission", extra, initial_import=False)

    def test_import_ignores_inherited_git_configuration(self):
        self.deploy_case("inherited-git-entry", r'''
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.url GIT_CONFIG_VALUE_0=/untrusted-environment-origin
main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"
main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"
test "$(readlink "$current_link")" = "$release_root/$OLD"
test ! -e "$CASE/events"
''', initial_import=False)

    def test_repeat_import_rejects_source_environment_origin_head_and_ref(self):
        for kind in ("source", "missing-source", "excluded-extra", "environment", "origin", "head", "ref", "receipt"):
            with self.subTest(kind=kind):
                change = {
                    "source": 'printf tamper >> "$release_root/$COMMIT/src/synthetic.ts"',
                    "missing-source": 'rm "$release_root/$COMMIT/src/synthetic.ts"',
                    "excluded-extra": 'printf extra > "$release_root/$COMMIT/README.md"',
                    "environment": 'printf SYNTHETIC=bad > "$release_root/$COMMIT/.env.local"',
                    "origin": 'git -C "$release_root/$COMMIT" remote set-url origin /untrusted',
                    "head": 'git -C "$release_root/$COMMIT" update-ref --no-deref HEAD "$OLD"',
                    "ref": 'git -C "$SEED" update-ref refs/heads/main "$PRIOR"',
                    "receipt": 'printf \'{}\' > "$prebuilt_state/$COMMIT.json"',
                }[kind]
                extra = change + '\nexpect_fail --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"\ntest "$(readlink "$current_link")" = "$release_root/$OLD"\ntest ! -e "$CASE/events"\n'
                if kind == "ref": extra += 'git -C "$SEED" update-ref refs/heads/main "$COMMIT"\n'
                try:
                    self.deploy_case("repeat-reject-" + kind, extra)
                finally:
                    if kind == "ref": run("git", "-C", str(self.source), "update-ref", "refs/heads/main", self.commit)

    def test_trimmed_previous_recovery_uses_its_own_receipt(self):
        approval = dict(format=1, commit=self.commit, artifact_sha256=self.checksum, allowed_ref="refs/heads/main", security_gate="PASS", linux_artifact_validation="PASS", human_review="APPROVED")
        extra = self.sealed_previous_setup()
        extra += 'mkdir "$prebuilt_approvals"\ncat >"$prebuilt_approvals/$COMMIT.json" <<\'JSON\'\n' + json.dumps(approval) + '\nJSON\n'
        extra += r'''
wait_for_health() { echo health >> "$CASE/events"; test "$(readlink "$current_link")" = "$release_root/$OLD"; }
expect_fail --activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"
if run_prebuilt_helper check-state --path "$activation_state" --current "$current_link"; then exit 90; fi
"$prebuilt_python" - "$activation_state" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['phase'] == 'MANUAL_REQUIRED'
PY
test "$(readlink "$current_link")" = "$release_root/$COMMIT"
main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"
'''
        self.deploy_case("trimmed-old-recovery", extra)

    def test_real_journal_link_only_sequence(self):
        extra = self.legacy_setup() + r'''
main "$OLD"
main --stage-only "$COMMIT"
cp "$activation_state" "$CASE/journal-before"
cp "$CASE/events" "$CASE/events-before"
expect_fail --activate-staged "$COMMIT"
cmp "$activation_state" "$CASE/journal-before"
cmp "$CASE/events" "$CASE/events-before"
test "$(readlink "$current_link")" = "$release_root/$OLD"
main --activate-staged "$OLD"
cmp "$activation_state" "$CASE/journal-before"
cmp "$CASE/events" "$CASE/events-before"
cp "$activation_state" "$CASE/journal-after-A-noop"
cmp "$CASE/journal-after-A-noop" "$CASE/journal-before"
main "$COMMIT"
run_prebuilt_helper check-state --path "$activation_state" --current "$current_link"
cp "$activation_state" "$CASE/healthy-B"
cp "$CASE/events" "$CASE/events-B"
main --stage-only "$COMMIT"
main --activate-staged "$COMMIT"
cmp "$activation_state" "$CASE/healthy-B"
cmp "$CASE/events" "$CASE/events-B"
'''
        self.deploy_case("journal-link-only-entry", extra, initial_import=False, previous_commit=self.prior)

    def test_real_journal_incomplete_manual_mismatch_and_legacy_absent(self):
        for phase in ("PREPARED", "MIGRATING", "MANUAL_REQUIRED", "mismatch", "absent"):
            with self.subTest(phase=phase):
                extra = self.legacy_setup() + 'main --stage-only "$COMMIT"\n'
                if phase != "absent":
                    commit = '$COMMIT' if phase == "mismatch" else '$OLD'
                    extra += 'run_prebuilt_helper state --path "$activation_state" --commit "' + commit + '" --previous "$PRIOR" --phase ' + ("HEALTHY" if phase == "mismatch" else phase) + '\n'
                    extra += 'cp "$activation_state" "$CASE/before"\nexpect_fail --activate-staged "$COMMIT"\ncmp "$activation_state" "$CASE/before"\ntest "$(readlink "$current_link")" = "$release_root/$OLD"\n'
                else:
                    extra += 'main --activate-staged "$COMMIT"\nmain --activate-staged "$COMMIT"\ntest ! -e "$activation_state"\ntest "$(readlink "$current_link")" = "$release_root/$COMMIT"\n'
                extra += 'test ! -e "$CASE/events"\n'
                self.deploy_case("journal-contract-" + phase, extra, initial_import=False)

    def test_old_release_precheck_before_backup_stop_migrate_switch(self):
        approval = dict(format=1, commit=self.commit, artifact_sha256=self.checksum, allowed_ref="refs/heads/main", security_gate="PASS", linux_artifact_validation="PASS", human_review="APPROVED")
        for mode, kind in ((mode, kind) for mode in ("prebuilt", "full") for kind in
                           ("source", "source-missing", "build", "shared-link", "shared-mode", "migration", "origin", "healthy")):
            with self.subTest(mode=mode, kind=kind):
                extra = (self.legacy_setup() if mode == "full" else
                         self.sealed_previous_setup() + 'mkdir "$prebuilt_approvals"\ncat >"$prebuilt_approvals/$COMMIT.json" <<\'JSON\'\n' + json.dumps(approval) + '\nJSON\n')
                changes = {
                    "source": 'printf tamper >> "$release_root/$OLD/src/synthetic.ts"',
                    "source-missing": 'rm "$release_root/$OLD/src/synthetic.ts"',
                    "build": 'rm "$release_root/$OLD/.next/BUILD_ID"',
                    "shared-link": 'rm "$release_root/$OLD/.env.production"; ln -s "$shared/prisma/dev.db" "$release_root/$OLD/.env.production"',
                    "shared-mode": 'chmod 0666 "$shared/.env.production"',
                    "migration": 'printf tamper >> "$release_root/$OLD/prisma/migrations/20260722013757_init_referee_center/migration.sql"',
                    "origin": 'git -C "$release_root/$OLD" remote set-url origin /untrusted',
                    "healthy": ':',
                }
                extra += changes[kind] + '\n'
                invocation = ('--activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"'
                              if mode == "prebuilt" else '"$COMMIT"')
                if kind == "healthy":
                    extra += 'main ' + invocation + '\nrun_prebuilt_helper check-state --path "$activation_state" --current "$current_link"\n'
                else:
                    extra += 'expect_fail ' + invocation + '\ntest ! -e "$CASE/events"\ntest ! -e "$activation_state"\ntest "$(readlink "$current_link")" = "$release_root/$OLD"\n'
                if kind == "shared-mode":
                    # This negative case deliberately changed the fixture. Prove
                    # rejection left that mode intact, then undo our own mutation
                    # before the common DB/env postcondition comparison.
                    extra += 'test "$(stat -c %a "$shared/.env.production")" = 666\nchmod 0600 "$shared/.env.production"\n'
                self.deploy_case("old-precheck-" + mode + "-" + kind, extra, initial_import=mode == "prebuilt")

    def test_deployer_invalid_archives_and_late_failure_cleanup(self):
        for kind in ("corrupt", "missing", "path", "source"):
            with self.subTest(kind=kind):
                manifest = copy.deepcopy(self.manifest)
                if kind == "source":
                    manifest["files"]["src/synthetic.ts"].update(size=6, sha256=A.digest(b"tamper"))
                def mutate(m, d):
                    if kind == "source" and m.name == A.MANIFEST: return m, A.json_bytes(manifest)
                    if kind == "source" and m.name == "src/synthetic.ts": return m, b"tamper"
                    if m.name == ".next/BUILD_ID":
                        if kind == "missing": return None
                        if kind == "path": m.name = "../outside"
                        if kind == "corrupt": d = b"tamper"
                    return m, d
                bad = self.mutate(mutate)
                extra = 'expect_fail --import-artifact ' + str(bad) + ' --artifact-sha256 ' + A.file_digest(bad) + ' "$COMMIT"\n'
                extra += 'test "$(readlink "$current_link")" = "$release_root/$OLD"\ntest ! -e "$release_root/$COMMIT"\ntest ! -e "$prebuilt_state/$COMMIT.json"\ntest ! -e "$CASE/events"\n'
                case = self.deploy_case("failed-import-" + kind, extra, initial_import=False)
                self.assertEqual(list((case / "releases").glob(".prebuilt-*")), [])

    def test_deployer_dry_run_and_release_collision(self):
        for kind in ("dry", "collision"):
            with self.subTest(kind=kind):
                extra = ''
                if kind == "dry":
                    extra += 'main --dry-run --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"\ntest ! -e "$release_root/$COMMIT"\ntest ! -e "$prebuilt_state"\n'
                else:
                    extra += 'ln -s "$release_root/$OLD" "$release_root/$COMMIT"\nexpect_fail --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"\ntest "$(readlink "$release_root/$COMMIT")" = "$release_root/$OLD"\n'
                extra += 'test "$(readlink "$current_link")" = "$release_root/$OLD"\ntest ! -e "$CASE/events"\n'
                self.deploy_case("import-" + kind, extra, initial_import=False)

    def test_import_collision_cleanup_preserves_unknown_paths(self):
        for kind in ("checkout", "staging", "receipt"):
            with self.subTest(kind=kind):
                if kind == "receipt":
                    extra = 'mkdir "$prebuilt_state"\nprintf unknown > "$prebuilt_state/$COMMIT.json"\n'
                    retained = '$prebuilt_state/$COMMIT.json'
                else:
                    prefix = ".prebuilt-source-" if kind == "checkout" else ".prebuilt-"
                    retained = '$release_root/' + prefix + '$COMMIT-$$/unknown'
                    extra = 'mkdir "$release_root/' + prefix + '$COMMIT-$$"\nprintf unknown > "' + retained + '"\n'
                extra += 'expect_fail --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"\ntest "$(cat "' + retained + '")" = unknown\ntest ! -e "$release_root/$COMMIT"\ntest ! -e "$CASE/events"\n'
                self.deploy_case("unknown-collision-" + kind, extra, initial_import=False)

    def test_deployer_import_repeat_failures_and_activation_block(self):
        case = self.deploy_case("import-matrix", r'''
test "$(readlink "$current_link")" = "$release_root/$OLD"
test ! -e "$release_root/$COMMIT/.env.production"
test ! -e "$release_root/$COMMIT/prisma/dev.db"
test ! -e "$CASE/events"
main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"
expect_fail --activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"
expect_fail --activate-staged "$COMMIT"
expect_fail "$COMMIT"
expect_fail --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$OLD"
expect_fail --import-artifact "$ARCHIVE" --artifact-sha256 "$(printf '%064d' 0)" "$COMMIT"
expect_fail --import-artifact "$ARCHIVE" "$COMMIT"
expect_fail --stage-only --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"
printf 'tamper' >> "$release_root/$COMMIT/.next/BUILD_ID"
expect_fail --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"
test "$(readlink "$current_link")" = "$release_root/$OLD"
test ! -e "$CASE/events"
''')
        self.assertEqual((case / "current").resolve().name, self.old)

    def sealed_previous_setup(self):
        return ('rm -rf "$release_root/$OLD"\nfixture_current_helper="$prebuilt_helper"\nprebuilt_helper=' + str(self.historical_helper) +
                '\nmain --import-artifact ' + str(self.old_archive) + ' --artifact-sha256 ' + self.old_checksum +
                ' "$OLD"\nprebuilt_helper="$fixture_current_helper"\nensure_shared_links "$release_root/$OLD"\n')

    def test_historical_sealed_own_chain_and_candidate_helper_requirement(self):
        self.deploy_case("historical-sealed-own-chain", self.sealed_previous_setup() + r'''
operation_mode=prebuilt
test ! -e "$release_root/$OLD/src/lib/restore-target.py"
validate_recovery_release "$release_root/$OLD"
test "$(readlink "$current_link")" = "$release_root/$OLD"
test ! -e "$CASE/events"
test ! -e "$activation_state"
''')
        with self.assertRaisesRegex(ValueError, "missing required file"):
            A.read_archive(self.old_archive, self.old_checksum, self.old)
        self.reject_mutation(lambda m, d: None if m.name == "src/lib/restore-target.py" else (m, d))
        forged = copy.deepcopy(self.manifest)
        forged["format"] = 0
        with self.assertRaisesRegex(ValueError, "manifest identity"):
            A.validate_manifest(forged, self.commit)

    def test_historical_recovery_receipt_and_current_source_omission_rejected(self):
        for kind in ("receipt-commit", "receipt-digest", "receipt-ref", "current-source-omission"):
            extra = self.sealed_previous_setup()
            if kind == "current-source-omission":
                extra += r'''
old_receipt="$prebuilt_state/$COMMIT.json"
rm "$release_root/$COMMIT/src/lib/restore-target.py"
'''
            else:
                extra += 'old_receipt="$prebuilt_state/$OLD.json"\n'
            extra += '"$prebuilt_python" - "$old_receipt" ' + kind + r''' <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]);r=json.loads(p.read_text())
if sys.argv[2]=='receipt-commit':r['commit']='f'*40
elif sys.argv[2]=='receipt-digest':r['sha256']='not-a-sha'
elif sys.argv[2]=='receipt-ref':r['allowed_ref']='unsafe-ref'
else:
 r['manifest']['sources'].remove('src/lib/restore-target.py')
 del r['manifest']['files']['src/lib/restore-target.py']
p.write_text(json.dumps(r))
PY
operation_mode=prebuilt
set +e
validate_recovery_release "$release_root/''' + ("$COMMIT" if kind == "current-source-omission" else "$OLD") + r'''"
status=$?
set -e
test "$status" -ne 0
test "$(readlink "$current_link")" = "$release_root/$OLD"
test ! -e "$CASE/events"
test ! -e "$activation_state"
'''
            self.deploy_case("historical-recovery-reject-" + kind, extra)

    def test_prebuilt_legacy_and_startup_incompatibility_rejected_before_mutation(self):
        for kind in ("legacy", "startup"):
            approval = dict(format=1, commit=self.commit, artifact_sha256=self.checksum,
                            allowed_ref="refs/heads/main", security_gate="PASS",
                            linux_artifact_validation="PASS", human_review="APPROVED")
            extra = self.sealed_previous_setup() if kind == "startup" else ""
            extra += 'mkdir "$prebuilt_approvals"\ncat >"$prebuilt_approvals/$COMMIT.json" <<\'JSON\'\n' + json.dumps(approval) + '\nJSON\n'
            if kind == "startup":
                extra += 'verify_recovery_startup() { return 7; }\n'
            extra += ('expect_fail --activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"\n'
                      'test "$(readlink "$current_link")" = "$release_root/$OLD"\n'
                      'test ! -e "$CASE/events"\ntest ! -e "$activation_state"\n')
            self.deploy_case("recovery-preflight-" + kind, extra)

    def test_deployer_approved_activation_and_rollback(self):
        for kind in ("success", "restart", "health", "identity", "approval-fail"):
            with self.subTest(kind=kind):
                approval = dict(format=1, commit=self.commit, artifact_sha256=self.checksum, allowed_ref="refs/heads/main", security_gate="PASS", linux_artifact_validation="PASS", human_review="APPROVED")
                if kind == "approval-fail": approval["security_gate"] = "FAIL"
                extra = 'mkdir "$prebuilt_approvals"\ncat >"$prebuilt_approvals/$COMMIT.json" <<\'JSON\'\n' + json.dumps(approval) + '\nJSON\n'
                if kind in ("restart", "health"):
                    fn = "restart_service" if kind == "restart" else "wait_for_health"
                    extra += fn + '() { echo ' + kind + ' >>"$CASE/events"; return 1; }\n'
                if kind == "identity":
                    extra += '"$prebuilt_python" - "$shared/prisma/dev.db" <<\'PY\'\nimport sqlite3,sys\nwith sqlite3.connect(sys.argv[1]) as db: db.execute("UPDATE Referee SET studentId=NULL")\nPY\n'
                    extra += 'cp "$shared/prisma/dev.db" "$CASE/unsafe-before.db"\n'
                    restore = 'cmp "$shared/prisma/dev.db" "$CASE/unsafe-before.db"\n'
                else: restore = ""
                if kind == "success":
                    extra += 'main --activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"\ntest "$(readlink "$current_link")" = "$release_root/$COMMIT"\n'
                else:
                    expected_link = "$OLD" if kind in ("identity", "approval-fail") else "$COMMIT"
                    extra += 'expect_fail --activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"\ntest "$(readlink "$current_link")" = "$release_root/' + expected_link + '"\n'
                extra += restore
                extra = self.sealed_previous_setup() + extra
                case = self.deploy_case("activation-" + kind, extra, changed_fixture=kind == "identity")
                if kind in ("identity", "approval-fail"):
                    self.assertFalse((case / "events").exists())
                else:
                    events = (case / "events").read_text().splitlines()
                    self.assertEqual(events[:3], ["backup", "stop", "migrate"])
                    self.assertEqual(events.count("migrate"), 1)
                    self.assertNotIn("forbidden-build", events)
                    self.assertEqual(events[3:5], ["restart", "health"] if kind == "success" else (["restart", "stop"] if kind == "restart" else ["restart", "health"]))

    def test_recovery_final_state_and_failure_matrix(self):
        for kind in ("new-restart", "new-health", "old-restart", "old-health", "old-link", "migration", "backup", "stop", "interrupt", "ordinary-error", "rollback-journal"):
            with self.subTest(kind=kind):
                approval = dict(format=1, commit=self.commit, artifact_sha256=self.checksum, allowed_ref="refs/heads/main", security_gate="PASS", linux_artifact_validation="PASS", human_review="APPROVED")
                extra = 'mkdir "$prebuilt_approvals"\ncat >"$prebuilt_approvals/$COMMIT.json" <<\'JSON\'\n' + json.dumps(approval) + '\nJSON\n'
                if kind in ("new-restart", "old-restart"):
                    extra += 'restart_service() { echo restart >>"$CASE/events"; '
                    extra += 'test "$(basename "$(readlink "$current_link")")" = "$OLD"; }\n' if kind == "new-restart" else 'return 1; }\n'
                if kind in ("new-health", "old-health", "old-link", "rollback-journal"):
                    extra += 'wait_for_health() { echo health >>"$CASE/events"; '
                    extra += 'test "$(basename "$(readlink "$current_link")")" = "$OLD"; }\n' if kind in ("new-health", "old-link", "rollback-journal") else 'return 1; }\n'
                if kind == "rollback-journal":
                    extra += 'eval "$(declare -f record_activation_phase | sed \'1s/record_activation_phase/original_record_activation_phase/\')"\n'
                    extra += 'record_activation_phase() { [ "$1" != ROLLED_BACK ] || return 7; original_record_activation_phase "$1"; }\n'
                if kind == "old-link":
                    extra += 'atomic_replace_path() { if [ "$2" = "$current_link" ] && [ "$(readlink "$1")" = "$release_root/$OLD" ]; then return 7; fi; "$student_id_preflight_node" -e \'require("fs").renameSync(process.argv[1],process.argv[2])\' "$1" "$2"; }\n'
                if kind == "migration": extra += 'run_migration() { echo migrate >>"$CASE/events"; return 7; }\n'
                if kind == "backup": extra += 'run_prebuilt_backup() { echo backup >>"$CASE/events"; return 7; }\n'
                if kind == "stop": extra += 'stop_service() { echo stop >>"$CASE/events"; return 7; }\n'
                if kind == "interrupt": extra += 'run_migration() { echo migrate >>"$CASE/events"; "$student_id_preflight_node" -e \'process.kill(process.ppid, "SIGTERM")\'; }\n'
                if kind == "ordinary-error": extra += 'atomic_switch_current() { return 7; }\n'
                extra += 'expect_fail --activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"\n'
                if kind != "backup":
                    phase = "ROLLED_BACK" if kind == "stop" else "MANUAL_REQUIRED"
                    extra += '"$prebuilt_python" - "$activation_state" <<\'PY\'\nimport json,sys\nassert json.load(open(sys.argv[1]))["phase"] == ' + repr(phase) + '\nPY\n'
                if kind not in ("backup", "stop", "migration", "interrupt", "ordinary-error"):
                    extra += 'test "$(readlink "$current_link")" = "$release_root/$COMMIT"\n'
                if kind in ("backup", "stop", "migration", "interrupt", "ordinary-error"):
                    extra += 'test "$(readlink "$current_link")" = "$release_root/$OLD"\n'
                if kind not in ("backup", "stop"):
                    extra += 'expect_fail --activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"\n'
                case = self.deploy_case("recovery-final-" + kind, self.sealed_previous_setup() + extra)
                events = (case / "events").read_text().splitlines()
                self.assertLessEqual(events.count("migrate"), 1)
                if kind == "stop":
                    self.assertEqual(events[-1], "health")
                elif kind != "backup": self.assertEqual(events[-1], "stop")



class ProcessLifecycleTests(unittest.TestCase):
    """Real isolated POSIX processes; native Linux adoption is a separate gate."""
    def setUp(self):
        parent = os.environ.get("NUAAFA_TEST_EVIDENCE")
        if parent:
            Path(parent).mkdir(parents=True, exist_ok=True)
            self.root = Path(tempfile.mkdtemp(prefix="lifecycle-", dir=parent))
        else:
            self.temp = tempfile.TemporaryDirectory(prefix="lifecycle-")
            self.addCleanup(self.temp.cleanup)
            self.root = Path(self.temp.name)
        self.evidence = self.root / "evidence"
        self.environment = patch.dict(os.environ, NUAAFA_TEST_EVIDENCE=str(self.evidence))
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.outsider = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"], start_new_session=True)
        self.addCleanup(self.stop_outsider)
        self.runner_group = os.getpgrp()

    def stop_outsider(self):
        # A direct Popen handle, never a discovered PID or shared group.
        if self.outsider.poll() is None:
            self.outsider.kill()
        self.outsider.wait(timeout=5)

    def assert_isolated(self, metadata):
        self.assertEqual(os.getpgrp(), self.runner_group)
        self.assertIsNone(self.outsider.poll())
        self.assertNotEqual(metadata["process_group"], self.outsider.pid)
        self.assertNotEqual(metadata["process_group"], self.runner_group)
        self.assertFalse(group_exists(metadata["process_group"]))

    def record(self, name):
        path = next(self.evidence.glob(name + "-*/result.json"))
        return json.loads(path.read_text()), path.parent

    def command(self):
        ready = self.root / "ready"
        source = "import sys,time; from pathlib import Path; print('kept stdout',flush=True); print('kept stderr',file=sys.stderr,flush=True); Path(" + repr(str(ready)) + ").write_text('ready'); time.sleep(30)"
        return [sys.executable, "-u", "-c", source], ready

    def injected_run(self, error, cleanup_error=None):
        command, ready = self.command()
        real_wait, real_cleanup = wait_child_exit, terminate_group
        def injected_wait(process, timeout):
            if timeout != 7:
                return real_wait(process, timeout)
            deadline = time.monotonic() + 3
            while not ready.exists():
                if time.monotonic() >= deadline:
                    raise RuntimeError("fixture readiness timeout")
                time.sleep(0.01)
            raise error
        def cleanup(process):
            real_cleanup(process)
            if cleanup_error is not None:
                raise cleanup_error
        with patch(__name__ + ".wait_child_exit", side_effect=injected_wait), \
             patch(__name__ + ".terminate_group", side_effect=cleanup) as clean, \
             self.assertRaises(type(error)) as caught:
            recorded_run(command, "injected", dict(synthetic=True), timeout=7)
        self.assertIs(caught.exception, error)
        clean.assert_called_once()
        metadata, path = self.record("injected")
        self.assert_isolated(metadata)
        self.assertFalse(metadata["timed_out"])
        self.assertNotEqual(metadata["exit_code"], 0)
        self.assertIn("kept stdout", (path / "stdout.log").read_text())
        self.assertIn("kept stderr", (path / "stderr.log").read_text())
        self.assertIn(type(error).__name__, metadata["exception"])
        if cleanup_error is not None:
            self.assertIs(error.cleanup_error, cleanup_error)
            self.assertIs(error.__cause__, cleanup_error)
            self.assertIn(str(error), (path / "stderr.log").read_text())
            self.assertIn(str(cleanup_error), metadata["cleanup_exception"])
            self.assertIn(str(cleanup_error), (path / "stderr.log").read_text())

    def test_normal_exit_and_nonzero_exit_preserve_output(self):
        for status in (0, 7):
            with self.subTest(status=status):
                result = recorded_run([sys.executable, "-c", "import sys; print('normal'); print('err',file=sys.stderr); sys.exit(" + str(status) + ")"],
                                      "normal-" + str(status), dict(synthetic=True))
                self.assertEqual(result.returncode, status)
                self.assertEqual(result.stdout, "normal\n")
                self.assertEqual(result.stderr, "err\n")
                metadata, _ = self.record("normal-" + str(status))
                self.assertIsNone(metadata["exception"])
                self.assertFalse(metadata["timed_out"])
                self.assert_isolated(metadata)

    def test_large_output_does_not_block_leader_wait(self):
        result = recorded_run([sys.executable, "-c", "import sys; sys.stdout.write('o'*1048576); sys.stderr.write('e'*1048576)"],
                              "large-output", dict(synthetic=True), timeout=5)
        self.assertEqual(result.stdout, "o" * 1048576)
        self.assertEqual(result.stderr, "e" * 1048576)
        self.assertEqual(result.returncode, 0)
        self.assert_isolated(self.record("large-output")[0])

    def test_waited_child_preserves_status_and_output(self):
        child = "import sys; print('child stdout'); print('child stderr',file=sys.stderr)"
        parent = "import subprocess,sys; subprocess.run([sys.executable,'-c'," + repr(child) + "],check=True); sys.exit(7)"
        result = recorded_run([sys.executable, "-c", parent], "waited-child", dict(synthetic=True), expected_status=7)
        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stdout, "child stdout\n")
        self.assertEqual(result.stderr, "child stderr\n")
        self.assertTrue(result.lifecycle["cleanup_complete"])
        self.assertEqual(result.lifecycle["reaped"], [])
        self.assert_isolated(self.record("waited-child")[0])

    def test_env_git_preserves_actual_nonzero_status_and_stderr(self):
        source = self.root / "empty-git"
        source.mkdir()
        prefix = ["/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "HOME=" + str(self.root),
                  "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "/usr/bin/git"]
        initialized = recorded_run([*prefix, "init", source], "env-git-init", dict(synthetic=True))
        self.assertEqual(initialized.returncode, 0, initialized.stderr)
        result = recorded_run([*prefix, "-C", source, "rev-parse", "--verify", "HEAD"],
                              "env-git-reject", dict(synthetic=True), expected_status=128)
        self.assertEqual(result.returncode, 128)
        self.assertEqual(result.stdout, "")
        self.assertIn("fatal:", result.stderr)
        self.assertTrue(result.lifecycle["cleanup_complete"])
        self.assert_isolated(self.record("env-git-reject")[0])

    def test_git_bundle_ref_validation_with_isolated_same_uid_repositories(self):
        source, destination = self.root / "source", self.root / "destination.git"
        source.mkdir()
        (source / "fixture").write_text("synthetic Git source\n")
        prefix = ["/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "HOME=" + str(self.root),
                  "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "/usr/bin/git"]
        def checked(*args):
            result = recorded_run([*prefix, *map(str, args)], "same-uid-bundle", dict(synthetic=True, real_uid=os.getuid()))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(result.lifecycle["cleanup_complete"])
            self.assert_isolated(json.loads((result.evidence_path / "result.json").read_text()))
            return result.stdout.strip()
        checked("init", "--initial-branch=main", source)
        checked("-C", source, "config", "user.name", "Synthetic Fixture")
        checked("-C", source, "config", "user.email", "fixture@example.invalid")
        checked("-C", source, "add", "fixture")
        checked("-C", source, "commit", "-m", "synthetic source")
        commit = checked("-C", source, "rev-parse", "HEAD")
        before = checked("-C", source, "show-ref")
        bundle = self.root / "source.bundle"
        checked("-C", source, "bundle", "create", bundle, "HEAD")
        checked("init", "--bare", "--initial-branch=main", destination)
        checked("-C", destination, "bundle", "verify", bundle)
        self.assertEqual(checked("-C", destination, "bundle", "list-heads", bundle), commit + " HEAD")
        checked("-C", destination, "fetch", "--no-tags", bundle, "HEAD:refs/heads/main")
        self.assertEqual(checked("-C", destination, "show-ref"), commit + " refs/heads/main")
        self.assertEqual(checked("-C", source, "show-ref"), before)

    def simulated_linux_probe(self, state, unreapable=False, new_child=False):
        # Synthetic process identities only: this never signals a real PID.
        process = type("SimulatedProcess", (), dict(pid=12345, returncode=None))()
        child = dict(pid=12346, name="git", state=state, ppid=os.getpid(), pgid=12345, start_ticks=77)
        def popen(args, **kwargs):
            kwargs["stdout"].write("original Git stdout\n")
            kwargs["stderr"].write("fatal: repository owned by different users\n")
            return process
        def reap_leader(timeout):
            process.returncode = 128
            return 128
        process.wait = reap_leader
        reaped_child = dict(child, pid=12347, start_ticks=78) if new_child else dict(child)
        children = [[12346], [reaped_child["pid"]], [12346] if unreapable else []]
        with patch.object(sys, "platform", "linux"), \
             patch(__name__ + ".descendant_reaper", side_effect=contextlib.nullcontext), \
             patch.object(subprocess, "Popen", side_effect=popen), \
             patch(__name__ + ".child_exited", return_value=True), \
             patch(__name__ + ".wait_child_exit"), \
             patch(__name__ + ".owned_group_children", side_effect=children), \
             patch(__name__ + ".owned_child_metadata", side_effect=[dict(child), reaped_child]), \
             patch.object(os, "killpg") as send, \
             patch.object(os, "waitpid", return_value=(0 if unreapable else reaped_child["pid"], 0)), \
             patch.object(time, "monotonic", side_effect=[0, 6] if unreapable else [0, 0]):
            if state == "Z" and not unreapable and not new_child:
                result = recorded_run(["synthetic-runuser", "env", "git", "clone"], "zombie-probe",
                                      dict(simulated_linux=True), expected_status=128)
            else:
                with self.assertRaisesRegex(RuntimeError, "owned descendants remain|left descendants"):
                    recorded_run(["synthetic-runuser", "env", "git", "clone"], "failed-probe", dict(simulated_linux=True))
                result = None
        self.assertEqual(send.call_args_list, [unittest.mock.call(12345, signal.SIGTERM),
                                               unittest.mock.call(12345, signal.SIGKILL)])
        return process, result

    def test_simulated_linux_completed_zombie_is_reaped_without_false_leak(self):
        process, result = self.simulated_linux_probe("Z")
        self.assertEqual(result.returncode, 128)
        self.assertEqual(result.stdout, "original Git stdout\n")
        self.assertEqual(result.stderr, "fatal: repository owned by different users\n")
        self.assertTrue(process.descendants_seen)
        self.assertEqual(process.descendants_reaped, 1)
        self.assertTrue(result.lifecycle["completed_descendants_proven"])
        self.assertTrue(result.lifecycle["cleanup_complete"])
        self.assertEqual(result.lifecycle["reaped"][0]["pid"], 12346)

    def test_simulated_linux_live_descendant_still_fails_after_cleanup(self):
        process, _ = self.simulated_linux_probe("S")
        metadata, path = self.record("failed-probe")
        self.assertEqual(metadata["exit_code"], 128)
        self.assertTrue(metadata["lifecycle"]["cleanup_complete"])
        self.assertFalse(metadata["lifecycle"]["completed_descendants_proven"])
        self.assertIn("original Git stdout", (path / "stdout.log").read_text())
        self.assertIn("different users", (path / "stderr.log").read_text())

    def test_simulated_linux_unreaped_descendant_keeps_cleanup_failure(self):
        process, _ = self.simulated_linux_probe("Z", unreapable=True)
        metadata, _ = self.record("failed-probe")
        self.assertIsNone(process.returncode)  # Leader identity stays unreaped.
        self.assertFalse(metadata["lifecycle"]["cleanup_complete"])
        self.assertIn("owned descendants remain", metadata["cleanup_exception"])

    def test_simulated_linux_new_child_cannot_use_zombie_exception(self):
        process, _ = self.simulated_linux_probe("Z", new_child=True)
        metadata, _ = self.record("failed-probe")
        self.assertEqual(metadata["exit_code"], 128)
        self.assertTrue(metadata["lifecycle"]["cleanup_complete"])
        self.assertFalse(metadata["lifecycle"]["completed_descendants_proven"])

    def test_linux_child_metadata_parser_checks_pid_parent_and_group(self):
        fields = ["Z", str(os.getpid()), "12345", "12345"] + ["0"] * 15 + ["77"]
        text = "12346 (git pack-objects) " + " ".join(fields)
        with patch.object(Path, "read_text", return_value=text):
            metadata = owned_child_metadata(12345, 12346)
        self.assertEqual(metadata, dict(pid=12346, name="git pack-objects", state="Z",
                                       ppid=os.getpid(), pgid=12345, start_ticks=77))
        for bad in (text.replace("12346", "12347", 1), text.replace("Z " + str(os.getpid()), "Z 1"),
                    text.replace("12345", "12344", 1)):
            with self.subTest(stat=bad), patch.object(Path, "read_text", return_value=bad), \
                 self.assertRaisesRegex(RuntimeError, "identity differs"):
                owned_child_metadata(12345, 12346)

    def test_failure_diagnostic_is_bounded_redacted_and_keeps_raw_evidence(self):
        secret = "synthetic-private-value"
        output = io.StringIO()
        with patch.dict(os.environ, SYNTHETIC_TEST_SECRET=secret), contextlib.redirect_stderr(output), \
             self.assertRaisesRegex(RuntimeError, "left descendants"):
            parent = "import subprocess,sys; print('" + secret + "',flush=True); subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)'])"
            recorded_run([sys.executable, "-c", parent], "redacted-failure", dict(synthetic=True))
        diagnostic = output.getvalue()
        self.assertIn("Test failure diagnostic:", diagnostic)
        self.assertIn("[REDACTED]", diagnostic)
        self.assertNotIn(secret, diagnostic)
        self.assertLess(len(diagnostic), 7100)
        metadata, path = self.record("redacted-failure")
        self.assertIn(secret, (path / "stdout.log").read_text())
        self.assertTrue(metadata["lifecycle"]["cleanup_complete"])
        self.assert_isolated(metadata)

    def test_large_failure_diagnostic_remains_valid_bounded_json(self):
        result = subprocess.CompletedProcess(["synthetic-command", *["x" * 1000] * 40], 128,
                                             "PASSWORD=synthetic-private " + "o" * 4000, "fatal: " + "e" * 4000)
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            emit_failure_diagnostic("large-diagnostic", result)
        text = output.getvalue()
        self.assertLess(len(text), 7100)
        summary = json.loads(text.removeprefix("Test failure diagnostic: "))
        self.assertEqual(summary["exit_code"], 128)
        self.assertTrue(summary["truncated"])
        self.assertIn("fatal:", summary["stderr"])
        self.assertNotIn("synthetic-private", text)

    def test_timeout_kills_descendant_after_leader_exits_on_term(self):
        parent_pid, child_pid = self.root / "parent.pid", self.root / "child.pid"
        ready = self.root / "child.ready"
        child = "import os,signal,time; from pathlib import Path; signal.signal(signal.SIGTERM,signal.SIG_IGN); Path(" + repr(str(child_pid)) + ").write_text(str(os.getpid())); print('descendant stdout',flush=True); Path(" + repr(str(ready)) + ").write_text('ready'); time.sleep(30)"
        parent = "import os,subprocess,sys,time; from pathlib import Path; Path(" + repr(str(parent_pid)) + ").write_text(str(os.getpid())); subprocess.Popen([sys.executable,'-u','-c'," + repr(child) + "]); time.sleep(30)"
        killpg = os.killpg
        pinned_at_kill = []
        def signal_group(pgid, sig):
            if sig == signal.SIGKILL:
                pinned_at_kill.append(child_exited(pgid))
            return killpg(pgid, sig)
        with patch.object(os, "killpg", side_effect=signal_group), \
             patch(__name__ + ".wait_child_exit", side_effect=wait_after_fixture_ready([ready])), \
             self.assertRaises(subprocess.TimeoutExpired):
            recorded_run([sys.executable, "-u", "-c", parent], "leader-term-exit", dict(synthetic=True), timeout=0.5)
        self.assertEqual(pinned_at_kill, [True])
        for path in (parent_pid, child_pid):
            with self.assertRaises(ProcessLookupError):
                os.kill(int(path.read_text()), 0)
        metadata, path = self.record("leader-term-exit")
        self.assertTrue(metadata["timed_out"])
        self.assertIsNone(metadata["cleanup_exception"])
        self.assertIn("descendant stdout", (path / "stdout.log").read_text())
        self.assert_isolated(metadata)

    def test_fixture_readiness_failures_are_not_timeouts_and_still_clean_up(self):
        for early_exit in (False, True):
            name = "readiness-early-exit" if early_exit else "readiness-missing"
            command = [sys.executable, "-c", "pass" if early_exit else "import time; time.sleep(30)"]
            ready = self.root / name
            wait = wait_after_fixture_ready([ready], readiness_timeout=10 if early_exit else 0.1)
            reason = "fixture exited before readiness" if early_exit else "fixture readiness timeout"
            with self.subTest(early_exit=early_exit), \
                 patch(__name__ + ".wait_child_exit", side_effect=wait), \
                 self.assertRaisesRegex(RuntimeError, reason):
                recorded_run(command, name, dict(synthetic=True), timeout=0.5)
            metadata, _ = self.record(name)
            self.assertFalse(metadata["timed_out"])
            self.assertIsNone(metadata["cleanup_exception"])
            self.assertTrue(metadata["lifecycle"]["cleanup_complete"])
            self.assertIn("RuntimeError: " + reason, metadata["exception"])
            self.assert_isolated(metadata)

    def test_fixture_readiness_preserves_the_requested_timeout(self):
        ready = self.root / "delayed.ready"
        command = [sys.executable, "-u", "-c", "import time; from pathlib import Path; time.sleep(0.2); "
                   "print('initialized',flush=True); Path(" + repr(str(ready)) + ").write_text('ready'); time.sleep(30)"]
        with patch(__name__ + ".wait_child_exit", side_effect=wait_after_fixture_ready([ready])), \
             self.assertRaises(subprocess.TimeoutExpired) as caught:
            recorded_run(command, "readiness-then-timeout", dict(synthetic=True), timeout=0.1)
        self.assertEqual(caught.exception.timeout, 0.1)
        self.assertTrue(ready.is_file())
        metadata, path = self.record("readiness-then-timeout")
        self.assertTrue(metadata["timed_out"])
        self.assertIn("initialized", (path / "stdout.log").read_text())
        self.assertTrue(metadata["lifecycle"]["cleanup_complete"])
        self.assert_isolated(metadata)

    def test_normal_exit_with_descendants_fails_after_cleanup(self):
        child = "import time; time.sleep(30)"
        parent = "import subprocess,sys; subprocess.Popen([sys.executable,'-c'," + repr(child) + "])"
        with self.assertRaisesRegex(RuntimeError, "left descendants"):
            recorded_run([sys.executable, "-c", parent], "normal-descendants", dict(synthetic=True))
        metadata, _ = self.record("normal-descendants")
        self.assertIn("left descendants", metadata["exception"])
        self.assert_isolated(metadata)

    def test_final_signal_precedes_reaping_even_after_leader_exits(self):
        create, killpg = subprocess.Popen, os.killpg
        owned, events = [], []
        def popen(*args, **kwargs):
            process = create(*args, **kwargs)
            if args[0][0] == "/bin/ps":
                return process
            owned.append(process)
            wait = process.wait
            def reap(*args, **kwargs):
                events.append("reap")
                return wait(*args, **kwargs)
            process.wait = reap
            return process
        def signal_group(pgid, sig):
            if sig:
                self.assertEqual(pgid, owned[0].pid)
                self.assertIsNone(owned[0].returncode)
                self.assertTrue(child_exited(pgid))
                events.append(sig)
            return killpg(pgid, sig)
        with patch.object(subprocess, "Popen", side_effect=popen), patch.object(os, "killpg", side_effect=signal_group):
            result = recorded_run([sys.executable, "-c", "pass"], "already-exited", dict(synthetic=True))
        self.assertEqual(result.returncode, 0)
        self.assertEqual(events, [signal.SIGTERM, signal.SIGKILL, "reap"])
        self.assert_isolated(self.record("already-exited")[0])

    def test_keyboard_interrupt_cleans_only_owned_group(self):
        self.injected_run(KeyboardInterrupt("injected KeyboardInterrupt"))

    def test_ordinary_exception_cleans_only_owned_group(self):
        self.injected_run(ValueError("injected ordinary exception"))

    def test_system_exit_cleans_only_owned_group(self):
        self.injected_run(SystemExit("injected SystemExit"))

    def test_original_exception_and_cleanup_failure_both_survive(self):
        self.injected_run(KeyboardInterrupt("original interrupt"), RuntimeError("injected cleanup failure"))

    def test_term_failure_still_kills_and_returns_failure(self):
        command, _ = self.command()
        killpg = os.killpg
        events = []
        def fail_term(pgid, sig):
            if sig:
                events.append(sig)
            if sig == signal.SIGTERM:
                raise PermissionError("injected TERM failure")
            return killpg(pgid, sig)
        with patch.object(os, "killpg", side_effect=fail_term), self.assertRaises(subprocess.TimeoutExpired) as caught:
            recorded_run(command, "term-failure", dict(synthetic=True), timeout=0.2)
        self.assertEqual(events, [signal.SIGTERM, signal.SIGKILL])
        self.assertIn("injected TERM failure", str(caught.exception.cleanup_error))
        metadata, _ = self.record("term-failure")
        self.assertTrue(metadata["timed_out"])
        self.assertIn("FAILED", metadata["cleanup"])
        self.assert_isolated(metadata)

    def test_reaped_leader_refuses_all_signals(self):
        process = subprocess.Popen([sys.executable, "-c", "pass"], start_new_session=True)
        process.wait(timeout=5)
        with patch.object(os, "killpg") as send, self.assertRaisesRegex(RuntimeError, "reaped"):
            terminate_group(process)
        send.assert_not_called()

    def test_stale_returncode_cannot_bypass_child_identity(self):
        process = subprocess.Popen([sys.executable, "-c", "pass"], start_new_session=True)
        process.wait(timeout=5)
        process.returncode = None  # Fault injection: consumed child wait identity.
        try:
            with patch.object(os, "killpg") as send, self.assertRaises(ChildProcessError):
                terminate_group(process)
            send.assert_not_called()
        finally:
            process.returncode = 0

    def test_repeated_cleanup_refuses_further_signals(self):
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True)
        terminate_group(process)
        with patch.object(os, "killpg") as send, self.assertRaisesRegex(RuntimeError, "repeated"):
            terminate_group(process)
        send.assert_not_called()

    def test_linux_waitid_contract_portable_simulation(self):
        # This is an API-contract mock, explicitly NOT real Linux evidence.
        info = type("WaitInfo", (), {"si_pid": 12345})()
        with patch.object(os, "waitid", create=True, return_value=info) as wait:
            self.assertTrue(child_exited(12345))
        wait.assert_called_once_with(os.P_PID, 12345, os.WEXITED | os.WNOHANG | os.WNOWAIT)

    @unittest.skipUnless(sys.platform == "linux", "NOT RUN: native Linux WNOWAIT/subreaper required")
    def test_linux_adoption_reaps_only_owned_children_before_leader(self):
        code = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(30)']); time.sleep(.1)"
        with self.assertRaisesRegex(RuntimeError, "left descendants"):
            recorded_run([sys.executable, "-c", code], "linux-adoption", dict(synthetic=True))
        self.assert_isolated(self.record("linux-adoption")[0])

    @unittest.skipUnless(sys.platform == "linux", "NOT RUN: native Linux zombie adoption required")
    def test_linux_already_exited_adopted_child_preserves_original_status(self):
        for status in (0, 23):
            child = "import sys; print('exited child'); print('child err',file=sys.stderr)"
            parent = "import os,subprocess,sys; p=subprocess.Popen([sys.executable,'-c'," + repr(child) + "]); os.waitid(os.P_PID,p.pid,os.WEXITED|os.WNOWAIT); os._exit(" + str(status) + ")"
            name = "native-zombie-" + str(status)
            result = recorded_run([sys.executable, "-c", parent], name, dict(synthetic=True), expected_status=status)
            self.assertEqual(result.returncode, status)
            self.assertEqual(result.stdout, "exited child\n")
            self.assertEqual(result.stderr, "child err\n")
            self.assertTrue(result.lifecycle["before_cleanup"])
            self.assertTrue(all(child["state"] == "Z" for child in result.lifecycle["before_cleanup"]))
            self.assertTrue(result.lifecycle["completed_descendants_proven"])
            self.assertTrue(result.lifecycle["cleanup_complete"])
            self.assert_isolated(self.record(name)[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
