#!/usr/bin/env python3
"""Read-only capacity accounting and retention proposal. No apply/delete operation."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import time

GIB = 1024 ** 3
CATEGORIES = {"business", "release-or-rollback", "backup", "forensic", "temporary-review", "unknown"}
SHA = re.compile(r"[0-9a-f]{64}\Z")
O_DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
O_FILE = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK


class Unsafe(ValueError):
    """A safe public error code, without underlying path/query contents."""


def need(ok, code):
    if not ok:
        raise Unsafe(code)


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def parse_utc(value):
    need(isinstance(value, str), "TIME_INVALID")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise Unsafe("TIME_INVALID") from exc
    need(parsed.tzinfo is not None, "TIME_MUST_HAVE_ZONE")
    return parsed.astimezone(dt.timezone.utc)


def open_root(path):
    """Reject aliases and open every directory component without following links."""
    path = Path(path)
    need(path.is_absolute() and ".." not in path.parts, "ROOT_MUST_BE_ABSOLUTE")
    fd = os.open("/", O_DIR)
    try:
        for component in path.parts[1:]:
            child = os.open(component, O_DIR, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def inventory(path, *, category="unknown", max_entries=100000, max_seconds=30, max_depth=64):
    need(category in CATEGORIES, "CATEGORY_INVALID")
    need(1 <= max_entries <= 2000000 and 0 < max_seconds <= 600 and 0 <= max_depth <= 128,
         "SCAN_BOUNDS_INVALID")
    root_fd = open_root(path)
    root_stat = os.fstat(root_fd)
    seen = set()
    deadline = time.monotonic() + max_seconds
    result = {"root": str(path), "category": category, "device": root_stat.st_dev,
              "logicalRegularBytes": 0, "uniqueLogicalRegularBytes": 0,
              "uniqueAllocatedBytes": 0, "regularFiles": 0, "directories": 0,
              "symlinksNotFollowed": 0, "crossDeviceNotEntered": 0, "otherObjects": 0,
              "hardlinkAliases": 0, "entries": 0, "incompleteReasons": [],
              "deleteAuthorized": False}

    def mark(reason):
        if reason not in result["incompleteReasons"]:
            result["incompleteReasons"].append(reason)

    def visit(fd, depth):
        s = os.fstat(fd)
        key = (s.st_dev, s.st_ino)
        if key not in seen:
            seen.add(key)
            result["uniqueAllocatedBytes"] += getattr(s, "st_blocks", 0) * 512
        result["directories"] += 1
        if depth >= max_depth:
            mark("DEPTH_LIMIT")
            return
        try:
            with os.scandir(fd) as entries:
                for entry in entries:
                    if result["entries"] >= max_entries or time.monotonic() >= deadline:
                        mark("ENTRY_OR_TIME_LIMIT")
                        return
                    result["entries"] += 1
                    try:
                        s = os.stat(entry.name, dir_fd=fd, follow_symlinks=False)
                        if stat.S_ISLNK(s.st_mode):
                            result["symlinksNotFollowed"] += 1
                            continue
                        if s.st_dev != root_stat.st_dev:
                            result["crossDeviceNotEntered"] += 1
                            continue
                        if stat.S_ISDIR(s.st_mode):
                            child = os.open(entry.name, O_DIR, dir_fd=fd)
                            try:
                                need((os.fstat(child).st_dev, os.fstat(child).st_ino) == (s.st_dev, s.st_ino),
                                     "DIRECTORY_CHANGED")
                                visit(child, depth + 1)
                            finally:
                                os.close(child)
                        elif stat.S_ISREG(s.st_mode):
                            result["regularFiles"] += 1
                            result["logicalRegularBytes"] += s.st_size
                            key = (s.st_dev, s.st_ino)
                            if key in seen:
                                result["hardlinkAliases"] += 1
                            else:
                                seen.add(key)
                                result["uniqueLogicalRegularBytes"] += s.st_size
                                result["uniqueAllocatedBytes"] += getattr(s, "st_blocks", 0) * 512
                        else:
                            result["otherObjects"] += 1
                    except (OSError, Unsafe):
                        mark("OBJECT_CHANGED_OR_UNREADABLE")
        except OSError:
            mark("DIRECTORY_UNREADABLE")

    try:
        fs = os.fstatvfs(root_fd)
        result["filesystem"] = {"totalBytes": fs.f_blocks * fs.f_frsize,
                                "availableBytes": fs.f_bavail * fs.f_frsize,
                                "freeBytesIncludingReserved": fs.f_bfree * fs.f_frsize,
                                "inodeTotal": fs.f_files, "inodeFree": fs.f_ffree}
        visit(root_fd, 0)
    finally:
        os.close(root_fd)
    result["status"] = "PASS" if not result["incompleteReasons"] else "UNKNOWN"
    result["accountingNotes"] = ["Allocated bytes are st_blocks*512; reflink/compression sharing is not measurable here.",
                                 "Counts are a bounded live sample, not a frozen filesystem snapshot.",
                                 "Hardlinks are deduplicated within this root only; overlapping roots must not be summed."]
    return result


def read_file(root_fd, name, *, max_bytes=8 * 1024 * 1024):
    relative = PurePosixPath(name)
    need(not relative.is_absolute() and name == relative.as_posix() and
         all(x not in ("", ".", "..") for x in relative.parts), "PAYLOAD_PATH_INVALID")
    fd = os.dup(root_fd)
    try:
        for component in relative.parts[:-1]:
            child = os.open(component, O_DIR, dir_fd=fd)
            os.close(fd)
            fd = child
        f = os.open(relative.parts[-1], O_FILE, dir_fd=fd)
        try:
            before = os.fstat(f)
            need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "FILE_TYPE_OR_LINK")
            need(before.st_size <= max_bytes, "METADATA_TOO_LARGE")
            data = bytearray()
            while len(data) <= max_bytes:
                chunk = os.read(f, min(1024 * 1024, max_bytes + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
            after = os.fstat(f)
            need((before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                 (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), "FILE_CHANGED")
            need(len(data) == before.st_size, "FILE_CHANGED")
            return bytes(data)
        finally:
            os.close(f)
    finally:
        os.close(fd)


def hash_payload(root_fd, name, max_bytes, deadline=float("inf")):
    """Bounded streaming hash without keeping database/upload contents in memory."""
    relative = PurePosixPath(name)
    need(not relative.is_absolute() and name == relative.as_posix() and
         all(x not in ("", ".", "..") for x in relative.parts), "PAYLOAD_PATH_INVALID")
    fd = os.dup(root_fd)
    try:
        for component in relative.parts[:-1]:
            child = os.open(component, O_DIR, dir_fd=fd)
            os.close(fd)
            fd = child
        f = os.open(relative.parts[-1], O_FILE, dir_fd=fd)
        try:
            before = os.fstat(f)
            need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "FILE_TYPE_OR_LINK")
            need(before.st_size <= max_bytes, "PAYLOAD_BYTE_LIMIT")
            digest = hashlib.sha256()
            count = 0
            while True:
                need(time.monotonic() < deadline, "VERIFY_TIME_LIMIT")
                chunk = os.read(f, 1024 * 1024)
                if not chunk:
                    break
                count += len(chunk)
                need(count <= max_bytes, "PAYLOAD_BYTE_LIMIT")
                digest.update(chunk)
            after = os.fstat(f)
            identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
            need(identity(before) == identity(after) and count == before.st_size, "PAYLOAD_CHANGED")
            return {"bytes": count, "sha256": digest.hexdigest()}
        finally:
            os.close(f)
    finally:
        os.close(fd)


def fileset(root_fd, max_files, deadline=float("inf")):
    found = set()
    count = 0

    def visit(fd, prefix="", depth=0):
        nonlocal count
        need(depth < 64, "FILESET_DEPTH_LIMIT")
        with os.scandir(fd) as entries:
            for entry in entries:
                count += 1
                need(count <= max_files * 4 + 64 and time.monotonic() < deadline, "FILESET_SCAN_LIMIT")
                name = prefix + entry.name
                s = os.stat(entry.name, dir_fd=fd, follow_symlinks=False)
                if stat.S_ISDIR(s.st_mode):
                    child = os.open(entry.name, O_DIR, dir_fd=fd)
                    try:
                        need(os.fstat(child).st_dev == os.fstat(root_fd).st_dev, "FILESET_CROSS_DEVICE")
                        visit(child, name + "/", depth + 1)
                    finally:
                        os.close(child)
                else:
                    need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1, "FILESET_LINK_OR_TYPE")
                    found.add(name)
                    need(len(found) <= max_files, "FILESET_LIMIT")
    visit(root_fd)
    return found


def payload_set_sha(records):
    return hashlib.sha256(json.dumps(records, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def database_checks(root_fd, profile, manifest, deadline=float("inf")):
    """Read an immutable completed snapshot; never SQLite's writable default URI."""
    fd = os.open("database.sqlite", O_FILE, dir_fd=root_fd)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "DATABASE_TYPE_OR_LINK")
        descriptor_root = "/proc/self/fd" if Path("/proc/self/fd").is_dir() else "/dev/fd"
        db = sqlite3.connect(f"file:{descriptor_root}/{fd}?mode=ro&immutable=1", uri=True, timeout=0)
        try:
            db.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
            db.execute("PRAGMA query_only=ON")
            db.execute("BEGIN")
            need(db.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "DATABASE_INTEGRITY")
            need(db.execute("PRAGMA foreign_key_check").fetchall() == [], "DATABASE_FOREIGN_KEYS")
            if profile == "ONLINE_OPS":
                tables = {}
                for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
                    need(time.monotonic() < deadline, "VERIFY_TIME_LIMIT")
                    rows = db.execute('SELECT * FROM "' + name.replace('"', '""') + '"').fetchall()
                    tables[name] = {"count": len(rows), "sha256": hashlib.sha256(b"".join(sorted(
                        hashlib.sha256(repr(row).encode()).digest() for row in rows))).hexdigest()}
                schema = list(db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"))
                need({"tables": tables, "schema_sha256": hashlib.sha256(repr(schema).encode()).hexdigest()} ==
                     manifest.get("database_logical"), "DATABASE_LOGICAL")
            else:
                migrations = [row[0] for row in db.execute(
                    'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY started_at')]
                bad = db.execute("SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL").fetchone()[0]
                need(not bad and migrations == manifest.get("migrations"), "DATABASE_MIGRATIONS")
            need(db.total_changes == 0, "DATABASE_WRITE")
        finally:
            db.rollback()
            db.close()
        after = os.fstat(fd)
        need((before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), "DATABASE_CHANGED")
    finally:
        os.close(fd)


def inspect_backup(path, receipt=None, verifier_pins=None, *, now=None, max_receipt_age_hours=24,
                   max_payload_bytes=100 * GIB, max_files=100000, max_seconds=60):
    """Never substitutes this accounting tool for either format's authoritative verifier.

    A caller-supplied receipt can bind metadata but cannot prove trusted execution.
    This candidate therefore NEVER makes a backup retention-eligible. Its extra
    checks are useful preparation for a separate independently verified approval.
    """
    result = {"path": str(path), "status": "UNKNOWN", "retentionEligible": False,
              "deleteAuthorized": False, "protection": "UNPROVEN_KEEP"}
    need(0 < max_seconds <= 600 and 0 < max_files <= 1000000 and max_payload_bytes > 0 and
         0 < max_receipt_age_hours <= 24, "VERIFY_BOUNDS_INVALID")
    deadline = time.monotonic() + max_seconds
    root_fd = open_root(path)
    try:
        try:
            names = fileset(root_fd, max_files + 2, deadline)
            need("FAILED.json" not in names, "FAILED_EVIDENCE_KEEP")
            raw = read_file(root_fd, "manifest.json")
            manifest = json.loads(raw)
            done = json.loads(read_file(root_fd, "COMPLETED.json"))
            need(isinstance(manifest, dict) and isinstance(done, dict), "BACKUP_METADATA_SCHEMA")
            manifest_sha = hashlib.sha256(raw).hexdigest()
            if manifest.get("format") == "NUAAFA_ONLINE_OPS_V1":
                need(not any(key in manifest for key in ("formatVersion", "backupProfile", "backupId")),
                     "CONFLICTING_BACKUP_FORMAT_MARKERS")
                profile = "ONLINE_OPS"
                ident, timestamp = manifest["backup_id"], manifest["completed_utc"]
                need(done.get("backup_id") == ident and done.get("manifest_sha256") == manifest_sha,
                     "COMPLETION_BINDING")
                need(manifest.get("consistency") == "ONLINE_STABLE_INTERVAL_VERIFIED", "CONSISTENCY_UNPROVEN")
                expected = manifest["checksums"]
                need(isinstance(expected, dict) and all(isinstance(r, dict) and isinstance(r.get("bytes"), int) and
                         r["bytes"] >= 0 and SHA.fullmatch(r.get("sha256", "")) for r in expected.values()),
                     "ONLINE_CHECKSUM_SCHEMA")
                required_checks = {"payloadChecksums", "fileSet", "databaseIntegrity", "foreignKeys", "databaseLogical"}
            elif manifest.get("formatVersion") == 3 and manifest.get("backupProfile") == "MODERN_UNIFIED":
                need(not any(key in manifest for key in ("format", "backup_id", "completed_utc")),
                     "CONFLICTING_BACKUP_FORMAT_MARKERS")
                profile = "MODERN_UNIFIED"
                ident, timestamp = manifest["backupId"], manifest["generatedAtUtc"]
                need(done.get("formatVersion") == 1 and done.get("backupId") == ident and
                     done.get("manifestSha256") == manifest_sha, "COMPLETION_BINDING")
                expected = {"database.sqlite": {"bytes": manifest["database"]["bytes"],
                                                "sha256": manifest["database"]["sha256"]}}
                for upload in manifest["uploads"]["files"]:
                    key = "uploads/" + upload["storageKey"]
                    need(key not in expected, "MODERN_DUPLICATE_UPLOAD")
                    expected[key] = {"bytes": upload["bytes"], "sha256": upload["sha256"]}
                need(manifest["checksums"] == {k: v["sha256"] for k, v in expected.items()}, "MODERN_CHECKSUM_SCHEMA")
                required_checks = {"payloadChecksums", "fileSet", "databaseIntegrity", "foreignKeys", "migrationLedger", "schemaCapabilities"}
            else:
                raise Unsafe("UNKNOWN_OR_MIXED_BACKUP_FORMAT")
            need("database.sqlite" in expected and names == set(expected) | {"manifest.json", "COMPLETED.json"},
                 "FILESET_MISMATCH")
            need(len(expected) <= max_files, "FILESET_LIMIT")
            records = {}
            remaining = max_payload_bytes
            for name in sorted(expected):
                actual = hash_payload(root_fd, name, remaining, deadline)
                need(actual == expected[name], "PAYLOAD_MISMATCH")
                remaining -= actual["bytes"]
                records[name] = actual
            need(fileset(root_fd, max_files + 2, deadline) == names and read_file(root_fd, "manifest.json") == raw,
                 "BACKUP_CHANGED")
            database_checks(root_fd, profile, manifest, deadline)
            need(all(hash_payload(root_fd, name, max_payload_bytes, deadline) == record for name, record in records.items()),
                 "BACKUP_CHANGED_DURING_DATABASE_CHECK")
            result.update(profile=profile, backupId=ident, completedAt=timestamp, manifestSha256=manifest_sha,
                          payloadSetSha256=payload_set_sha(records), payloadFiles=len(records),
                          payloadBytes=sum(x["bytes"] for x in records.values()))
            need(parse_utc(timestamp) <= (now or dt.datetime.now(dt.timezone.utc)), "BACKUP_FROM_FUTURE")
            need(isinstance(receipt, dict) and isinstance(verifier_pins, dict), "FULL_VERIFICATION_RECEIPT_REQUIRED")
            need(receipt.get("status") == "PASS" and receipt.get("profile") == profile and
                 receipt.get("backupId") == ident and receipt.get("manifestSha256") == manifest_sha and
                 receipt.get("payloadSetSha256") == result["payloadSetSha256"], "VERIFICATION_RECEIPT_BINDING")
            pin = verifier_pins.get(profile, "")
            need(SHA.fullmatch(pin) and receipt.get("verifierSha256") == pin, "VERIFIER_PIN_REQUIRED")
            checks = receipt.get("checks", {})
            need(isinstance(checks, dict) and all(checks.get(k) == "PASS" for k in required_checks),
                 "FULL_VERIFICATION_INCOMPLETE")
            checked = parse_utc(receipt.get("checkedAt"))
            age = ((now or dt.datetime.now(dt.timezone.utc)) - checked).total_seconds()
            need(0 <= age <= max_receipt_age_hours * 3600, "VERIFICATION_RECEIPT_STALE")
            result.update(status="UNKNOWN", retentionEligible=False,
                          protection="INDEPENDENT_PROVENANCE_REVIEW_REQUIRED",
                          payloadAndDatabaseChecks="PASS", receiptBindingChecks="PASS",
                          receiptExecutionProvenance="UNKNOWN",
                          code="CALLER_ATTESTATION_IS_NOT_TRUSTED_EXECUTION_PROOF")
        except (Unsafe, KeyError, TypeError, ValueError, OSError, sqlite3.Error) as exc:
            result["code"] = str(exc) if isinstance(exc, Unsafe) else "BACKUP_METADATA_UNREADABLE"
            if result["code"] == "FAILED_EVIDENCE_KEEP":
                result["protection"] = "FAILED_EVIDENCE_KEEP"
    finally:
        os.close(root_fd)
    return result


def retention_proposal(backups, *, at, daily=14, weekly=8, monthly=12, protected_ids=()):
    """Proposal only: neither approval nor a command capable of removal."""
    need(0 <= daily <= 3650 and 0 <= weekly <= 520 and 0 <= monthly <= 120, "RETENTION_POLICY_INVALID")
    now = parse_utc(at)
    protected = set(protected_ids)
    groups = {}
    decisions = []
    for item in backups:
        row = dict(item)
        row["decision"] = "KEEP_UNPROVEN_OR_FORENSIC"
        row["deleteAuthorized"] = False
        decisions.append(row)
        if row.get("status") == "PASS" and row.get("retentionEligible") is True:
            groups.setdefault(row["profile"], []).append(row)
    for rows in groups.values():
        rows.sort(key=lambda r: parse_utc(r["completedAt"]), reverse=True)
        seen_day, seen_week, seen_month = set(), set(), set()
        for i, row in enumerate(rows):
            timestamp = parse_utc(row["completedAt"])
            age_days = (now.date() - timestamp.date()).days
            week = timestamp.isocalendar()[:2]
            month = (timestamp.year, timestamp.month)
            month_age = (now.year - timestamp.year) * 12 + now.month - timestamp.month
            reasons = []
            if i < 2:
                reasons.append("LATEST_TWO_VERIFIED_PER_PROFILE")
            if row["backupId"] in protected:
                reasons.append("EXPLICIT_ROLLBACK_OR_HOLD")
            if timestamp > now:
                reasons.append("FUTURE_TIMESTAMP_KEEP")
            if 0 <= age_days < daily and timestamp.date() not in seen_day:
                reasons.append("DAILY_PROPOSAL")
                seen_day.add(timestamp.date())
            weeks_old = ((now.date() - dt.timedelta(days=now.weekday())) -
                         (timestamp.date() - dt.timedelta(days=timestamp.weekday()))).days // 7
            if 0 <= weeks_old < weekly and week not in seen_week:
                reasons.append("WEEKLY_PROPOSAL")
                seen_week.add(week)
            if 0 <= month_age < monthly and month not in seen_month:
                reasons.append("MONTHLY_PROPOSAL")
                seen_month.add(month)
            row["decision"] = "KEEP" if reasons else "APPROVAL_CANDIDATE_NOT_AUTHORIZED"
            row["reasons"] = reasons or ["OUTSIDE_UNAPPROVED_PROPOSED_BUCKETS"]
    return {"status": "PROPOSAL_ONLY", "policyApproved": False, "productionChanges": 0,
            "policy": {"dailyDays": daily, "weeklyWeeks": weekly, "monthlyMonths": monthly},
            "decisions": decisions}


def peak_plan(*, total_bytes, available_bytes, backup_bytes, build_bytes, import_bytes,
              restore_bytes, temporary_bytes, minimum_free_bytes=5 * GIB, threshold_percent=80):
    values = [total_bytes, available_bytes, backup_bytes, build_bytes, import_bytes,
              restore_bytes, temporary_bytes, minimum_free_bytes]
    need(all(type(x) is int and x >= 0 for x in values) and total_bytes > 0 and
         available_bytes <= total_bytes and 0 < threshold_percent < 100, "CAPACITY_INPUT_INVALID")
    peak = backup_bytes + build_bytes + import_bytes + restore_bytes + temporary_bytes
    after = available_bytes - peak
    threshold_floor = total_bytes * (100 - threshold_percent) / 100
    required = max(minimum_free_bytes, threshold_floor)
    return {"status": "PASS" if after > required else "FAIL", "planOnly": True,
            "assumption": "All listed operations overlap on the same filesystem; no unmeasured compression credit.",
            "totalBytes": total_bytes, "availableBytes": available_bytes,
            "simultaneousAdditionalPeakBytes": peak, "availableAfterPeakBytes": after,
            "minimumFreeBytes": minimum_free_bytes, "unchangedMonitorThresholdPercent": threshold_percent,
            "headroomToMonitorThresholdBytes": available_bytes - threshold_floor,
            "requiredFreeBeforePeakBytes": required + peak,
            "additionalCapacityNeededBytes": max(0, int(required + peak - available_bytes) + 1)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    scan = sub.add_parser("inventory")
    scan.add_argument("--root", required=True)
    scan.add_argument("--category", choices=sorted(CATEGORIES), default="unknown")
    scan.add_argument("--max-entries", type=int, default=100000)
    scan.add_argument("--max-seconds", type=float, default=30)
    plan = sub.add_parser("peak")
    for flag in ["total-bytes", "available-bytes", "backup-bytes", "build-bytes", "import-bytes", "restore-bytes", "temporary-bytes"]:
        plan.add_argument("--" + flag, type=int, required=True)
    retention = sub.add_parser("retention")
    retention.add_argument("--config", required=True,
                           help="Dedicated nonsecret JSON with pinned verifier receipts and explicit roots; proposal only")
    args = vars(parser.parse_args())
    command = args.pop("command")
    try:
        if command == "inventory":
            result = inventory(args.pop("root"), **args)
        elif command == "peak":
            result = peak_plan(**args)
        else:
            config_path = Path(args["config"])
            need(config_path.is_absolute(), "CONFIG_ABSOLUTE_REQUIRED")
            fd = open_root(config_path.parent)
            try:
                config = json.loads(read_file(fd, config_path.name))
            finally:
                os.close(fd)
            need(isinstance(config, dict) and isinstance(config.get("backups"), list) and
                 len(config["backups"]) <= 1000, "CONFIG_SCHEMA")
            checked_at = dt.datetime.now(dt.timezone.utc)
            checked = [inspect_backup(row["root"], row.get("receipt"), config.get("verifierPins"),
                                      now=checked_at) for row in config["backups"]]
            result = retention_proposal(checked, at=checked_at.isoformat(),
                                        protected_ids=config.get("protectedIds", ()), **config.get("policy", {}))
            result["status"] = "PASS" if all(row["status"] == "PASS" for row in checked) else "UNKNOWN"
            result["scope"] = "Read-only proposal; PASS means inputs verified, never an approved deletion."
        print(json.dumps({"checkedAt": utc(), **result}, ensure_ascii=False, sort_keys=True))
        return 0 if result["status"] == "PASS" else 2
    except (Unsafe, OSError, ValueError, TypeError, KeyError):
        print(json.dumps({"checkedAt": utc(), "status": "UNKNOWN", "code": "SAFE_PREFLIGHT_STOP"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
