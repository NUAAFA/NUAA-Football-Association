#!/usr/bin/env python3
"""Real local files/SQLite with an explicit service/helper command adapter.

These tests prove the new gate's decisions and read-only delegation, not a running
systemd service. Use run-linux-rehearsal.py for the preserved root/native suites.
"""
import copy
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("maintenance_contract", REPO / "ops/maintenance/contract-preflight.py")
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
driver_spec = importlib.util.spec_from_file_location("maintenance_driver", REPO / "ops/maintenance/run-linux-rehearsal.py")
DRIVER = importlib.util.module_from_spec(driver_spec)
driver_spec.loader.exec_module(DRIVER)
COMMIT = "a" * 40
TREE = "b" * 40
DIGEST = "c" * 64
NOW = dt.datetime(2026, 10, 27, 16, 0, tzinfo=dt.timezone.utc)


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="nuaafa-m06-contract-")
        self.root = Path(self.temp.name).resolve()
        self.release = self.root / "releases" / COMMIT
        self.shared = self.root / "shared"
        self.release.mkdir(parents=True)
        (self.shared / "prisma").mkdir(parents=True)
        (self.root / "current").symlink_to(self.release)
        self.node = self.root / "node"
        self.paths = {"current": str(self.root / "current"), "releases": str(self.root / "releases"),
                      "shared": str(self.shared), "database": str(self.shared / "prisma/dev.db")}
        self.programs = {}
        for role in M.PROGRAM_ROLES:
            p = self.root / role
            p.write_text("fictional " + role + "\n")
            p.chmod(0o700)
            self.programs[role] = {"path": str(p), "sha256": M.sha_file(p)}
        for name, basename in (("contracts", "contracts.json"), ("receipt", "receipt.json"),
                               ("activation", "activation.json"), ("import_approval", "import-approval.json"),
                               ("deployment_lock", "deployment.lock")):
            self.paths[name] = str(self.root / basename)
        Path(self.paths["deployment_lock"]).touch(mode=0o600)
        record = {"sha256": DIGEST}
        for role in ("node", "helper", "start"):
            record[role] = self.programs[role]["path"]
            record[role + "_sha256"] = self.programs[role]["sha256"]
        self.contract = {"format": 1, "current": self.paths["current"], "releases": self.paths["releases"],
                         "contracts": {COMMIT: record}}
        self.write("contracts", self.contract)
        self.write("activation", {"format": 2, "phase": "HEALTHY", "commit": COMMIT, "previous": "d" * 40})
        self.write("receipt", {"commit": COMMIT, "sha256": DIGEST, "allowed_ref": "refs/heads/main"})
        self.write("import_approval", dict(format=1, commit=COMMIT, artifact_sha256=DIGEST,
                   allowed_ref="refs/heads/main", security_gate="PASS", linux_artifact_validation="PASS", human_review="APPROVED"))
        (self.release / "package-lock.json").write_text('{"lockfileVersion":3}\n')
        (self.release / ".next").mkdir()
        (self.release / ".next/BUILD_ID").write_text("fictional-build\n")
        for package, version in (("next", "16.4.1"), ("@prisma/client", "7.9.1")):
            p = self.release / "node_modules" / package
            p.mkdir(parents=True)
            (p / "package.json").write_text(json.dumps({"version": version}))
        shutil.copytree(REPO / "prisma/migrations", self.release / "prisma/migrations")
        shutil.copyfile(REPO / "prisma/schema.prisma", self.release / "prisma/schema.prisma")
        inventory = {p.parent.name: M.sha_file(p) for p in sorted((self.release / "prisma/migrations").glob("*/migration.sql"))}
        self.assertEqual(len(inventory), 21)
        db = sqlite3.connect(self.paths["database"])
        db.execute("CREATE TABLE _prisma_migrations (migration_name TEXT, checksum TEXT, started_at INTEGER, finished_at INTEGER, rolled_back_at INTEGER)")
        for i, (name, digest) in enumerate(inventory.items()):
            db.executescript((self.release / "prisma/migrations" / name / "migration.sql").read_text())
            db.execute("INSERT INTO _prisma_migrations VALUES (?,?,?,?,NULL)", (name, digest, i, i + 1))
            db.commit()
        db.close()
        self.plan = dict(format=1, purpose="M06_READONLY_PREFLIGHT", approval_id="SYNTHETIC_ONLY_001",
             expires_at=(NOW + dt.timedelta(hours=1)).isoformat(), commit=COMMIT, tree=TREE,
             allowed_ref="refs/heads/main", artifact_sha256=DIGEST,
             lock_sha256=M.sha_file(self.release / "package-lock.json"),
             schema_sha256=M.sha_file(self.release / "prisma/schema.prisma"),
             migration_inventory=inventory, paths=self.paths, programs=self.programs,
             contract_sha256=M.sha_file(Path(self.paths["contracts"])),
             service_name="nuaafa.service", application_user="fictional-app", application_group="fictional-app",
             build_id="fictional-build", human_review="APPROVED", security_gate="PASS", linux_validation="PASS")
        self.planpath = self.root / "approved-plan.json"
        self.facts = dict(MainPID="12345", NRestarts="0", ExecMainStartTimestampMonotonic="1234567",
             ActiveState="active", SubState="running", User="fictional-app", Group="fictional-app",
             WorkingDirectory=self.paths["current"], ExecStart="{ path=" + self.programs["wrapper"]["path"] +
             " ; argv[]=" + self.programs["wrapper"]["path"] + " ; ignore_errors=no ; }",
             SendSIGKILL="no", TimeoutStopUSec="infinity", KillMode="control-group")
        self.commands = []
        self.node_version = "v22.23.4"

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, value):
        p = Path(self.paths[name])
        p.write_text(json.dumps(value))
        p.chmod(0o600)

    def runner(self, args):
        self.commands.append(args)
        if args[-1:] == ["HEAD"]:
            return COMMIT
        if args[-1:] == ["HEAD^{tree}"]:
            return TREE
        if args == [self.programs["node"]["path"], "--version"]:
            return self.node_version
        if args[:2] == ["/usr/bin/systemctl", "show"]:
            return "\n".join(k + "=" + v for k, v in self.facts.items())
        if args[:4] == ["/usr/bin/python3", "-I", "-B", self.programs["helper"]["path"]]:
            self.assertIn(args[4], ("verify", "runtime-ready"))
            return ""
        raise AssertionError("Unexpected command")

    def check(self):
        self.planpath.write_text(json.dumps(self.plan))
        self.planpath.chmod(0o600)
        return M.check(self.planpath, synthetic_root=self.root, runner=self.runner, now=NOW, clock=lambda: NOW)

    def fails(self, code):
        result = self.check()
        self.assertEqual(result["status"], "FAIL", result)
        self.assertEqual(result["stop_code"], code, result)
        return result

    def test_real_twenty_one_migrations_readonly_repeat_and_whitelisted_commands(self):
        before = M.sha_file(Path(self.paths["database"]))
        first, second = self.check(), self.check()
        self.assertEqual(first["status"], "PASS", first)
        self.assertEqual(first, second)
        self.assertEqual(first["mode"], "SYNTHETIC")
        self.assertFalse(first["production_authorization"])
        self.assertEqual(before, M.sha_file(Path(self.paths["database"])))
        self.assertFalse(any("stop" in a or "restart" in a or "state" in a for a in self.commands))

    def test_wrong_commit_never_uses_previous_pointer(self):
        self.plan["commit"] = "d" * 40
        self.fails("CURRENT_LINK_IDENTITY")

    def test_wrong_tree_stops_before_helper(self):
        self.plan["tree"] = "e" * 40
        self.fails("GIT_IDENTITY")
        self.assertFalse(any(a[0] == "/usr/bin/python3" for a in self.commands))

    def test_wrong_artifact_digest(self):
        self.plan["artifact_sha256"] = "f" * 64
        self.fails("VERSIONED_CONTRACT_IDENTITY")

    def test_wrong_receipt_digest(self):
        r = json.loads(Path(self.paths["receipt"]).read_text())
        r["sha256"] = "f" * 64
        self.write("receipt", r)
        self.fails("ARTIFACT_RECEIPT_IDENTITY")

    def test_current_sized_fictional_receipt_with_full_inventory_budget(self):
        r = json.loads(Path(self.paths["receipt"]).read_text())
        r["manifest"] = {"fictional_inventory_padding": "x" * (7 * 1024 * 1024)}
        self.write("receipt", r)
        self.assertGreater(Path(self.paths["receipt"]).stat().st_size, 4 * 1024 * 1024)
        result = self.check()
        self.assertEqual(result["status"], "PASS", result)
        self.assertTrue(any("verify" in c for c in self.commands))

    def test_receipt_over_sixteen_mib_rejected_before_helper(self):
        r = json.loads(Path(self.paths["receipt"]).read_text())
        r["manifest"] = {"fictional_inventory_padding": "x" * (16 * 1024 * 1024)}
        self.write("receipt", r)
        self.fails("JSON_SIZE")
        self.assertEqual(self.commands, [])

    def test_initial_approval_plan_keeps_four_mib_budget(self):
        self.plan["fictional_oversized_key"] = "x" * (4 * 1024 * 1024)
        self.fails("JSON_SIZE")
        self.assertEqual(self.commands, [])

    def test_independent_security_approval_not_optional(self):
        a = json.loads(Path(self.paths["import_approval"]).read_text())
        a["security_gate"] = "NOT RUN"
        self.write("import_approval", a)
        self.fails("INDEPENDENT_IMPORT_APPROVAL")

    def test_expired_approval(self):
        self.plan["expires_at"] = NOW.isoformat()
        self.fails("APPROVAL_EXPIRED_OR_TOO_LONG")

    def test_excessive_approval_lifetime(self):
        self.plan["expires_at"] = (NOW + dt.timedelta(days=2)).isoformat()
        self.fails("APPROVAL_EXPIRED_OR_TOO_LONG")

    def test_approval_expiring_during_validation_is_not_pass(self):
        self.planpath.write_text(json.dumps(self.plan))
        self.planpath.chmod(0o600)
        result = M.check(self.planpath, synthetic_root=self.root, runner=self.runner, now=NOW,
                         clock=lambda: NOW + dt.timedelta(hours=2))
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["stop_code"], "APPROVAL_EXPIRED_OR_TOO_LONG")

    def test_restart_during_helper_check_is_not_pass(self):
        original = self.runner
        def restarting(args):
            result = original(args)
            if args[:5] == ["/usr/bin/python3", "-I", "-B", self.programs["helper"]["path"], "runtime-ready"]:
                self.facts["MainPID"] = "12346"
                self.facts["NRestarts"] = "1"
                self.facts["ExecMainStartTimestampMonotonic"] = "2234567"
            return result
        self.runner = restarting
        self.fails("SERVICE_CHANGED_DURING_CHECK")

    def test_reused_pid_with_different_generation_is_not_pass(self):
        original = self.runner
        def restarting(args):
            result = original(args)
            if args[:5] == ["/usr/bin/python3", "-I", "-B", self.programs["helper"]["path"], "runtime-ready"]:
                self.facts["ExecMainStartTimestampMonotonic"] = "2234567"
            return result
        self.runner = restarting
        self.fails("SERVICE_CHANGED_DURING_CHECK")

    def test_naive_approval_time(self):
        self.plan["expires_at"] = "2026-10-27T19:00:00"
        self.fails("APPROVAL_EXPIRED_OR_TOO_LONG")

    def test_wrong_type_expiry_is_safe_failure(self):
        self.plan["expires_at"] = 123
        self.fails("UNVERIFIABLE_INPUT_OR_ENVIRONMENT")

    def test_missing_independent_digest_is_not_unknown_pass(self):
        self.plan["artifact_sha256"] = None
        self.fails("UNVERIFIABLE_INPUT_OR_ENVIRONMENT")

    def test_plan_cannot_hide_unreviewed_keys(self):
        self.plan["execute_deployment"] = True
        self.fails("PLAN_SHAPE")

    def test_wrong_node_version(self):
        self.node_version = "v24.21.0"
        self.fails("NODE_VERSION")

    def test_node_hash_before_binary_execution(self):
        Path(self.programs["node"]["path"]).write_text("changed binary")
        self.fails("PROGRAM_DIGEST_NODE")
        self.assertEqual(self.commands, [])

    def test_helper_hash(self):
        Path(self.programs["helper"]["path"]).write_text("changed helper")
        self.fails("PROGRAM_DIGEST_HELPER")

    def test_group_writable_helper(self):
        Path(self.programs["helper"]["path"]).chmod(0o660)
        self.fails("UNTRUSTED_METADATA")

    def test_symlink_program_rejected(self):
        p = Path(self.programs["node"]["path"])
        q = self.root / "actual-node"
        p.rename(q)
        p.symlink_to(q)
        self.fails("NONCANONICAL_PATH")

    def test_hardlink_program_rejected(self):
        os.link(self.programs["node"]["path"], self.root / "hardlink")
        self.fails("MULTILINK_FILE")

    def test_unsafe_parent_rejected(self):
        self.root.chmod(0o777)
        try:
            self.fails("UNTRUSTED_METADATA")
        finally:
            self.root.chmod(0o700)

    def test_missing_receipt(self):
        Path(self.paths["receipt"]).unlink()
        self.fails("UNVERIFIABLE_INPUT_OR_ENVIRONMENT")

    def test_contract_changed(self):
        self.write("contracts", {"format": 1, "contracts": {}})
        self.fails("CONTRACT_DIGEST")

    def test_wrong_versioned_start_even_with_updated_contract_digest(self):
        self.contract["contracts"][COMMIT]["start"] = self.root.as_posix() + "/unapproved"
        self.write("contracts", self.contract)
        self.plan["contract_sha256"] = M.sha_file(Path(self.paths["contracts"]))
        self.fails("VERSIONED_CONTRACT_IDENTITY")

    def test_internal_contract_digest_cannot_disagree_with_plan_and_file(self):
        self.contract["contracts"][COMMIT]["helper_sha256"] = "0" * 64
        self.write("contracts", self.contract)
        self.plan["contract_sha256"] = M.sha_file(Path(self.paths["contracts"]))
        self.fails("VERSIONED_CONTRACT_IDENTITY")

    def test_internal_contract_artifact_identity(self):
        self.contract["contracts"][COMMIT]["sha256"] = "0" * 64
        self.write("contracts", self.contract)
        self.plan["contract_sha256"] = M.sha_file(Path(self.paths["contracts"]))
        self.fails("VERSIONED_CONTRACT_IDENTITY")

    def test_incomplete_or_manual_activation_never_auto_recovers(self):
        for phase in ("MIGRATING", "MANUAL_REQUIRED", "SWITCHED", "ROLLED_BACK"):
            with self.subTest(phase=phase):
                self.write("activation", {"format": 2, "phase": phase, "commit": COMMIT, "previous": "d" * 40})
                self.fails("ACTIVATION_NOT_HEALTHY")

    def test_busy_deployment_lock_does_not_create_or_change_any_state(self):
        state = Path(self.paths["activation"]).read_bytes()
        with Path(self.paths["deployment_lock"]).open("rb") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.fails("DEPLOYMENT_LOCK_BUSY")
        self.assertEqual(state, Path(self.paths["activation"]).read_bytes())

    def test_old_seventeen_migration_plan_rejected(self):
        self.plan["migration_inventory"] = dict(list(self.plan["migration_inventory"].items())[:17])
        self.fails("MIGRATION_PLAN")

    def test_database_ledger_checksum_mismatch(self):
        with sqlite3.connect(self.paths["database"]) as db:
            db.execute("UPDATE _prisma_migrations SET checksum=? WHERE started_at=0", ("0" * 64,))
        self.fails("DATABASE_MIGRATIONS")

    def test_failed_migration_not_accepted(self):
        with sqlite3.connect(self.paths["database"]) as db:
            db.execute("UPDATE _prisma_migrations SET finished_at=NULL WHERE started_at=20")
        self.fails("DATABASE_MIGRATIONS")

    def test_schema_change(self):
        with (self.release / "prisma/schema.prisma").open("a") as f:
            f.write("\n// unapproved change\n")
        self.fails("SCHEMA_CHECKSUM")

    def test_migration_file_change(self):
        p = sorted((self.release / "prisma/migrations").glob("*/migration.sql"))[0]
        with p.open("a") as f:
            f.write("\n-- unapproved\n")
        self.fails("MIGRATION_CHECKSUM")

    def test_shared_database_must_be_exact(self):
        self.plan["paths"]["database"] = str(self.root / "other.db")
        self.fails("SHARED_DATABASE_IDENTITY")

    def test_environment_secret_file_never_opened(self):
        p = self.root / ".env.production"
        p.write_text("SECRET_THAT_MUST_NOT_BE_READ")
        p.chmod(0o600)
        self.programs["node"]["path"] = str(p)
        self.fails("SECRET_PATH_FORBIDDEN")
        self.assertEqual(self.commands, [])

    def test_database_cannot_be_supplied_as_json_metadata(self):
        self.plan["paths"]["contracts"] = self.paths["database"]
        self.fails("METADATA_PATH_KIND")
        self.assertEqual(self.commands, [])

    def test_initial_approval_path_cannot_read_database(self):
        with patch.object(M, "read_json", side_effect=AssertionError("Must not read database as JSON")) as read:
            result = M.check(Path(self.paths["database"]), synthetic_root=self.root, runner=self.runner,
                             now=NOW, clock=lambda: NOW)
        self.assertEqual(result["stop_code"], "APPROVAL_PLAN_PATH_KIND")
        read.assert_not_called()
        self.assertEqual(self.commands, [])

    def test_finite_stop_timeout_or_sigkill_is_blocked(self):
        for key, value in (("SendSIGKILL", "yes"), ("TimeoutStopUSec", "30s"), ("KillMode", "process")):
            with self.subTest(key=key):
                old = self.facts[key]
                self.facts[key] = value
                self.fails("UNSAFE_STOP_POLICY")
                self.facts[key] = old

    def test_extra_service_command_is_blocked(self):
        self.facts["ExecStart"] += " { path=/other ; argv[]=/other ; }"
        self.fails("SERVICE_EXECSTART")

    def test_missing_service_property_does_not_pass(self):
        del self.facts["SendSIGKILL"]
        self.fails("SERVICE_PROPERTIES_MISSING")

    def test_inactive_service(self):
        self.facts["MainPID"] = "0"
        self.fails("SERVICE_NOT_RUNNING")

    def test_private_error_details_not_serialized(self):
        secret = "REAL_SECRET_MUST_NOT_APPEAR"
        def fail(_):
            raise subprocess.CalledProcessError(1, secret, stderr=secret)
        self.planpath.write_text(json.dumps(self.plan))
        self.planpath.chmod(0o600)
        result = M.check(self.planpath, synthetic_root=self.root, runner=fail, now=NOW)
        self.assertEqual(result["status"], "FAIL")
        self.assertNotIn(secret, json.dumps(result))

    def test_duplicate_json_keys_rejected(self):
        self.planpath.write_text('{"format":1,"format":1}')
        self.planpath.chmod(0o600)
        result = M.check(self.planpath, synthetic_root=self.root, runner=self.runner, now=NOW)
        self.assertEqual(result["stop_code"], "DUPLICATE_JSON_KEY")

    def test_linux_driver_binds_trusted_parent_and_nonroot_app_identity(self):
        env = DRIVER.test_environment({"SUDO_USER": "fictional-ci", "PATH": "/safe"},
                                      lookup=lambda _: type("Account", (), {"pw_uid": 12345})())
        self.assertEqual(env["NUAAFA_TEST_ROOT"], "/var/lib")
        self.assertEqual(env["NUAAFA_TEST_APP_USER"], "fictional-ci")
        self.assertEqual(env["PATH"], "/safe")

    def test_linux_driver_refuses_root_application_identity(self):
        with self.assertRaisesRegex(ValueError, "must not be root"):
            DRIVER.test_environment({"SUDO_USER": "root"}, lookup=lambda _: type("Account", (), {"pw_uid": 0})())

    def test_linux_driver_missing_application_identity_not_assumed(self):
        with self.assertRaisesRegex(ValueError, "required"):
            DRIVER.test_environment({})

    def test_linux_driver_broken_production_alias_is_not_absence(self):
        alias = self.root / "broken-alias"
        alias.symlink_to(self.root / "not-present")
        self.assertFalse(alias.exists())
        self.assertTrue(DRIVER.production_paths_present([str(alias)]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
