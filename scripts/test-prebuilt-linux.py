#!/usr/bin/env python3
"""Real root/app ownership tests on a disposable Ubuntu runner only.

Synthetic archive binaries are fixtures, not native-runtime evidence. Optional
--archive tests the real CI artifact as a nonprivileged user after relocation.
No production paths, service installation, credentials or network deployment.
"""
import argparse
import contextlib
import grp
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
from prebuilt_test_support import exclusive_fixture, resolve_runuser, resolve_system_command, trusted_path, fixture_parent

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("fixtures", REPO / "scripts/test-prebuilt-artifact.py")
F = importlib.util.module_from_spec(spec)
spec.loader.exec_module(F)
A = F.A
RUNUSER = None
RUNTIME_FIXTURE_FILES = ("scripts/test-prebuilt-runtime.mjs", "ops/deploy/nuaafa-deploy")


class FixtureResources:
    """Track only this invocation's directory/account identities, even on failure."""
    def __init__(self):
        self.root = None
        self.root_identity = None
        self.user = None
        self.account = None
        self.group = None

    def remember_root(self, root):
        self.root = root
        info = root.lstat()
        self.root_identity = (info.st_dev, info.st_ino, info.st_uid)

    def check_root_identity(self):
        info = self.root.lstat()
        if not stat.S_ISDIR(info.st_mode) or (info.st_dev, info.st_ino, info.st_uid) != self.root_identity:
            raise ValueError("refusing cleanup of replaced fixture root: " + str(self.root))

    def create_user(self):
        self.user = "nuaafa_t" + secrets.token_hex(6)
        self.home = str(self.root / "home")
        self.marker = "nuaafa-test-" + self.root.name
        for lookup in (pwd.getpwnam, grp.getgrnam):
            try:
                lookup(self.user)
            except KeyError:
                continue
            raise ValueError("temporary account/group already exists: " + self.user)
        try:
            subprocess.run([resolve_system_command("useradd"), "--system", "--user-group", "--no-create-home",
                            "--home-dir", self.home, "--comment", self.marker, self.user], check=True)
        finally:
            # useradd can create an account/group and then fail. A unique marker
            # and prior absence bind partial creation to this invocation.
            try:
                account = pwd.getpwnam(self.user)
            except KeyError:
                account = None
            if account is not None:
                if (account.pw_dir, account.pw_gecos) != (self.home, self.marker):
                    raise ValueError("unrecognized partial account; will not delete: " + self.user)
                self.account = account
            try:
                self.group = grp.getgrnam(self.user)
            except KeyError:
                pass
        if self.account is None or self.group is None or self.account.pw_gid != self.group.gr_gid:
            raise ValueError("temporary application user/group creation incomplete")
        return self.account

    def cleanup(self):
        failures = []
        if self.account is not None:
            try:
                try:
                    current = pwd.getpwnam(self.user)
                except KeyError:
                    current = None
                if current is not None:
                    if tuple(current) != tuple(self.account):
                        raise ValueError("refusing deletion of changed account: " + self.user)
                    subprocess.run([resolve_system_command("userdel"), self.user], check=True, capture_output=True, text=True)
                try:
                    pwd.getpwnam(self.user)
                except KeyError:
                    self.account = None
                else:
                    raise ValueError("temporary user remains: " + self.user)
            except Exception as error:
                failures.append("user cleanup: " + str(error))
        if self.group is not None:
            try:
                try:
                    current = grp.getgrnam(self.user)
                except KeyError:
                    current = None
                if current is not None:
                    if tuple(current) != tuple(self.group) or current.gr_mem or any(a.pw_gid == current.gr_gid for a in pwd.getpwall()):
                        raise ValueError("refusing deletion of changed/in-use group: " + self.user)
                    subprocess.run([resolve_system_command("groupdel"), self.user], check=True, capture_output=True, text=True)
                try:
                    grp.getgrnam(self.user)
                except KeyError:
                    self.group = None
                else:
                    raise ValueError("temporary group remains: " + self.user)
            except Exception as error:
                failures.append("group cleanup: " + str(error))
        if self.root is not None:
            try:
                if os.path.lexists(self.root):
                    self.check_root_identity()
                    shutil.rmtree(self.root)
                if os.path.lexists(self.root):
                    raise ValueError("fixture root remains: " + str(self.root))
            except Exception as error:
                failures.append("fixture cleanup: " + str(error))
        print("fixture cleanup: " + json.dumps(dict(root=str(self.root), user=self.user,
              owned_user_removed=self.account is None, owned_group_removed=self.group is None,
              root_removed=self.root is None or not os.path.lexists(self.root), failures=failures)), file=sys.stderr)
        if failures:
            raise RuntimeError("; ".join(failures))


def run(args, **kwargs):
    # Git/Bash/runuser probes can spawn descendants too. Keep the same cleanup
    # guarantee as import/runtime cases; the caller asserts each probe's status.
    return F.recorded_run(args, "linux-command", dict(command=list(map(str, args)), status_asserted_by_caller=True),
                          expected_status=None, timeout=kwargs.pop("timeout", 120), **kwargs)


def user_git(user, *args):
    account = pwd.getpwnam(user)
    # No inherited Git config or wildcard trust exception. Run source operations
    # as its actual owner; all destination operations use the application UID.
    command = ["/usr/bin/git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", *map(str, args)]
    return run([RUNUSER or resolve_runuser(), "-u", user, "--", "env", "-i", "PATH=/usr/bin:/bin",
                "HOME=" + account.pw_dir, "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null",
                "GIT_OPTIONAL_LOCKS=0", *command])


def path_metadata(path):
    """Metadata only; never disclose source, configuration or account contents."""
    records = []
    for item in (path, *path.parents):
        record = dict(path=str(item))
        try:
            info = item.lstat()
            record.update(uid=info.st_uid, gid=info.st_gid, mode=oct(stat.S_IMODE(info.st_mode)),
                          file_type=stat.S_IFMT(info.st_mode), symlink=stat.S_ISLNK(info.st_mode))
        except OSError as error:
            record["error"] = str(error)
        records.append(record)
    return records


def stage_runtime_fixture(source, destination, commit):
    """Seal exact Git-blob bytes outside a checkout the app may not traverse."""
    A.exact_sha(commit)
    source = source.resolve(strict=True)
    owner = pwd.getpwuid(source.stat().st_uid).pw_name
    def checked(*args):
        result = user_git(owner, "-C", source, *args)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
        return result.stdout.strip()
    if checked("rev-parse", "HEAD^{commit}") != commit:
        raise ValueError("runtime fixture source HEAD differs from exact commit")
    payloads, records = {}, {}
    for name in RUNTIME_FIXTURE_FILES:
        original = source / name
        tree_entry = checked("ls-tree", commit, "--", name)
        match = re.fullmatch(r"100(?:644|755) blob ([0-9a-f]{40})\t" + re.escape(name), tree_entry)
        if not match:
            raise ValueError("runtime fixture is not an exact regular Git blob: " + name)
        with A.open_regular(original) as stream:
            data = stream.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise ValueError("oversized runtime fixture source: " + name)
        blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if blob != match[1]:
            raise ValueError("runtime fixture source differs from exact commit: " + name)
        payloads[name] = data
        records[name] = dict(source=str(original), git_blob=blob, sha256=A.digest(data),
                             source_metadata=path_metadata(original), staged=str(destination / name))
    trusted_path(destination.parent)
    destination.mkdir(mode=0o755)  # Exclusive: never reuse or overwrite a fixture.
    destination.chmod(0o755)
    for relative in ("scripts", "ops", "ops/deploy"):
        directory = destination / relative
        directory.mkdir(mode=0o755)
        directory.chmod(0o755)
    for name, data in payloads.items():
        staged = destination / name
        with staged.open("xb") as output:
            output.write(data)
        staged.chmod(0o644)
        records[name]["staged_sha256"] = A.file_digest(staged)
        records[name]["staged_metadata"] = path_metadata(staged)
    identity = dict(commit=commit, source_owner=owner, root=str(destination), files=records)
    verify_runtime_fixture(identity)
    return identity


