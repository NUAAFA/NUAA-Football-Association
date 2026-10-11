#!/usr/bin/env python3
"""Small synthetic archives and real local Git/Bash; never touch /srv or live data."""
import contextlib
import copy
from datetime import datetime, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
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
                    platform=sys.platform, uid=os.getuid(), inputs=inputs)
    for name, value in (("stdout.log", result.stdout), ("stderr.log", result.stderr),
                        ("input.sh", script), ("result.json", json.dumps(metadata, indent=2) + "\n")):
        with (destination / name).open("x") as output:
            output.write(value)
        (destination / name).chmod(0o644)
    return destination


def recorded_run(args, case_name, inputs, script="", expected_status=0, timeout=120, **kwargs):
    started_at = datetime.now(timezone.utc).isoformat()
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, **kwargs)
    except (subprocess.TimeoutExpired, OSError) as error:
        def decoded(value):
            return value.decode(errors="replace") if isinstance(value, bytes) else value or ""
        result = subprocess.CompletedProcess(args, None, decoded(getattr(error, "stdout", "")),
                                             decoded(getattr(error, "stderr", "")) + "\n" + str(error))
        result.timed_out = isinstance(error, subprocess.TimeoutExpired)
        case_evidence(case_name, result, inputs, started_at, script, expected_status)
        raise
    case_evidence(case_name, result, inputs, started_at, script, expected_status)
    return result


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
        packages = {"node_modules/" + n: {"version": v, "integrity": "synthetic-locked"} for n, v in (("next", "16.3.8"), ("prisma", "7.9.1"), ("@prisma/client", "7.9.1"))}
        (cls.source / "package-lock.json").write_bytes(A.json_bytes({"packages": packages}))
        (cls.source / "package.json").write_text('{"name":"synthetic","private":true}\n')
        for i in range(17):
            p = cls.source / f"prisma/migrations/202600{i:02}_synthetic/migration.sql"
            p.parent.mkdir(parents=True)
            p.write_text("-- synthetic immutable migration\n")
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
        (cls.source / "src/synthetic.ts").write_text("synthetic candidate\n")
        run("git", "-C", str(cls.source), "add", ".")
        run("git", "-C", str(cls.source), "commit", "-m", "synthetic candidate")
        cls.commit = run("git", "-C", str(cls.source), "rev-parse", "HEAD")
        for name in A.REQUIRED - A.SOURCE_FILES - {"prisma/schema.prisma", "node_modules/.bin/tsx", "node_modules/.bin/prisma"}:
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
        with patch.object(A, "platform_info", return_value=PLATFORM), contextlib.redirect_stdout(io.StringIO()):
            A.pack(old_source, cls.old_archive, cls.old)
        cls.old_checksum = A.file_digest(cls.old_archive)

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
            db.execute("CREATE TABLE _prisma_migrations (migration_name TEXT, checksum TEXT, started_at INTEGER, finished_at TEXT, rolled_back_at TEXT)")
        A.migration_ready(dest, self.source, dbpath)
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
            db.executescript("CREATE TABLE Referee (status TEXT, studentId TEXT); INSERT INTO Referee VALUES ('ACTIVE','SYNTHETIC001'); CREATE TABLE _prisma_migrations (migration_name TEXT, checksum TEXT, started_at INTEGER, finished_at TEXT, rolled_back_at TEXT);")
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
        self.execute_case(case_name, case, extra, initial_import, deployer, helper, expected_status)
        if not changed_fixture:
            self.assertEqual(A.file_digest(case / "shared/prisma/dev.db"), before)
        self.assertEqual((case / "shared/.env.production").read_text(), "SYNTHETIC=1\n")
        self.assertEqual(list(case.glob(".prebuilt-import.*")), [])
        return case

    def execute_case(self, case_name, case, extra, initial_import=True, deployer=None, helper=None, expected_status=0):
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
        self.assertIsNone(timed_out["exit_code"])

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
        extra = 'rm -rf "$release_root/$OLD"\nmain --import-artifact ' + str(self.old_archive) + ' --artifact-sha256 ' + self.old_checksum + ' "$OLD"\n'
        extra += 'ensure_shared_links "$release_root/$OLD"\nmkdir "$prebuilt_approvals"\ncat >"$prebuilt_approvals/$COMMIT.json" <<\'JSON\'\n' + json.dumps(approval) + '\nJSON\n'
        extra += r'''
wait_for_health() { echo health >> "$CASE/events"; test "$(readlink "$current_link")" = "$release_root/$OLD"; }
expect_fail --activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"
run_prebuilt_helper check-state --path "$activation_state" --current "$current_link"
"$prebuilt_python" - "$activation_state" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['phase'] == 'ROLLED_BACK'
PY
test "$(readlink "$current_link")" = "$release_root/$OLD"
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
                         'mkdir "$prebuilt_approvals"\ncat >"$prebuilt_approvals/$COMMIT.json" <<\'JSON\'\n' + json.dumps(approval) + '\nJSON\n')
                changes = {
                    "source": 'printf tamper >> "$release_root/$OLD/src/synthetic.ts"',
                    "source-missing": 'rm "$release_root/$OLD/src/synthetic.ts"',
                    "build": 'rm "$release_root/$OLD/.next/BUILD_ID"',
                    "shared-link": 'rm "$release_root/$OLD/.env.production"; ln -s "$shared/prisma/dev.db" "$release_root/$OLD/.env.production"',
                    "shared-mode": 'chmod 0666 "$shared/.env.production"',
                    "migration": 'printf tamper >> "$release_root/$OLD/prisma/migrations/20260000_synthetic/migration.sql"',
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
                    extra += 'expect_fail --activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"\ntest "$(readlink "$current_link")" = "$release_root/$OLD"\n'
                extra += restore
                case = self.deploy_case("activation-" + kind, extra, changed_fixture=kind == "identity")
                if kind in ("identity", "approval-fail"):
                    self.assertFalse((case / "events").exists())
                else:
                    events = (case / "events").read_text().splitlines()
                    self.assertEqual(events[:3], ["backup", "stop", "migrate"])
                    self.assertEqual(events.count("migrate"), 1)
                    self.assertNotIn("forbidden-build", events)
                    self.assertEqual(events[3:5], ["restart", "health"] if kind == "success" else (["restart", "restart"] if kind == "restart" else ["restart", "health"]))

    def test_recovery_final_state_and_failure_matrix(self):
        for kind in ("new-restart", "new-health", "old-restart", "old-health", "old-link", "migration", "backup", "stop", "interrupt", "ordinary-error"):
            with self.subTest(kind=kind):
                approval = dict(format=1, commit=self.commit, artifact_sha256=self.checksum, allowed_ref="refs/heads/main", security_gate="PASS", linux_artifact_validation="PASS", human_review="APPROVED")
                extra = 'mkdir "$prebuilt_approvals"\ncat >"$prebuilt_approvals/$COMMIT.json" <<\'JSON\'\n' + json.dumps(approval) + '\nJSON\n'
                if kind in ("new-restart", "old-restart"):
                    extra += 'restart_service() { echo restart >>"$CASE/events"; '
                    extra += 'test "$(basename "$(readlink "$current_link")")" = "$OLD"; }\n' if kind == "new-restart" else 'return 1; }\n'
                if kind in ("new-health", "old-health", "old-link"):
                    extra += 'wait_for_health() { echo health >>"$CASE/events"; '
                    extra += 'test "$(basename "$(readlink "$current_link")")" = "$OLD"; }\n' if kind in ("new-health", "old-link") else 'return 1; }\n'
                if kind == "old-link":
                    extra += 'atomic_replace_path() { if [ "$2" = "$current_link" ] && [ "$(readlink "$1")" = "$release_root/$OLD" ]; then return 7; fi; "$student_id_preflight_node" -e \'require("fs").renameSync(process.argv[1],process.argv[2])\' "$1" "$2"; }\n'
                if kind == "migration": extra += 'run_migration() { echo migrate >>"$CASE/events"; return 7; }\n'
                if kind == "backup": extra += 'run_prebuilt_backup() { echo backup >>"$CASE/events"; return 7; }\n'
                if kind == "stop": extra += 'stop_service() { echo stop >>"$CASE/events"; return 7; }\n'
                if kind == "interrupt": extra += 'run_migration() { echo migrate >>"$CASE/events"; "$student_id_preflight_node" -e \'process.kill(process.ppid, "SIGTERM")\'; }\n'
                if kind == "ordinary-error": extra += 'atomic_switch_current() { return 7; }\n'
                extra += 'expect_fail --activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"\n'
                if kind != "backup":
                    phase = "ROLLED_BACK" if kind in ("new-restart", "new-health", "stop") else "MANUAL_REQUIRED"
                    extra += '"$prebuilt_python" - "$activation_state" <<\'PY\'\nimport json,sys\nassert json.load(open(sys.argv[1]))["phase"] == ' + repr(phase) + '\nPY\n'
                if kind not in ("old-link", "ordinary-error"):
                    extra += 'test "$(readlink "$current_link")" = "$release_root/$OLD"\n'
                if kind not in ("backup", "new-restart", "new-health", "stop"):
                    extra += 'expect_fail --activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"\n'
                case = self.deploy_case("recovery-final-" + kind, extra)
                events = (case / "events").read_text().splitlines()
                self.assertLessEqual(events.count("migrate"), 1)
                if kind in ("new-restart", "new-health", "stop"):
                    self.assertEqual(events[-1], "health")
                elif kind != "backup": self.assertEqual(events[-1], "stop")



if __name__ == "__main__":
    unittest.main(verbosity=2)
