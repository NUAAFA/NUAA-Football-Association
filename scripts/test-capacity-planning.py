#!/usr/bin/env python3
"""Fictional filesystem/SQLite tests; no production access or retention apply."""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("capacity_planner", ROOT / "ops/capacity/planner.py")
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)
NOW = dt.datetime(2026, 10, 27, 17, 0, tzinfo=dt.timezone.utc)
PIN = "a" * 64


class CapacityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="nuaafa-fictional-capacity-")
        self.root = Path(self.temp.name).resolve()

    def tearDown(self):
        self.temp.cleanup()

    def backup(self, profile="ONLINE_OPS"):
        root = self.root / profile
        root.mkdir()
        db = sqlite3.connect(root / "database.sqlite")
        db.execute('CREATE TABLE Fictional (id INTEGER PRIMARY KEY, note TEXT)')
        db.execute("INSERT INTO Fictional VALUES (1,'synthetic, not a real person')")
        db.execute("CREATE TABLE _prisma_migrations (migration_name TEXT, finished_at TEXT, rolled_back_at TEXT, started_at TEXT)")
        db.execute("INSERT INTO _prisma_migrations VALUES ('fictional_21', '2026-10-27', NULL, '2026-10-27')")
        db.commit()
        logical = {}
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
            rows = db.execute('SELECT * FROM "' + name + '"').fetchall()
            logical[name] = {"count": len(rows), "sha256": hashlib.sha256(b"".join(sorted(
                hashlib.sha256(repr(row).encode()).digest() for row in rows))).hexdigest()}
        schema = list(db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"))
        db.close()
        (root / "uploads").mkdir()
        (root / "uploads/fake.png").write_bytes(b"fictional upload bytes")
        records = {str(p.relative_to(root)): {"bytes": p.stat().st_size,
                   "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                   for p in (root / "database.sqlite", root / "uploads/fake.png")}
        if profile == "ONLINE_OPS":
            manifest = {"format": "NUAAFA_ONLINE_OPS_V1", "backup_id": "fictional-ops",
                        "completed_utc": "2026-10-27T16:00:00Z", "consistency": "ONLINE_STABLE_INTERVAL_VERIFIED",
                        "checksums": records, "database_logical": {"tables": logical,
                        "schema_sha256": hashlib.sha256(repr(schema).encode()).hexdigest()}}
            checks = {k: "PASS" for k in ("payloadChecksums", "fileSet", "databaseIntegrity", "foreignKeys", "databaseLogical")}
        else:
            manifest = {"formatVersion": 3, "backupProfile": "MODERN_UNIFIED", "backupId": "fictional-modern",
                        "generatedAtUtc": "2026-10-27T16:00:00Z", "migrations": ["fictional_21"],
                        "checksums": {k: v["sha256"] for k, v in records.items()},
                        "database": records["database.sqlite"], "uploads": {"files": [
                            {"storageKey": "fake.png", **records["uploads/fake.png"]}]}}
            checks = {k: "PASS" for k in ("payloadChecksums", "fileSet", "databaseIntegrity", "foreignKeys", "migrationLedger", "schemaCapabilities")}
        self.publish(root, manifest)
        receipt = {"status": "PASS", "profile": profile,
                   "backupId": manifest.get("backup_id", manifest.get("backupId")),
                   "manifestSha256": hashlib.sha256((root / "manifest.json").read_bytes()).hexdigest(),
                   "payloadSetSha256": planner.payload_set_sha(records), "verifierSha256": PIN,
                   "checkedAt": "2026-10-27T16:05:00Z", "checks": checks}
        return root, manifest, receipt

    def publish(self, root, manifest):
        raw = (json.dumps(manifest, sort_keys=True) + "\n").encode()
        (root / "manifest.json").write_bytes(raw)
        if manifest.get("format") == "NUAAFA_ONLINE_OPS_V1":
            marker = {"backup_id": manifest["backup_id"], "manifest_sha256": hashlib.sha256(raw).hexdigest()}
        else:
            marker = {"formatVersion": 1, "backupId": manifest.get("backupId", "fictional"),
                      "manifestSha256": hashlib.sha256(raw).hexdigest()}
        (root / "COMPLETED.json").write_text(json.dumps(marker))

    def inspect(self, root, receipt):
        return planner.inspect_backup(root, receipt, {"ONLINE_OPS": PIN, "MODERN_UNIFIED": PIN}, now=NOW)

    def test_real_files_hardlinks_count_once_allocated(self):
        (self.root / "a").write_bytes(b"x" * 8192)
        os.link(self.root / "a", self.root / "b")
        result = planner.inventory(self.root)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["logicalRegularBytes"], 16384)
        self.assertEqual(result["uniqueLogicalRegularBytes"], 8192)
        self.assertEqual(result["hardlinkAliases"], 1)
        self.assertEqual(result["uniqueAllocatedBytes"], (self.root.stat().st_blocks + (self.root / "a").stat().st_blocks) * 512)

    def test_sparse_logical_differs_from_allocated(self):
        with (self.root / "sparse").open("wb") as stream:
            stream.seek(64 * 1024 * 1024)
            stream.write(b"x")
        result = planner.inventory(self.root)
        self.assertEqual(result["uniqueLogicalRegularBytes"], 64 * 1024 * 1024 + 1)
        self.assertLess(result["uniqueAllocatedBytes"], result["uniqueLogicalRegularBytes"])

    def test_symlink_file_and_directory_never_followed(self):
        outside = self.root / "private"
        outside.mkdir()
        (outside / "secret").write_bytes(b"secret not in scan")
        target = self.root / "scan"
        target.mkdir()
        (target / "directory").symlink_to(outside, target_is_directory=True)
        (target / "file").symlink_to(outside / "secret")
        result = planner.inventory(target)
        self.assertEqual(result["symlinksNotFollowed"], 2)
        self.assertEqual(result["regularFiles"], 0)

    def test_root_alias_rejected(self):
        alias = self.root / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(OSError):
            planner.inventory(alias)

    def test_fifo_is_metadata_only(self):
        os.mkfifo(self.root / "pipe")
        result = planner.inventory(self.root)
        self.assertEqual(result["otherObjects"], 1)
        self.assertEqual(result["regularFiles"], 0)

    def test_bounded_scan_never_claims_complete(self):
        for i in range(4):
            (self.root / str(i)).write_text("fictitious")
        result = planner.inventory(self.root, max_entries=2)
        self.assertEqual(result["status"], "UNKNOWN")
        self.assertEqual(result["entries"], 2)

    def test_unknown_category_not_cleanable(self):
        result = planner.inventory(self.root)
        self.assertEqual(result["category"], "unknown")
        self.assertFalse(result["deleteAuthorized"])

    def test_online_verified_receipt_and_full_current_payload(self):
        root, _, receipt = self.backup()
        result = self.inspect(root, receipt)
        self.assertEqual(result["status"], "UNKNOWN", result)
        self.assertEqual(result["payloadAndDatabaseChecks"], "PASS")
        self.assertFalse(result["retentionEligible"])
        self.assertEqual(result["receiptExecutionProvenance"], "UNKNOWN")
        self.assertFalse(result["deleteAuthorized"])

    def test_modern_uses_distinct_schema_and_migration_validation(self):
        root, _, receipt = self.backup("MODERN_UNIFIED")
        result = self.inspect(root, receipt)
        self.assertEqual(result["status"], "UNKNOWN", result)
        self.assertEqual(result["payloadAndDatabaseChecks"], "PASS")
        receipt["profile"] = "ONLINE_OPS"
        self.assertEqual(self.inspect(root, receipt)["code"], "VERIFICATION_RECEIPT_BINDING")

    def test_hashes_without_full_receipt_cannot_be_candidates(self):
        root, _, _ = self.backup()
        result = self.inspect(root, None)
        self.assertEqual(result["code"], "FULL_VERIFICATION_RECEIPT_REQUIRED")
        self.assertFalse(result["retentionEligible"])

    def test_partial_receipt_rejected(self):
        root, _, receipt = self.backup()
        receipt["checks"].pop("databaseLogical")
        self.assertEqual(self.inspect(root, receipt)["code"], "FULL_VERIFICATION_INCOMPLETE")

    def test_wrong_verifier_pin_rejected(self):
        root, _, receipt = self.backup()
        receipt["verifierSha256"] = "b" * 64
        self.assertEqual(self.inspect(root, receipt)["code"], "VERIFIER_PIN_REQUIRED")

    def test_stale_and_future_receipt_rejected(self):
        root, _, receipt = self.backup()
        for stamp in ("2026-10-20T16:00:00Z", "2026-10-28T16:00:00Z"):
            receipt["checkedAt"] = stamp
            self.assertEqual(self.inspect(root, receipt)["code"], "VERIFICATION_RECEIPT_STALE")

    def test_completion_binding_must_match(self):
        root, _, receipt = self.backup()
        marker = json.loads((root / "COMPLETED.json").read_text())
        marker["backup_id"] = "wrong"
        (root / "COMPLETED.json").write_text(json.dumps(marker))
        self.assertEqual(self.inspect(root, receipt)["code"], "COMPLETION_BINDING")

    def test_failed_backup_always_preserved(self):
        root, _, receipt = self.backup()
        (root / "FAILED.json").write_text("{}")
        result = self.inspect(root, receipt)
        self.assertEqual(result["protection"], "FAILED_EVIDENCE_KEEP")
        self.assertFalse(result["retentionEligible"])

    def test_extra_file_and_corrupt_payload_rejected(self):
        root, _, receipt = self.backup()
        (root / "unexpected").write_text("retain unknown object")
        self.assertEqual(self.inspect(root, receipt)["code"], "FILESET_MISMATCH")
        (root / "unexpected").unlink()
        (root / "uploads/fake.png").write_bytes(b"corrupt fictional upload")
        self.assertEqual(self.inspect(root, receipt)["code"], "PAYLOAD_MISMATCH")

    def test_payload_symlink_rejected(self):
        root, _, receipt = self.backup()
        upload = root / "uploads/fake.png"
        upload.rename(self.root / "outside")
        upload.symlink_to(self.root / "outside")
        self.assertEqual(self.inspect(root, receipt)["code"], "FILESET_LINK_OR_TYPE")

    def test_format_mix_rejected(self):
        root, manifest, receipt = self.backup("MODERN_UNIFIED")
        manifest["backupProfile"] = "ONLINE_OPS"
        self.publish(root, manifest)
        self.assertEqual(self.inspect(root, receipt)["code"], "UNKNOWN_OR_MIXED_BACKUP_FORMAT")

    def test_dual_format_markers_both_directions_rejected_and_kept(self):
        for profile in ("ONLINE_OPS", "MODERN_UNIFIED"):
            with self.subTest(profile=profile):
                root, manifest, receipt = self.backup(profile)
                if profile == "ONLINE_OPS":
                    manifest.update(formatVersion=3, backupProfile="MODERN_UNIFIED")
                else:
                    manifest.update(format="NUAAFA_ONLINE_OPS_V1", backup_id="conflict")
                self.publish(root, manifest)
                result = self.inspect(root, receipt)
                self.assertEqual(result["code"], "CONFLICTING_BACKUP_FORMAT_MARKERS")
                self.assertFalse(result["retentionEligible"])
                proposal = planner.retention_proposal([result], at=NOW.isoformat())
                self.assertEqual(proposal["decisions"][0]["decision"], "KEEP_UNPROVEN_OR_FORENSIC")

    def test_database_logical_mismatch_cannot_hide_behind_receipt(self):
        root, manifest, receipt = self.backup()
        manifest["database_logical"]["tables"]["Fictional"]["count"] += 1
        self.publish(root, manifest)
        receipt["manifestSha256"] = hashlib.sha256((root / "manifest.json").read_bytes()).hexdigest()
        self.assertEqual(self.inspect(root, receipt)["code"], "DATABASE_LOGICAL")

    def test_modern_wrong_migrations_rejected(self):
        root, manifest, receipt = self.backup("MODERN_UNIFIED")
        manifest["migrations"] = ["wrong_18"]
        self.publish(root, manifest)
        receipt["manifestSha256"] = hashlib.sha256((root / "manifest.json").read_bytes()).hexdigest()
        self.assertEqual(self.inspect(root, receipt)["code"], "DATABASE_MIGRATIONS")

    def test_payload_read_budget_fail_closed(self):
        root, _, receipt = self.backup()
        result = planner.inspect_backup(root, receipt, {"ONLINE_OPS": PIN}, now=NOW, max_payload_bytes=10)
        self.assertEqual(result["code"], "PAYLOAD_BYTE_LIMIT")

    def test_peak_preserves_80_percent_and_5gib(self):
        result = planner.peak_plan(total_bytes=100 * planner.GIB, available_bytes=21 * planner.GIB,
                                  backup_bytes=1 * planner.GIB, build_bytes=1 * planner.GIB,
                                  import_bytes=1 * planner.GIB, restore_bytes=1 * planner.GIB,
                                  temporary_bytes=1 * planner.GIB)
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["simultaneousAdditionalPeakBytes"], 5 * planner.GIB)
        self.assertEqual(result["unchangedMonitorThresholdPercent"], 80)
        self.assertGreater(result["additionalCapacityNeededBytes"], 4 * planner.GIB)

    def test_small_disk_5gib_floor_dominates(self):
        result = planner.peak_plan(total_bytes=10 * planner.GIB, available_bytes=6 * planner.GIB,
                                  backup_bytes=2 * planner.GIB, build_bytes=0, import_bytes=0,
                                  restore_bytes=0, temporary_bytes=0)
        self.assertEqual(result["status"], "FAIL")

    def test_safe_peak_passes_no_production_change(self):
        result = planner.peak_plan(total_bytes=100 * planner.GIB, available_bytes=40 * planner.GIB,
                                  backup_bytes=planner.GIB, build_bytes=planner.GIB, import_bytes=planner.GIB,
                                  restore_bytes=planner.GIB, temporary_bytes=planner.GIB)
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["planOnly"])

    def test_retention_unknown_failed_latest_rollback_always_keep(self):
        rows = []
        for i in range(5):
            rows.append({"profile": "ONLINE_OPS", "backupId": "fake" + str(i), "status": "PASS",
                         "retentionEligible": True, "completedAt": f"2025-01-0{5-i}T00:00:00Z"})
        rows.append({"profile": "ONLINE_OPS", "backupId": "unknown", "status": "UNKNOWN", "retentionEligible": False})
        result = planner.retention_proposal(rows, at=NOW.isoformat(), protected_ids=["fake3"])
        decisions = {row["backupId"]: row for row in result["decisions"]}
        for ident in ("fake0", "fake1", "fake3"):
            self.assertEqual(decisions[ident]["decision"], "KEEP")
        self.assertEqual(decisions["unknown"]["decision"], "KEEP_UNPROVEN_OR_FORENSIC")
        self.assertEqual(decisions["fake4"]["decision"], "APPROVAL_CANDIDATE_NOT_AUTHORIZED")
        self.assertFalse(result["policyApproved"])
        self.assertEqual(result["productionChanges"], 0)
        self.assertTrue(all(not row["deleteAuthorized"] for row in result["decisions"]))

    def test_retention_buckets_are_per_profile(self):
        rows = [{"profile": profile, "backupId": profile + str(i), "status": "PASS", "retentionEligible": True,
                 "completedAt": f"2026-10-{27-i:02}T00:00:00Z"}
                for profile in ("ONLINE_OPS", "MODERN_UNIFIED") for i in range(3)]
        result = planner.retention_proposal(rows, at=NOW.isoformat())
        self.assertTrue(all(row["decision"] == "KEEP" for row in result["decisions"]))

    def test_cli_has_no_apply_delete_restore_command(self):
        result = subprocess.run([sys.executable, str(ROOT / "ops/capacity/planner.py"), "delete"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid choice", result.stderr)

    def test_cli_retention_unproven_point_returns_unknown_and_keeps(self):
        root, _, _ = self.backup()
        config = self.root / "config.json"
        config.write_text(json.dumps({"backups": [{"root": str(root)}]}))
        result = subprocess.run([sys.executable, str(ROOT / "ops/capacity/planner.py"), "retention",
                                 "--config=" + str(config)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["status"], "UNKNOWN")
        self.assertEqual(output["decisions"][0]["decision"], "KEEP_UNPROVEN_OR_FORENSIC")

    def test_cli_safe_inventory_uses_no_file_contents(self):
        (self.root / "fictional").write_text("synthetic-sensitive-token-do-not-output")
        result = subprocess.run([sys.executable, str(ROOT / "ops/capacity/planner.py"), "inventory",
                                 "--root=" + str(self.root)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertNotIn("synthetic-sensitive-token-do-not-output", result.stdout)
        self.assertFalse(json.loads(result.stdout)["deleteAuthorized"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