def verify_runtime_fixture(identity):
    for name in RUNTIME_FIXTURE_FILES:
        record = identity["files"][name]
        staged = trusted_path(Path(record["staged"]), kind="file")
        with A.open_regular(staged) as stream:
            if A.digest(stream.read()) != record["sha256"] or record["staged_sha256"] != record["sha256"]:
                raise ValueError("staged runtime fixture hash changed: " + name)
        if stat.S_IMODE(staged.stat().st_mode) != 0o644:
            raise ValueError("staged runtime fixture mode changed: " + name)


def runtime_access_evidence(identity, node, app_user):
    """Record actual Linux resolution under both UIDs, without changing modes."""
    account = pwd.getpwnam(app_user)
    environment = {"PATH": "/usr/bin:/bin", "HOME": account.pw_dir}
    result = dict(root_uid=os.geteuid(), app_uid=account.pw_uid, files={})
    for name, record in identity["files"].items():
        probes = result["files"][name] = {}
        for location in ("source", "staged"):
            target = record[location]
            commands = {
                "namei": ["/usr/bin/namei", "-l", target],
                "stat": ["/usr/bin/stat", "-c", "%u %g %a %F %n", target],
                "realpath": ["/usr/bin/realpath", "-e", target],
                "read": ["/usr/bin/test", "-r", target],
            }
            if name.endswith(".mjs"):
                commands["node_resolution"] = [str(node), "--check", target]
            for role in ("root", "app"):
                for label, command in commands.items():
                    if role == "app": command = [RUNUSER or resolve_runuser(), "-u", app_user, "--", *command]
                    probe = run(command, cwd="/", env=environment)
                    probes[location + ":" + role + ":" + label] = dict(exit_code=probe.returncode,
                        stdout=F.bounded_diagnostic(probe.stdout), stderr=F.bounded_diagnostic(probe.stderr),
                        evidence_path=str(probe.evidence_path))
                    if (role == "root" or location == "staged") and probe.returncode:
                        F.emit_failure_diagnostic("runtime-access", probe)
                        raise ValueError("runtime fixture access failed: " + location + ":" + role + ":" + label)
            writable = run([RUNUSER or resolve_runuser(), "-u", app_user, "--", "/usr/bin/test", "-w", record["staged"]],
                           cwd="/", env=environment)
            if writable.returncode != 1:
                raise ValueError("runtime fixture must not be writable by application UID")
    print("Runtime fixture provenance: " + json.dumps(identity), file=sys.stderr)
    print("Runtime fixture access: " + json.dumps(result), file=sys.stderr)
    return result


@contextlib.contextmanager
def runtime_fixture_lifecycle():
    LinuxPermissions.setUpClass()
    try:
        yield
    except BaseException as original:
        A.GIT_USER = None
        try:
            LinuxPermissions.tearDownClass()
        except BaseException as cleanup:
            original.cleanup_error = cleanup
            raise original from cleanup
        raise
    else:
        A.GIT_USER = None
        LinuxPermissions.tearDownClass()


def bundle_remote(source, destination, commit, app_user):
    """Read the exact checkout as its owner, then import a sealed bundle as app."""
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("exact commit required")
    source = source.resolve(strict=True)
    owner = pwd.getpwuid(source.stat().st_uid)
    app = pwd.getpwnam(app_user)
    def checked(user, *args):
        result = user_git(user, *args)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
        return result.stdout.strip()
    if checked(owner.pw_name, "-C", source, "rev-parse", "HEAD^{commit}") != commit:
        raise ValueError("checkout HEAD differs from the archive commit")
    git_dir = Path(checked(owner.pw_name, "-C", source, "rev-parse", "--absolute-git-dir"))
    if git_dir.stat().st_uid != owner.pw_uid:
        raise ValueError("checkout and Git directory owners differ")
    common = Path(checked(owner.pw_name, "-C", source, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    if common.stat().st_uid != owner.pw_uid:
        raise ValueError("common Git directory owner differs")
    def object_inventory():
        return {str(p.relative_to(common)): A.file_digest(p) for p in (common / "objects").rglob("*") if p.is_file()}
    objects_before = object_inventory()
    before = checked(owner.pw_name, "-C", source, "show-ref")
    transfer = destination.parent / (destination.name + "-bundle")
    transfer.mkdir(mode=0o700)
    os.chown(transfer, owner.pw_uid, owner.pw_gid)
    bundle = transfer / "source.bundle"
    checked(owner.pw_name, "-C", source, "bundle", "create", bundle, "HEAD")
    bundle.chmod(0o644); os.chown(bundle, 0, 0)
    os.chown(transfer, 0, 0); transfer.chmod(0o755)
    destination.mkdir(mode=0o755)
    os.chown(destination, app.pw_uid, app.pw_gid)
    checked(app_user, "init", "--bare", "--initial-branch=main", destination)
    checked(app_user, "-C", destination, "bundle", "verify", bundle)
    if checked(app_user, "-C", destination, "bundle", "list-heads", bundle) != commit + " HEAD":
        raise ValueError("bundle must contain only the exact HEAD identity")
    checked(app_user, "-C", destination, "fetch", "--no-tags", bundle, "HEAD:refs/heads/main")
    if checked(app_user, "-C", destination, "show-ref") != commit + " refs/heads/main":
        raise ValueError("temporary remote ref mismatch")
    if checked(owner.pw_name, "-C", source, "show-ref") != before:
        raise ValueError("source refs changed")
    if checked(owner.pw_name, "-C", source, "rev-parse", "HEAD^{commit}") != commit or object_inventory() != objects_before:
        raise ValueError("source HEAD or Git objects changed")
    identity = dict(checkout=str(source), git_directory=str(git_dir), checkout_uid=owner.pw_uid,
                    root_uid=os.getuid(), app_uid=app.pw_uid, bundle_sha256=A.file_digest(bundle),
                    commit=commit, allowed_ref="refs/heads/main", source_refs_unchanged=True, source_objects_unchanged=True)
    (transfer / "identity.json").write_text(json.dumps(identity, indent=2) + "\n")
    return identity


class LinuxPermissions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform != "linux" or os.geteuid() != 0:
            raise unittest.SkipTest("NOT RUN: real Linux root is required")
        cls.resources = FixtureResources()
        try:
            cls.initialize()
        except BaseException as setup_error:
            try:
                cls.resources.cleanup()
            except Exception as cleanup_error:
                raise RuntimeError("Linux fixture setup failed: " + str(setup_error) +
                                   "; cleanup failed: " + str(cleanup_error)) from setup_error
            raise

    @classmethod
    def initialize(cls):
        global RUNUSER
        RUNUSER = resolve_runuser()
        cls.root = exclusive_fixture(cls.resources)
        cls.account = cls.resources.create_user()
        cls.user = cls.resources.user
        (cls.root / "home").mkdir(mode=0o700)
        os.chown(cls.root / "home", cls.account.pw_uid, cls.account.pw_gid)
        cls.helper = cls.root / "trusted/prebuilt-artifact.py"
        cls.helper.parent.mkdir(mode=0o755)
        shutil.copyfile(REPO / "ops/deploy/prebuilt-artifact.py", cls.helper)
        cls.helper.chmod(0o644)
        cls.node = cls.root / "trusted/node"
        shutil.copyfile(shutil.which("node"), cls.node)
        cls.node.chmod(0o755)
        cls.guard = cls.root / "trusted/student-id-release-preflight.mjs"
        shutil.copyfile(REPO / "scripts/student-id-release-preflight.mjs", cls.guard)
        cls.guard.chmod(0o644)
        old_tempdir = tempfile.tempdir
        tempfile.tempdir = str(cls.root)
        try:
            F.PLATFORM.update(A.platform_info())
            F.ArtifactTests.setUpClass()
        finally:
            tempfile.tempdir = old_tempdir
        F.ArtifactTests.root.chmod(0o755)
        subprocess.run(["chown", "-R", cls.user + ":" + cls.user, str(F.ArtifactTests.source)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.resources.cleanup()

    def case(self, case_name, body, archive=None, commit=None, checksum=None, seed=None,
             initial_import=True, previous=None, with_shared=False, allow_events=False,
             preserve_shared=False, timings=False):
        case = self.root / case_name
        case.mkdir(mode=0o755)
        (case / "releases").mkdir(mode=0o755)
        old = case / "releases" / (previous or F.ArtifactTests.old)
        old.mkdir(mode=0o755)
        os.chown(old, self.account.pw_uid, self.account.pw_gid)
        for command in (["git", "clone", "--no-hardlinks", "--no-checkout", str(F.ArtifactTests.source), str(old)],
                        ["git", "-C", str(old), "checkout", "--detach", previous or F.ArtifactTests.old]):
            r = run([RUNUSER, "-u", self.user, "--", *command])
            self.assertEqual(r.returncode, 0, r.stderr)
        (case / "current").symlink_to(old)
        if with_shared:
            (case / "shared/prisma").mkdir(parents=True)
            envfile = case / "shared/.env.production"
            envfile.write_text("SYNTHETIC=1\n"); envfile.chmod(0o640)
            os.chown(envfile, 0, self.account.pw_gid)
            database = case / "shared/prisma/dev.db"
            with sqlite3.connect(database) as db:
                db.executescript("CREATE TABLE Referee (status TEXT, studentId TEXT); INSERT INTO Referee VALUES ('ACTIVE','SYNTHETIC001'); CREATE TABLE _prisma_migrations (migration_name TEXT, checksum TEXT, started_at INTEGER, finished_at TEXT, rolled_back_at TEXT);")
                for i, (migration_name, digest) in enumerate(A.migration_inventory(F.ArtifactTests.source).items()):
                    db.execute("INSERT INTO _prisma_migrations VALUES (?,?,?,'synthetic',NULL)", (migration_name, digest, i))
            database.chmod(0o600); os.chown(database, self.account.pw_uid, self.account.pw_gid)
            (old / ".next").mkdir(); (old / ".next/BUILD_ID").write_text("synthetic old build")
            for shared_link in (".env.production", "prisma/dev.db"): (old / shared_link).symlink_to(case / "shared" / shared_link)
        script = r'''
set -Eeuo pipefail
source "$TEST_REPO/ops/deploy/nuaafa-deploy"
release_root="$CASE/releases"; current_link="$CASE/current"; shared="$CASE/shared"
prebuilt_state="$CASE/prebuilt"; prebuilt_approvals="$CASE/approvals"
activation_state="$CASE/activation.json"; prebuilt_helper="$HELPER"
repository="$SEED"; deploy_user="$APP_USER"; lock_file="$CASE/deploy.lock"
student_id_preflight_node="$NODE"; student_id_preflight_command="$GUARD"
# A call to service control is a failure, never a permission-validation substitute.
systemctl() { echo forbidden-service >> "$CASE/events"; return 99; }
expect_fail() {
 local status
 set +e
 (set -Eeuo pipefail; main "$@")
 status=$?
 set -e
 [ "$status" -ne 0 ] || { echo "unexpected success" >&2; exit 90; }
}
main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"
'''
        if not initial_import:
            script = script.replace('main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"\n', '')
        elif timings:
            script = script.replace('main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"\n',
                                    'prebuilt_timing=true\nprebuilt_phase first_import main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"\n', 1)
        script += body
        env = dict(os.environ, TEST_REPO=str(REPO), CASE=str(case), HELPER=str(self.helper),
                   SEED=str(seed or F.ArtifactTests.source), APP_USER=self.user, ARCHIVE=str(archive or F.ArtifactTests.archive),
                   DIGEST=checksum or F.ArtifactTests.checksum, COMMIT=commit or F.ArtifactTests.commit,
                   OLD=F.ArtifactTests.old, PRIOR=F.ArtifactTests.prior, NODE=str(self.node), GUARD=str(self.guard))
        shared_before = F.shared_snapshot(case)
        result = F.recorded_run(["bash", "-c", script], case_name, dict(commit=env["COMMIT"], archive_sha256=A.file_digest(env["ARCHIVE"]),
                        fixture_checkout_uid=F.ArtifactTests.source.stat().st_uid, root_uid=os.getuid(),
                        app_uid=self.account.pw_uid, remote=env["SEED"], phase_timings=timings,
                        timeout_scope="entire_case"), script, env=env)
        shared_after = F.shared_snapshot(case)
        with (result.evidence_path / "shared-postconditions.json").open("x") as output:
            json.dump(dict(before=shared_before, after=shared_after, equal=shared_before == shared_after,
                           equality_required=preserve_shared), output, indent=2)
        if preserve_shared: self.assertEqual(shared_after, shared_before)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        if not allow_events: self.assertFalse((case / "events").exists())
        self.assertEqual(list(case.glob(".prebuilt-import.*")), [])
        self.assertEqual(list((case / "releases").glob(".prebuilt-*")), [])
        return case

    def test_real_journal_and_link_only_lifecycle(self):
        body = F.ArtifactTests.legacy_setup(self) + r'''
run_db_backup() { echo backup >> "$CASE/events"; }
stop_service() { echo stop >> "$CASE/events"; }
run_migration() { echo migrate >> "$CASE/events"; }
restart_service() { echo restart >> "$CASE/events"; }
wait_for_health() { echo health >> "$CASE/events"; }
main "$OLD"
main --stage-only "$COMMIT"
cp "$activation_state" "$CASE/journal-A"
cp "$CASE/events" "$CASE/events-A"
expect_fail --activate-staged "$COMMIT"
cmp "$activation_state" "$CASE/journal-A"
cmp "$CASE/events" "$CASE/events-A"
test "$(readlink "$current_link")" = "$release_root/$OLD"
main --activate-staged "$OLD"
cmp "$activation_state" "$CASE/journal-A"
cmp "$CASE/events" "$CASE/events-A"
cp "$activation_state" "$CASE/journal-after-A-noop"
cmp "$CASE/journal-after-A-noop" "$CASE/journal-A"
main "$COMMIT"
run_prebuilt_helper check-state --path "$activation_state" --current "$current_link"
cp "$activation_state" "$CASE/journal-B"
main --stage-only "$COMMIT"
main --activate-staged "$COMMIT"
cmp "$activation_state" "$CASE/journal-B"
run_prebuilt_helper state --path "$activation_state" --commit "$COMMIT" --previous "$OLD" --phase MANUAL_REQUIRED
expect_fail --activate-staged "$COMMIT"
'''
        self.case("real-journal", body, initial_import=False, previous=F.ArtifactTests.prior,
                  with_shared=True, allow_events=True)

    def test_real_startup_entry_metadata_identity_and_rejections(self):
        result = run([sys.executable, str(REPO / "scripts/test-start-prebuilt.py")],
                     env=dict(os.environ, NUAAFA_TEST_ROOT=str(self.root), NUAAFA_TEST_APP_USER=self.user))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_legacy_old_release_rejected_before_side_effects(self):
        for kind, change in {
            "source": 'run_as_deploy_user sh -c \'printf tamper >> "$1/src/synthetic.ts"\' test "$release_root/$OLD"',
            "build": 'rm "$release_root/$OLD/.next/BUILD_ID"',
            "shared-mode": 'chmod 0666 "$shared/.env.production"',
            "origin": 'git_in_release "$release_root/$OLD" remote set-url origin /untrusted',
        }.items():
            with self.subTest(kind=kind):
                body = F.ArtifactTests.legacy_setup(self) + r'''
run_db_backup() { echo backup >> "$CASE/events"; }
stop_service() { echo stop >> "$CASE/events"; }
run_migration() { echo migrate >> "$CASE/events"; }
restart_service() { echo restart >> "$CASE/events"; }
wait_for_health() { echo health >> "$CASE/events"; }
''' + change + r'''
expect_fail "$COMMIT"
test ! -e "$CASE/events"
test ! -e "$activation_state"
test "$(readlink "$current_link")" = "$release_root/$OLD"
'''
                self.case("old-precheck-" + kind, body, initial_import=False, with_shared=True)

    def test_real_journal_incomplete_mismatch_and_legacy_absent(self):
        for phase in ("PREPARED", "MIGRATING", "MANUAL_REQUIRED", "mismatch", "absent"):
            with self.subTest(phase=phase):
                body = F.ArtifactTests.legacy_setup(self) + 'main --stage-only "$COMMIT"\n'
                if phase == "absent":
                    body += 'main --activate-staged "$COMMIT"\nmain --activate-staged "$COMMIT"\ntest ! -e "$activation_state"\n'
                else:
                    commit = "$COMMIT" if phase == "mismatch" else "$OLD"
                    body += 'run_prebuilt_helper state --path "$activation_state" --commit "' + commit + '" --previous "$PRIOR" --phase ' + ("HEALTHY" if phase == "mismatch" else phase) + '\n'
                    body += 'cp "$activation_state" "$CASE/journal-before"\nexpect_fail --activate-staged "$COMMIT"\ncmp "$activation_state" "$CASE/journal-before"\ntest "$(readlink "$current_link")" = "$release_root/$OLD"\n'
                self.case("journal-phase-" + phase, body, initial_import=False, with_shared=True)

    def test_real_import_repeat_git_identity_and_sealed_files(self):
        self.case("positive", r'''
main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"
test "$(stat -c %u "$release_root/$COMMIT")" = 0
test "$(stat -c %a "$release_root/$COMMIT")" = 755
run_as_deploy_user test -r "$release_root/$COMMIT/.next/BUILD_ID"
if run_as_deploy_user touch "$release_root/$COMMIT/injected"; then exit 91; fi
if run_as_deploy_user touch "$prebuilt_state/injected"; then exit 92; fi
test "$(git_in_release "$release_root/$COMMIT" rev-parse HEAD)" = "$COMMIT"
expect_fail --activate-prebuilt --artifact-sha256 "$DIGEST" "$COMMIT"
test "$(basename "$(readlink "$current_link")")" != "$COMMIT"
test ! -e "$release_root/$COMMIT/.env.production"
test ! -e "$shared"
mkdir -m 0700 "$CASE/private"
printf synthetic > "$CASE/private/archive"
if run_as_deploy_user cat "$CASE/private/archive"; then exit 93; fi
''')

    def test_real_repeat_import_preserves_shared_receipt_and_links(self):
        self.case("real-repeat-postconditions", r'''
cp "$prebuilt_state/$COMMIT.json" "$CASE/receipt-before"
main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"
cmp "$prebuilt_state/$COMMIT.json" "$CASE/receipt-before"
test "$(readlink "$current_link")" = "$release_root/$OLD"
test ! -e "$activation_state"
test ! -e "$prebuilt_approvals"
test ! -e "$release_root/$COMMIT/.env.production"
test ! -e "$release_root/$COMMIT/prisma/dev.db"
''', with_shared=True, preserve_shared=True)

    def test_cross_uid_bundle_remote_and_wrong_commit(self):
        # Unlike the app-owned synthetic source, this checkout belongs to root.
        source = self.root / "root-checkout"
        shutil.copytree(F.ArtifactTests.source, source, symlinks=True)
        self.assertEqual(source.stat().st_uid, 0)
        self.assertNotEqual(source.stat().st_uid, self.account.pw_uid)
        unsafe = self.root / "unsafe-local.git"
        unsafe.mkdir(mode=0o755); os.chown(unsafe, self.account.pw_uid, self.account.pw_gid)
        actual_uid = run([RUNUSER, "-u", self.user, "--", "/usr/bin/id", "-u"])
        self.assertEqual(actual_uid.returncode, 0, actual_uid.stderr)
        self.assertEqual(actual_uid.stdout.strip(), str(self.account.pw_uid))
        rejected = user_git(self.user, "clone", "--bare", "--no-hardlinks", source, unsafe)
        self.assertNotEqual(rejected.returncode, 0, "cross-owner local-copy protection was not exercised")
        self.assertRegex(rejected.stderr.lower(), r"ownership|different users")
        self.assertTrue(rejected.lifecycle["cleanup_complete"])
        self.assertTrue(rejected.lifecycle["completed_descendants_proven"])
        with self.assertRaises(ValueError):
            bundle_remote(source, self.root / "wrong-head.git", F.ArtifactTests.old, self.user)
        seed = self.root / "bundle-source.git"
        identity = bundle_remote(source, seed, F.ArtifactTests.commit, self.user)
        self.assertEqual(identity["checkout_uid"], 0)
        self.case("bundle-import", 'main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"\n', seed=seed)
        print("Cross-UID Git probe: " + json.dumps(dict(app_uid=self.account.pw_uid, source_uid=source.stat().st_uid,
              actual_uid=int(actual_uid.stdout.strip()), negative_exit_code=rejected.returncode,
              negative_stderr=F.bounded_diagnostic(rejected.stderr), lifecycle=rejected.lifecycle,
              evidence_path=str(rejected.evidence_path), bundle=identity)), file=sys.stderr)

    def test_runtime_driver_private_checkout_and_sealed_fixture(self):
        # Reproduce the failed boundary with real root/app UIDs, without changing
        # any runner directory. Both entry and its relative deployer are needed.
        source = self.root / "private-runtime-source"
        shutil.copytree(F.ArtifactTests.source, source, symlinks=True)
        source.chmod(0o700)
        driver = source / RUNTIME_FIXTURE_FILES[0]
        driver.write_text('import {readFileSync} from "node:fs";\n'
                          'console.log(JSON.stringify({uid:process.getuid(),deployer:readFileSync('
                          'new URL("../ops/deploy/nuaafa-deploy",import.meta.url),"utf8")}));\n')
        deployer = source / RUNTIME_FIXTURE_FILES[1]
        deployer.write_text("synthetic deployer fixture only\n")
        owner = pwd.getpwuid(os.getuid()).pw_name
        for args in (("add", "."), ("commit", "-m", "synthetic isolated runtime driver")):
            result = user_git(owner, "-C", source, *args)
            self.assertEqual(result.returncode, 0, result.stderr)
        head = user_git(owner, "-C", source, "rev-parse", "HEAD").stdout.strip()
        before = source.lstat()
        identity = stage_runtime_fixture(source, self.root / "sealed-runtime-fixture", head)
        evidence = runtime_access_evidence(identity, self.node, self.user)
        negative = evidence["files"][RUNTIME_FIXTURE_FILES[0]]["source:app:node_resolution"]
        self.assertNotEqual(negative["exit_code"], 0)
        self.assertIn("MODULE_NOT_FOUND", negative["stderr"])
        self.assertNotEqual(evidence["files"][RUNTIME_FIXTURE_FILES[0]]["source:app:stat"]["exit_code"], 0)
        original = run([RUNUSER, "-u", self.user, "--", str(self.node), str(driver)], cwd="/")
        self.assertNotEqual(original.returncode, 0)
        self.assertIn("MODULE_NOT_FOUND", original.stderr)
        staged = Path(identity["files"][RUNTIME_FIXTURE_FILES[0]]["staged"])
        actual = run([RUNUSER, "-u", self.user, "--", str(self.node), str(staged)], cwd="/")
        self.assertEqual(actual.returncode, 0, actual.stderr)
        self.assertEqual(json.loads(actual.stdout), dict(uid=self.account.pw_uid, deployer=deployer.read_text()))
        mutation = run([RUNUSER, "-u", self.user, "--", str(self.node), "-e",
                        'require("node:fs").writeFileSync(process.argv[1],"untrusted")', str(staged)], cwd="/")
        self.assertNotEqual(mutation.returncode, 0)
        self.assertIn("EACCES", mutation.stderr)
        verify_runtime_fixture(identity)
        self.assertEqual((source.lstat().st_uid, source.lstat().st_mode), (before.st_uid, before.st_mode))

    def test_wrong_receipt_owner_mode_and_parent(self):
        for kind in ("owner", "mode", "parent", "link"):
            with self.subTest(kind=kind):
                change = {
                    "owner": 'chown "$deploy_user" "$receipt"',
                    "mode": 'chmod 0666 "$receipt"',
                    "parent": 'chmod 0777 "$prebuilt_state"',
                    "link": 'mv "$receipt" "$CASE/saved.json"; ln -s "$CASE/saved.json" "$receipt"',
                }[kind]
                self.case("receipt-" + kind, 'receipt="$prebuilt_state/$COMMIT.json"\n' + change + '\nexpect_fail --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"\n')

    def test_wrong_runtime_owner_mode_and_link(self):
        for kind in ("owner", "mode", "parent", "environment", "link", "cache-link"):
            with self.subTest(kind=kind):
                change = {
                    "owner": 'chown "$deploy_user" "$release_root/$COMMIT/.next/BUILD_ID"',
                    "mode": 'chmod 0666 "$release_root/$COMMIT/.next/BUILD_ID"',
                    "parent": 'chmod 0777 "$release_root/$COMMIT/.next"',
                    "environment": 'touch "$release_root/$COMMIT/.env.production.local"',
                    "link": 'rm "$release_root/$COMMIT/.next/BUILD_ID"; ln -s "$CASE/current" "$release_root/$COMMIT/.next/BUILD_ID"',
                    "cache-link": 'run_as_deploy_user ln -s /etc "$release_root/$COMMIT/.next/cache/escape"',
                }[kind]
                self.case("runtime-" + kind, change + '\nexpect_fail --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"\n')

    def test_actual_root_validator_in_bash_conditions(self):
        # Never replace verify_root_metadata. Exercise the exact failure context.
        candidate = self.root / "bad-helper.py"
        candidate.write_text("raise RuntimeError('UNTRUSTED HELPER EXECUTED')\n")
        candidate.chmod(0o666)
        # Prove the same ancestor chain passes before introducing a bad leaf.
        positive = run(["bash", "-c", 'source "$1/ops/deploy/nuaafa-deploy"; verify_root_metadata "$2"',
                        "test", str(REPO), str(self.helper)])
        self.assertEqual(positive.returncode, 0, positive.stderr)
        with self.assertRaisesRegex(ValueError, re.escape(str(candidate)) + ": group/world writable"):
            trusted_path(candidate, kind="file")
        result = run(["bash", "-c", 'source "$1/ops/deploy/nuaafa-deploy"; prebuilt_helper="$2"; if run_prebuilt_helper platform; then exit 90; fi; verify_root_metadata "$2" && exit 91; exit 0', "test", str(REPO), str(candidate)])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("STOP", result.stderr)
        self.assertIn("trusted metadata is writable by non-root users", result.stderr)
        self.assertNotIn("UNTRUSTED HELPER EXECUTED", result.stderr)

    def test_service_contract_actual_metadata_and_environment_rejection(self):
        contract = self.root / "service-contract"
        contract.mkdir()
        for name in ("start", "unit", "dropin"):
            (contract / name).write_text("synthetic trusted metadata\n")
            (contract / name).chmod(0o755 if name == "start" else 0o644)
        script = r'''source "$TEST_REPO/ops/deploy/nuaafa-deploy"
prebuilt_start="$CONTRACT/start"; current_link="$CONTRACT/current"; deploy_user="$APP_USER"
systemctl() {
 case "$4" in
  User) echo "$deploy_user";;
  WorkingDirectory) echo "$current_link";;
  FragmentPath) echo "$CONTRACT/unit";;
  DropInPaths) echo "$CONTRACT/dropin";;
  ExecStart) echo "{ path=$prebuilt_start ; argv[]=$prebuilt_start ; ignore_errors=no ; }";;
  Environment) [ "${BAD_ENV:-}" != yes ] || echo 'LD_PRELOAD=/unreviewed';;
 esac
 return 0
}
verify_service_contract || exit 90
BAD_ENV=yes
if verify_service_contract; then exit 91; fi
BAD_ENV=no
chmod 0666 "$CONTRACT/dropin"
if verify_service_contract; then exit 92; fi
'''
        result = run(["bash", "-c", script], env=dict(os.environ, TEST_REPO=str(REPO), CONTRACT=str(contract), APP_USER=self.user))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class HarnessTests(unittest.TestCase):
    """Portable fault injection only; never evidence of real Linux root/app PASS."""
    @contextlib.contextmanager
    def runtime_source(self):
        with tempfile.TemporaryDirectory(prefix="runtime-source-test-") as name:
            parent = Path(name).resolve()
            source = parent / "checkout"
            source.mkdir()
            for relative in RUNTIME_FIXTURE_FILES:
                target = source / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("synthetic fixture bytes\n")
            F.run("git", "init", "--initial-branch=main", str(source))
            F.run("git", "-C", str(source), "config", "user.name", "Fixture Test")
            F.run("git", "-C", str(source), "config", "user.email", "fixture@example.invalid")
            F.run("git", "-C", str(source), "add", ".")
            F.run("git", "-C", str(source), "commit", "-m", "exact fixture")
            commit = F.run("git", "-C", str(source), "rev-parse", "HEAD")
            # Portable scope only. LinuxPermissions tests actual metadata/UIds.
            def local_git(user, *args):
                self.assertEqual(user, pwd.getpwuid(source.stat().st_uid).pw_name)
                return subprocess.run(["git", *map(str, args)], capture_output=True, text=True)
            with patch(__name__ + ".user_git", side_effect=local_git), \
                 patch(__name__ + ".trusted_path", side_effect=lambda path, **kwargs: Path(path)):
                yield source, parent / "fixture", commit

    def test_runtime_fixture_exact_blob_hashes_and_relative_dependencies(self):
        with self.runtime_source() as (source, destination, commit):
            identity = stage_runtime_fixture(source, destination, commit)
            self.assertEqual(identity["commit"], commit)
            self.assertEqual(set(identity["files"]), set(RUNTIME_FIXTURE_FILES))
            for name, record in identity["files"].items():
                self.assertEqual(Path(record["staged"]).read_bytes(), (source / name).read_bytes())
                self.assertEqual(record["sha256"], A.file_digest(source / name))
                self.assertEqual(stat.S_IMODE(Path(record["staged"]).stat().st_mode), 0o644)
            verify_runtime_fixture(identity)
            (destination / RUNTIME_FIXTURE_FILES[0]).write_text("changed staged bytes")
            with self.assertRaisesRegex(ValueError, "staged runtime fixture hash changed"):
                verify_runtime_fixture(identity)

    def test_runtime_fixture_rejects_changed_missing_linked_and_wrong_commit_sources(self):
        for fault in ("changed", "missing", "symlink", "hardlink", "wrong-commit"):
            with self.subTest(fault=fault), self.runtime_source() as (source, destination, commit):
                target = source / RUNTIME_FIXTURE_FILES[1]
                if fault == "changed": target.write_text("not committed")
                elif fault == "missing": target.unlink()
                elif fault == "symlink":
                    target.unlink(); target.symlink_to(source / RUNTIME_FIXTURE_FILES[0])
                elif fault == "hardlink": os.link(target, source / "extra-link")
                else: commit = "0" * 40
                with self.assertRaises((ValueError, OSError)):
                    stage_runtime_fixture(source, destination, commit)
                self.assertFalse(destination.exists())

    def test_runtime_fixture_refuses_existing_destination_and_staged_link(self):
        with self.runtime_source() as (source, destination, commit):
            destination.mkdir()
            sentinel = destination / "sentinel"
            sentinel.write_text("preserve")
            with self.assertRaises(FileExistsError):
                stage_runtime_fixture(source, destination, commit)
            self.assertEqual(sentinel.read_text(), "preserve")
        with self.runtime_source() as (source, destination, commit):
            identity = stage_runtime_fixture(source, destination, commit)
            staged = destination / RUNTIME_FIXTURE_FILES[0]
            staged.unlink(); staged.symlink_to(source / RUNTIME_FIXTURE_FILES[0])
            with self.assertRaises((ValueError, OSError)):
                verify_runtime_fixture(identity)

    def test_runtime_cleanup_retains_original_failure_and_always_resets_git_user(self):
        for cleanup_fails in (False, True):
            original = RuntimeError("original runtime failure")
            cleanup = RuntimeError("owned fixture cleanup failure")
            with self.subTest(cleanup_fails=cleanup_fails), \
                 patch.object(LinuxPermissions, "setUpClass"), \
                 patch.object(LinuxPermissions, "tearDownClass", side_effect=cleanup if cleanup_fails else None) as teardown:
                with self.assertRaises(RuntimeError) as raised:
                    with runtime_fixture_lifecycle():
                        A.GIT_USER = "synthetic-app"
                        raise original
                self.assertIs(raised.exception, original)
                if cleanup_fails:
                    self.assertIs(original.__cause__, cleanup)
                    self.assertIs(original.cleanup_error, cleanup)
                self.assertIsNone(A.GIT_USER)
                teardown.assert_called_once()

    def test_user_git_preserves_identity_environment_and_original_result(self):
        account = pwd.struct_passwd(("synthetic-app", "x", 19991, 19991, "fixture", "/synthetic/home", "/bin/false"))
        rejected = subprocess.CompletedProcess([], 128, "original stdout", "fatal: repository owned by different users")
        with patch.object(pwd, "getpwnam", return_value=account), \
             patch(__name__ + ".RUNUSER", "/usr/sbin/runuser"), patch(__name__ + ".run", return_value=rejected) as invoke:
            self.assertIs(user_git(account.pw_name, "clone", "--bare", "/source", "/destination"), rejected)
        command = invoke.call_args.args[0]
        self.assertEqual(command[:7], ["/usr/sbin/runuser", "-u", "synthetic-app", "--", "env", "-i", "PATH=/usr/bin:/bin"])
        self.assertIn("HOME=/synthetic/home", command)
        self.assertIn("GIT_CONFIG_NOSYSTEM=1", command)
        self.assertIn("GIT_CONFIG_GLOBAL=/dev/null", command)
        self.assertIn("/usr/bin/git", command)
        self.assertNotIn("safe.directory=*", command)

    def test_useradd_comment_format_and_identity_marker(self):
        root = Path("/var/lib/nuaafa-permission-comment")
        user = "nuaafa_t0123456789ab"
        marker = "nuaafa-test-" + root.name
        group = grp.struct_group((user, "x", 19991, []))
        for matching in (True, False):
            with self.subTest(matching_gecos=matching):
                resource = FixtureResources()
                resource.root = root
                account = pwd.struct_passwd((user, "x", 19991, 19991,
                    marker if matching else marker + "-changed", str(root / "home"), "/bin/false"))
                with patch.object(secrets, "token_hex", return_value="0123456789ab"), \
                     patch.object(pwd, "getpwnam", side_effect=[KeyError(user), account]), \
                     patch.object(grp, "getgrnam", side_effect=[KeyError(user), group]), \
                     patch(__name__ + ".resolve_system_command", return_value="/usr/sbin/useradd"), \
                     patch.object(subprocess, "run") as create:
                    if matching:
                        self.assertIs(resource.create_user(), account)
                        self.assertEqual(resource.account.pw_gecos, resource.marker)
                    else:
                        with self.assertRaisesRegex(ValueError, "unrecognized partial account"):
                            resource.create_user()
                        self.assertIsNone(resource.account)
                    create.assert_called_once()
                    args = create.call_args.args[0]
                    comment = args[args.index("--comment") + 1]
                    self.assertNotRegex(comment, r"[:\r\n\x00]")
                    self.assertEqual(comment, marker)
                    self.assertEqual(comment, resource.marker)
                    self.assertEqual(args[args.index("--home-dir") + 1], str(root / "home"))

    def test_trusted_path_positive_and_specific_rejections(self):
        target = Path("/var/lib/nuaafa-fixture")
        def info(mode=stat.S_IFDIR | 0o755, uid=0):
            return os.stat_result((mode, 1, 1, 1, uid, 0, 0, 0, 0, 0))
        with patch.object(Path, "resolve", return_value=target), \
             patch.object(Path, "lstat", return_value=info()):
            self.assertEqual(trusted_path(target), target)
        for bad_path, metadata, reason in (
            (target, info(uid=1001), "owner is not root"),
            (target.parent, info(mode=stat.S_IFDIR | 0o777), "group/world writable"),
            (target, info(mode=stat.S_IFLNK | 0o777), "symlink"),
            (target, info(mode=stat.S_IFREG | 0o755), "wrong file type"),
        ):
            with self.subTest(path=bad_path, reason=reason), \
                 patch.object(Path, "resolve", return_value=target), \
                 patch.object(Path, "lstat", autospec=True, side_effect=lambda path: metadata if path == bad_path else info()), \
                 self.assertRaisesRegex(ValueError, re.escape(str(bad_path)) + ": " + reason):
                trusted_path(target)
        with patch.object(Path, "resolve", return_value=Path("/elsewhere")), \
             patch.object(Path, "lstat", return_value=info()), self.assertRaisesRegex(ValueError, "noncanonical"):
            trusted_path(target)
        with patch.object(Path, "resolve", side_effect=RuntimeError("symlink loop")), \
             patch.object(Path, "lstat", return_value=info()), self.assertRaisesRegex(ValueError, "symlink loop"):
            trusted_path(target)
        executable = Path("/usr/sbin/runuser")
        with patch.object(Path, "resolve", return_value=executable), \
             patch.object(Path, "lstat", autospec=True, side_effect=lambda path: info(stat.S_IFREG | 0o755) if path == executable else info()):
            self.assertEqual(trusted_path(executable, kind="file"), executable)
        with patch.object(Path, "resolve", return_value=executable), \
             patch.object(Path, "lstat", return_value=info()), self.assertRaisesRegex(ValueError, "wrong file type"):
            trusted_path(executable, kind="file")

    def test_no_trusted_parent_fails_without_creation(self):
        with patch("prebuilt_test_support.trusted_path", side_effect=ValueError("/var/lib uid=1001 mode=0777")), \
             patch("prebuilt_test_support.tempfile.mkdtemp") as create, \
             self.assertRaisesRegex(ValueError, "no trusted.*uid=1001"):
            fixture_parent()
        create.assert_not_called()

    def test_exclusive_creation_registers_and_revalidates(self):
        with tempfile.TemporaryDirectory() as name:
            parent = Path(name).resolve()
            sentinel = parent / "existing"
            sentinel.write_text("must survive")
            resources = [FixtureResources(), FixtureResources()]
            with patch("prebuilt_test_support.fixture_parent", return_value=parent), \
                 patch("prebuilt_test_support.trusted_path") as verify:
                roots = [exclusive_fixture(r) for r in resources]
            self.assertNotEqual(roots[0], roots[1])
            self.assertEqual(verify.call_count, 2)
            for resource in resources:
                self.assertEqual(resource.root.stat().st_uid, os.getuid())
                self.assertEqual(stat.S_IMODE(resource.root.stat().st_mode), 0o755)
                resource.cleanup()
                resource.cleanup()
                self.assertFalse(resource.root.exists())
            self.assertEqual(sentinel.read_text(), "must survive")

    def test_partial_initialization_cleans_each_created_resource(self):
        for stage in ("allocation", "postcreation", "useradd", "useradd-group-only", "home", "helper", "artifact"):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as name:
                parent = Path(name).resolve()
                outsider = parent / "other-test"
                outsider.mkdir()
                users, groups = {}, {}
                def user_lookup(user):
                    if user not in users: raise KeyError(user)
                    return users[user]
                def group_lookup(user):
                    if user not in groups: raise KeyError(user)
                    return groups[user]
                def command(args, **kwargs):
                    user = args[-1]
                    if args[0] == "useradd":
                        groups[user] = grp.struct_group((user, "x", 19991, []))
                        if stage == "useradd-group-only": raise subprocess.CalledProcessError(9, args)
                        users[user] = pwd.struct_passwd((user, "x", 19991, 19991,
                            args[args.index("--comment") + 1], args[args.index("--home-dir") + 1], "/bin/false"))
                        if stage == "useradd": raise subprocess.CalledProcessError(9, args)
                    elif args[0] == "userdel": users.pop(user)
                    elif args[0] == "groupdel": groups.pop(user)
                    return subprocess.CompletedProcess(args, 0)
                def allocate(resource):
                    if stage == "allocation": raise OSError("injected fixture allocation")
                    root = Path(tempfile.mkdtemp(prefix="owned-", dir=parent))
                    resource.remember_root(root)
                    if stage == "postcreation": raise ValueError("injected postcreation validation")
                    return root
                def copy(source, destination):
                    if stage == "helper": raise OSError("injected helper copy")
                    Path(destination).write_text("synthetic fixture only")
                def artifact_setup():
                    temp = Path(tempfile.mkdtemp(prefix="partial-artifact-"))
                    (temp / "partial").write_text("synthetic fixture only")
                    raise OSError("injected artifact creation")
                isolated = type("PartialLinuxPermissions", (LinuxPermissions,), {})
                with patch.object(sys, "platform", "linux"), patch.object(os, "geteuid", return_value=0), \
                     patch(__name__ + ".resolve_runuser", return_value="/usr/sbin/runuser"), \
                     patch(__name__ + ".resolve_system_command", side_effect=lambda name: name), \
                     patch(__name__ + ".exclusive_fixture", side_effect=allocate), \
                     patch.object(pwd, "getpwnam", side_effect=user_lookup), \
                     patch.object(grp, "getgrnam", side_effect=group_lookup), \
                     patch.object(pwd, "getpwall", side_effect=lambda: list(users.values())), \
                     patch.object(subprocess, "run", side_effect=command), \
                     patch.object(os, "chown", side_effect=OSError("injected home ownership") if stage == "home" else None), \
                     patch.object(shutil, "copyfile", side_effect=copy), \
                     patch.object(A, "platform_info", return_value=F.PLATFORM), \
                     patch.object(F.ArtifactTests, "setUpClass", side_effect=artifact_setup), \
                     self.assertRaises((ValueError, OSError, subprocess.CalledProcessError)):
                    isolated.setUpClass()
                self.assertTrue(isolated.resources.root is None or not isolated.resources.root.exists())
                self.assertEqual(users, {})
                self.assertEqual(groups, {})
                self.assertEqual(list(parent.iterdir()), [outsider])

    def test_cleanup_preserves_unknown_account_and_replaced_directory(self):
        with tempfile.TemporaryDirectory() as name:
            parent = Path(name).resolve()
            resource = FixtureResources()
            root = parent / "owned"
            root.mkdir(); resource.remember_root(root)
            root.rename(parent / "original")
            root.mkdir(); (root / "unknown").write_text("preserve")
            original = parent / "original"
            (original / "sentinel").write_text("owned bytes")
            identities = {p: (p.stat().st_dev, p.stat().st_ino, p.stat().st_mode)
                          for p in (root, original)}
            with self.assertRaisesRegex(RuntimeError, "replaced fixture root"):
                resource.cleanup()
            self.assertEqual((root / "unknown").read_text(), "preserve")
            self.assertEqual((original / "sentinel").read_text(), "owned bytes")
            self.assertEqual({p: (p.stat().st_dev, p.stat().st_ino, p.stat().st_mode)
                              for p in identities}, identities)

    def test_changed_account_refuses_delete_and_preserves_replaced_root(self):
        # All resources are local synthetic fixtures. Even a broken cleanup is
        # fenced from system account commands for the entire assertion scope.
        with tempfile.TemporaryDirectory() as name, patch.object(subprocess, "run") as delete:
            parent = Path(name).resolve()
            root = parent / "owned"
            root.mkdir()
            resource = FixtureResources()
            resource.remember_root(root)
            root.rename(parent / "original")
            root.mkdir()
            sentinel = root / "unknown"
            sentinel.write_bytes(b"preserve\x00sentinel\n")
            before = (root.lstat(), sentinel.lstat(), sentinel.read_bytes())
            resource.user = "synthetic-replaced-account"
            resource.account = pwd.struct_passwd((resource.user, "x", 19991, 19991, "owned", "/owned", "/bin/false"))
            changed = pwd.struct_passwd((resource.user, "x", 19992, 19991, "unknown", "/other", "/bin/false"))
            with patch.object(pwd, "getpwnam", return_value=changed) as lookup, \
                 self.assertRaisesRegex(RuntimeError, "changed account.*replaced fixture root"):
                resource.cleanup()
            lookup.assert_called_once_with(resource.user)
            delete.assert_not_called()
            self.assertEqual(resource.account.pw_uid, 19991)
            self.assertEqual((root.lstat(), sentinel.lstat(), sentinel.read_bytes()), before)
            self.assertTrue((parent / "original").is_dir())

    def test_changed_account_assertions_reject_unsafe_cleanup(self):
        for fault, message in (("delete", "Expected 'run' to not have been called"),
                               ("sentinel", "Tuples differ"), ("directory", "Tuples differ")):
            def unsafe_cleanup(resource):
                pwd.getpwnam(resource.user)
                if fault == "delete":
                    subprocess.run(["synthetic-userdel", resource.user])
                elif fault == "sentinel":
                    (resource.root / "unknown").write_bytes(b"corrupted")
                else:
                    original = (resource.root / "unknown").read_bytes()
                    resource.root.rename(resource.root.parent / "second-original")
                    resource.root.mkdir()
                    (resource.root / "unknown").write_bytes(original)
                raise RuntimeError("changed account; replaced fixture root")
            probe = HarnessTests("test_changed_account_refuses_delete_and_preserves_replaced_root")
            with self.subTest(fault=fault), patch.object(FixtureResources, "cleanup", side_effect=unsafe_cleanup, autospec=True):
                result = unittest.TestResult()
                probe.run(result)
                self.assertEqual(len(result.failures), 1)
                self.assertEqual(result.errors, [])
                self.assertIn(message, result.failures[0][1])

    def test_auxiliary_timeout_uses_isolated_group_cleanup(self):
        with tempfile.TemporaryDirectory() as name:
            ready = Path(name) / "probe.ready"
            source = "import time; from pathlib import Path; print('partial probe',flush=True); Path(" + repr(str(ready)) + ").write_text('ready'); time.sleep(10)"
            with patch.dict(os.environ, NUAAFA_TEST_EVIDENCE=name), \
                 patch.object(F, "wait_child_exit", side_effect=F.wait_after_fixture_ready([ready])), \
                 self.assertRaises(subprocess.TimeoutExpired):
                run([sys.executable, "-u", "-c", source], timeout=0.1)
            record = next(Path(name).glob("linux-command-*/result.json"))
            metadata = json.loads(record.read_text())
            self.assertTrue(metadata["timed_out"])
            self.assertNotEqual(metadata["process_group"], os.getpgrp())
            self.assertFalse(F.group_exists(metadata["process_group"]))
            self.assertIn("partial probe", (record.parent / "stdout.log").read_text())

    def test_setup_and_cleanup_errors_both_remain_visible(self):
        isolated = type("CleanupErrorPermissions", (LinuxPermissions,), {})
        with patch.object(sys, "platform", "linux"), patch.object(os, "geteuid", return_value=0), \
             patch.object(isolated, "initialize", side_effect=ValueError("injected setup failure")), \
             patch.object(FixtureResources, "cleanup", side_effect=RuntimeError("injected cleanup failure")), \
             self.assertRaisesRegex(RuntimeError, "setup failed: injected setup failure; cleanup failed: injected cleanup failure"):
            isolated.setUpClass()

    def test_user_collision_and_cleanup_failures_are_visible(self):
        with tempfile.TemporaryDirectory() as name:
            resource = FixtureResources()
            resource.remember_root(Path(name).resolve())
            with patch.object(pwd, "getpwnam", return_value=pwd.getpwuid(os.getuid())), \
                 patch.object(subprocess, "run") as create, self.assertRaisesRegex(ValueError, "already exists"):
                resource.create_user()
            create.assert_not_called()
            with patch.object(shutil, "rmtree", side_effect=OSError("injected cleanup failure")), \
                 self.assertRaisesRegex(RuntimeError, "injected cleanup failure"):
                resource.cleanup()


def relocated_runtime(archive, commit, sha256):
    # Real CI ELF files are tested here; no platform/native mocks.
    with runtime_fixture_lifecycle(), A.timing_session():
        root = LinuxPermissions.root
        driver_identity = stage_runtime_fixture(REPO, root / "runtime-fixture", commit)
        access = runtime_access_evidence(driver_identity, LinuxPermissions.node, LinuxPermissions.user)
        # The SAME real archive/digest goes through main --import-artifact twice.
        # A disposable bare remote maps the exact CI commit to the test main ref;
        # project refs and files are never modified.
        seed = root / "real-source.git"
        identity = bundle_remote(REPO, seed, commit, LinuxPermissions.user)
        if identity["checkout_uid"] == identity["app_uid"]:
            raise ValueError("real CI checkout/app UIDs must differ")
        test = LinuxPermissions("test_real_import_repeat_git_identity_and_sealed_files")
        case = test.case("real-archive", r'''
prebuilt_phase repeat_import main --import-artifact "$ARCHIVE" --artifact-sha256 "$DIGEST" "$COMMIT"
test "$(readlink "$current_link")" = "$release_root/$OLD"
test ! -e "$shared"
test ! -e "$activation_state"
test ! -e "$prebuilt_approvals"
''', archive=archive, commit=commit, checksum=sha256, seed=seed, timings=True)
        runtime = case / "releases" / commit
        # The receipt and post-runtime checks are outside the 120-second case.
        with A.measured_phase("post_case_receipt_identity"):
            receipt = A.load_json((case / "prebuilt" / (commit + ".json")).read_bytes())
            if (receipt["commit"], receipt["sha256"], receipt["allowed_ref"], receipt["remote_head"]) != (commit, sha256, "refs/heads/main", commit):
                raise ValueError("real archive receipt identity mismatch")
        shared = case / "shared"
        shared.mkdir(mode=0o755)
        (shared / "prisma").mkdir(mode=0o755)
        (shared / "work").mkdir(mode=0o700)
        database = shared / "prisma/dev.db"
        database.touch(); database.chmod(0o600)
        for p in (shared / "prisma", shared / "work", database):
            os.chown(p, LinuxPermissions.account.pw_uid, LinuxPermissions.account.pw_gid)
        environment = shared / ".env.production"
        environment.write_text("DATABASE_URL=file:" + str(database) + "\nNUAAFA_UPLOAD_DIR=" + str(shared / "work/uploads") + "\nREFEREE_ADMIN_SESSION_SECRET=Synthetic-Wrapper-Admin-Only-2026\nREFEREE_MEMBER_SESSION_SECRET=Synthetic-Wrapper-Member-Only-2026\n")
        environment.chmod(0o640); os.chown(environment, 0, LinuxPermissions.account.pw_gid)
        for name in (".env.production", "prisma/dev.db"): (runtime / name).symlink_to(shared / name)
        start_current = case / "startup-current"
        start_current.symlink_to(runtime)
        spec = importlib.util.spec_from_file_location("startup", REPO / "scripts/test-start-prebuilt.py")
        startup = importlib.util.module_from_spec(spec); spec.loader.exec_module(startup)
        wrapper = case / "start-prebuilt"
        adaptation = startup.adapt_wrapper(wrapper, start_current, runtime.parent, shared,
                                            LinuxPermissions.node, LinuxPermissions.user)
        home = root / "home"
        command = [RUNUSER, "-u", LinuxPermissions.user, "--", "env", "-i",
                   "PATH=/usr/bin:/bin", "HOME=" + str(home), "TMPDIR=" + str(home),
                   str(LinuxPermissions.node), driver_identity["files"][RUNTIME_FIXTURE_FILES[0]]["staged"], "--runtime=" + str(runtime),
                   "--startup-fixture=" + str(shared), "--wrapper=" + str(wrapper)]
        result = F.recorded_run(command, "real-archive-runtime", dict(commit=commit, archive_sha256=sha256, git_transfer=identity,
                               wrapper_adaptation=adaptation, runtime_fixture=driver_identity, runtime_access=access), timeout=180, cwd="/")
        if result.returncode:
            F.emit_failure_diagnostic("real-archive-runtime", result)
            raise RuntimeError(result.stdout + result.stderr)
        verify_runtime_fixture(driver_identity)
        # The app must leave caller-owned work for root cleanup, preserving the
        # non-writable shared parent; never grant it permission to remove work.
        if shared.stat().st_uid != 0 or shared.stat().st_mode & 0o022:
            raise ValueError("shared parent lost root ownership or became writable")
        work = shared / "work"
        if work.stat().st_uid != LinuxPermissions.account.pw_uid or work.stat().st_mode & 0o777 != 0o700:
            raise ValueError("caller work directory metadata changed")
        A.GIT_USER = LinuxPermissions.user
        A.verify_sealed_tree(runtime, LinuxPermissions.user)
        # Runtime tools must not modify verified executable/source files.
        A.verify_shared(runtime, shared)
        A.verify_tree(runtime, receipt["manifest"], commit)
        if A.file_digest(archive) != sha256: raise ValueError("archive changed after runtime validation")
        shutil.rmtree(work)
        if work.exists() or shared.stat().st_uid != 0:
            raise ValueError("root fixture cleanup failed")
        final_result = dict(result="PASS", runtime=json.loads(result.stdout), git_transfer=identity,
                            wrapper_adaptation=adaptation, runtime_fixture=driver_identity, runtime_access=access, first_and_repeat_import=True,
                            final_seal_shared_tree_archive_verification="PASS", root_work_cleanup="PASS")
    if root.exists(): raise ValueError("Linux fixture root was not removed")
    try:
        pwd.getpwnam(LinuxPermissions.user)
    except KeyError:
        pass
    else:
        raise ValueError("temporary app user was not removed")
    final_result["root_and_user_cleanup"] = "PASS"
    print(json.dumps(final_result))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--commit")
    parser.add_argument("--sha256")
    parser.add_argument("--harness-only", action="store_true", help="portable fault injection; not real Linux validation")
    args = parser.parse_args()
    if args.harness_only:
        unittest.main(argv=[sys.argv[0], "HarnessTests"], verbosity=2)
        sys.exit(0)
    if sys.platform != "linux" or os.geteuid() != 0:
        print("NOT RUN: disposable Linux root required", file=sys.stderr)
        sys.exit(2)
    if args.archive:
        relocated_runtime(args.archive, args.commit, args.sha256)
    else:
        unittest.main(argv=[sys.argv[0]], verbosity=2)
