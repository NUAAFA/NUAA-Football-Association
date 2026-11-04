#!/usr/bin/env python3
"""M06 read-only gate. Never deploys, writes approvals, migrates or controls services.

An independently approved, root-controlled plan supplies exact identities. Missing
proof is a failure, never inferred from a prior release or a historical report.
The synthetic profile is deliberately labelled and cannot approve production.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import sys

sys.dont_write_bytecode = True
SHA40 = re.compile(r"[0-9a-f]{40}\Z")
SHA64 = re.compile(r"[0-9a-f]{64}\Z")
PROGRAM_ROLES = {"node", "helper", "start", "wrapper", "deployer"}
SERVICE_PROPERTIES = ("MainPID", "NRestarts", "ExecMainStartTimestampMonotonic", "ActiveState", "SubState", "User", "Group",
                      "WorkingDirectory", "ExecStart", "SendSIGKILL", "TimeoutStopUSec", "KillMode")


class Stop(Exception):
    """Only a fixed check identifier is printed; paths and command stderr stay private."""


def need(ok, code):
    if not ok:
        raise Stop(code)


def sha_file(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read_json(path, max_bytes=4 * 1024 * 1024):
    need(path.stat().st_size <= max_bytes, "JSON_SIZE")
    def pairs(items):
        d = {}
        for key, value in items:
            need(key not in d, "DUPLICATE_JSON_KEY")
            d[key] = value
        return d
    return json.loads(path.read_bytes(), object_pairs_hook=pairs)


def trusted(path, owner, boundary=None, kind="file"):
    """Literal paths and every ancestor up to root (or synthetic boundary)."""
    path = Path(path)
    need(not any(part.startswith(".env") or part == ".ssh" for part in path.parts) and
         path.suffix.lower() not in {".key", ".pem", ".p12", ".pfx"}, "SECRET_PATH_FORBIDDEN")
    need(path.is_absolute() and path.resolve(strict=True) == path, "NONCANONICAL_PATH")
    if boundary is not None:
        need(path == boundary or boundary in path.parents, "SYNTHETIC_ESCAPE")
        need(not any(path == p or p in path.parents for p in
                     (Path("/srv/nuaafa"), Path("/opt/nuaafa"), Path("/etc/nuaafa"))), "SYNTHETIC_PRODUCTION_PATH")
    for p in (path, *path.parents):
        st = p.lstat()
        need(not stat.S_ISLNK(st.st_mode) and st.st_uid == owner and not st.st_mode & 0o022,
             "UNTRUSTED_METADATA")
        expected = stat.S_ISREG if p == path and kind == "file" else stat.S_ISDIR
        need(expected(st.st_mode), "UNTRUSTED_TYPE")
        if p == boundary:
            break
    if kind == "file":
        need(path.stat().st_nlink == 1, "MULTILINK_FILE")
    return path


def run_readonly(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=180,
                            env={"PATH": "/usr/sbin:/usr/bin:/bin", "LC_ALL": "C", "GIT_OPTIONAL_LOCKS": "0"})
    need(result.returncode == 0, "READONLY_COMMAND_FAILED")
    return result.stdout.strip()


def plan_shape(p, now):
    keys = {"format", "purpose", "approval_id", "expires_at", "commit", "tree", "allowed_ref",
            "artifact_sha256", "lock_sha256", "schema_sha256", "migration_inventory", "paths",
            "programs", "contract_sha256", "service_name", "application_user", "application_group",
            "build_id", "human_review", "security_gate", "linux_validation"}
    need(type(p) is dict and set(p) == keys and type(p["format"]) is int and p["format"] == 1,
         "PLAN_SHAPE")
    need(p["purpose"] == "M06_READONLY_PREFLIGHT", "PLAN_PURPOSE")
    need(isinstance(p["approval_id"], str) and re.fullmatch(r"[A-Za-z0-9_-]{6,96}", p["approval_id"]), "APPROVAL_ID")
    expiry = dt.datetime.fromisoformat(p["expires_at"].replace("Z", "+00:00"))
    need(expiry.tzinfo is not None and now < expiry <= now + dt.timedelta(hours=24), "APPROVAL_EXPIRED_OR_TOO_LONG")
    need(all(SHA40.fullmatch(p[k]) for k in ("commit", "tree")), "SOURCE_IDENTITY")
    need(all(SHA64.fullmatch(p[k]) for k in ("artifact_sha256", "lock_sha256", "schema_sha256", "contract_sha256")), "DIGEST_IDENTITY")
    need(re.fullmatch(r"refs/heads/[A-Za-z0-9][A-Za-z0-9._/-]*", p["allowed_ref"]) and
         ".." not in p["allowed_ref"] and "//" not in p["allowed_ref"] and not p["allowed_ref"].endswith("/"), "SOURCE_REF")
    need(p["human_review"] == "APPROVED" and p["security_gate"] == p["linux_validation"] == "PASS", "APPROVAL_GATES")
    migrations = p["migration_inventory"]
    need(type(migrations) is dict and len(migrations) == 21 and all(
         re.fullmatch(r"[0-9]{14}_[A-Za-z0-9_]+", k) and SHA64.fullmatch(v)
         for k, v in migrations.items()), "MIGRATION_PLAN")
    paths = p["paths"]
    need(type(paths) is dict and set(paths) == {"current", "releases", "shared", "database", "contracts",
         "receipt", "activation", "deployment_lock", "import_approval"}, "PATH_PLAN")
    need(all(isinstance(v, str) and Path(v).is_absolute() and ".." not in Path(v).parts for v in paths.values()), "PATH_PLAN")
    need(all(Path(paths[k]).suffix == ".json" for k in ("contracts", "receipt", "activation", "import_approval")) and
         Path(paths["deployment_lock"]).suffix not in {".db", ".sqlite", ".sqlite3"}, "METADATA_PATH_KIND")
    need(type(p["programs"]) is dict and set(p["programs"]) == PROGRAM_ROLES, "PROGRAM_PLAN")
    for role, record in p["programs"].items():
        need(type(record) is dict and set(record) == {"path", "sha256"} and
             isinstance(record["path"], str) and SHA64.fullmatch(record["sha256"]), "PROGRAM_PLAN")
        need(Path(record["path"]).suffix.lower() not in {".db", ".sqlite", ".sqlite3"}, "PROGRAM_PATH_KIND")
    for k in ("service_name", "application_user", "application_group", "build_id"):
        need(isinstance(p[k], str) and re.fullmatch(r"[A-Za-z0-9_.@-]{1,128}", p[k]), "TEXT_PLAN")
    need(p["service_name"] == "nuaafa.service", "SERVICE_IDENTITY")


def verify_service(p, facts, release):
    need(set(facts) == set(SERVICE_PROPERTIES), "SERVICE_PROPERTIES_MISSING")
    need(facts["ActiveState"] == "active" and facts["SubState"] == "running" and
         facts["MainPID"].isdigit() and int(facts["MainPID"]) > 0, "SERVICE_NOT_RUNNING")
    need(facts["NRestarts"].isdigit() and facts["ExecMainStartTimestampMonotonic"].isdigit() and
         int(facts["ExecMainStartTimestampMonotonic"]) > 0, "SERVICE_GENERATION_UNPROVEN")
    need(facts["User"] == p["application_user"] and facts["Group"] == p["application_group"], "SERVICE_USER")
    need(facts["WorkingDirectory"] == p["paths"]["current"], "SERVICE_CWD")
    # systemctl show reports a parsed ExecStart record. Require the exact first
    # executable, one command record, and no appended alternate command.
    cmd = facts["ExecStart"]
    expected = p["programs"]["wrapper"]["path"]
    need(cmd.count("path=") == 1 and ("path=" + expected + " ;") in cmd and
         cmd.count("argv[]=") == 1 and ("argv[]=" + expected + " ;") in cmd, "SERVICE_EXECSTART")
    need(facts["SendSIGKILL"] == "no" and facts["TimeoutStopUSec"] == "infinity" and
         facts["KillMode"] == "control-group", "UNSAFE_STOP_POLICY")
    return int(facts["MainPID"])


def verify_migrations(release, database, expected, schema_sha):
    directory = release / "prisma/migrations"
    need(not directory.is_symlink() and directory.is_dir(), "MIGRATION_DIRECTORY")
    names = sorted(expected)
    need(sorted(x.name for x in directory.iterdir()) == sorted(names + ["migration_lock.toml"]), "MIGRATION_INVENTORY")
    for name in names:
        m = directory / name / "migration.sql"
        need(not m.parent.is_symlink() and m.is_file() and not m.is_symlink() and sha_file(m) == expected[name], "MIGRATION_CHECKSUM")
    need(sha_file(release / "prisma/schema.prisma") == schema_sha, "SCHEMA_CHECKSUM")
    need(database.is_absolute() and database.resolve(strict=True) == database and
         database.is_file() and not database.is_symlink(), "DATABASE_PATH")
    db = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=0)
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        rows = db.execute("SELECT migration_name,checksum,started_at,finished_at,rolled_back_at "
                          "FROM _prisma_migrations ORDER BY started_at,rowid").fetchall()
        need(len(rows) == 21 and [r[0] for r in rows] == names and all(
             expected.get(r[0]) == r[1] and r[2] is not None and r[3] is not None and r[4] is None
             for r in rows), "DATABASE_MIGRATIONS")
        need(db.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "DATABASE_INTEGRITY")
        need(not db.execute("PRAGMA foreign_key_check").fetchall(), "DATABASE_FOREIGN_KEYS")
        need(db.total_changes == 0, "DATABASE_WRITE_GUARD")
    finally:
        db.close()


def process_identity(pid):
    root = Path("/proc") / str(pid)
    # Field22 is a generation identity even if a PID is reused. Do not export the
    # process name, command line, status or other process content.
    value = (root / "stat").read_text()
    start_ticks = value[value.rfind(")") + 2:].split()[19]
    need(start_ticks.isdigit(), "PROCESS_GENERATION_UNPROVEN")
    return (os.readlink(root / "cwd"), os.readlink(root / "exe"), start_ticks)


def check(plan_path, *, synthetic_root=None, runner=run_readonly, now=None, clock=None):
    clock = clock or (lambda: dt.datetime.now(dt.timezone.utc))
    now = now or clock()
    owner = os.geteuid() if synthetic_root else 0
    boundary = Path(synthetic_root).resolve(strict=True) if synthetic_root else None
    result = {"format": 1, "checked_at": now.isoformat(), "mode": "SYNTHETIC" if boundary else "PRODUCTION_READONLY",
              "status": "FAIL", "production_authorization": False, "checks": [],
              "not_performed": ["deployment", "service control", "migration", "data restore", "approval creation",
                                "remote fetch", "credential reads", "all-process writer census"]}
    try:
        need(Path(plan_path).suffix == ".json", "APPROVAL_PLAN_PATH_KIND")
        trusted(Path(plan_path), owner, boundary)
        p = read_json(Path(plan_path))
        plan_shape(p, now)
        result["checks"].append("APPROVAL_IDENTITY")
        result["commit"], result["tree"] = p["commit"], p["tree"]
        paths = {k: Path(v) for k, v in p["paths"].items()}
        for k in ("releases", "shared"):
            trusted(paths[k], owner, boundary, "directory")
        current = paths["current"]
        trusted(current.parent, owner, boundary, "directory")
        release = paths["releases"] / p["commit"]
        need(current.is_symlink() and os.readlink(current) == str(release) and current.resolve(strict=True) == release,
             "CURRENT_LINK_IDENTITY")
        trusted(release, owner, boundary, "directory")
        need(paths["database"] == paths["shared"] / "prisma/dev.db", "SHARED_DATABASE_IDENTITY")
        for role, record in p["programs"].items():
            f = trusted(Path(record["path"]), owner, boundary)
            need(sha_file(f) == record["sha256"], "PROGRAM_DIGEST_" + role.upper())
            if role != "helper":
                need(f.stat().st_mode & 0o111, "PROGRAM_NOT_EXECUTABLE")
        result["checks"].append("SEALED_PROGRAM_IDENTITIES")
        for key in ("contracts", "receipt", "activation", "deployment_lock", "import_approval"):
            trusted(paths[key], owner, boundary)
        need(sha_file(paths["contracts"]) == p["contract_sha256"], "CONTRACT_DIGEST")
        contracts = read_json(paths["contracts"])
        record = contracts.get("contracts", {}).get(p["commit"])
        need(type(contracts.get("format")) is int and contracts["format"] == 1 and contracts.get("current") == str(current) and
             contracts.get("releases") == str(paths["releases"]) and isinstance(record, dict) and
             record.get("sha256") == p["artifact_sha256"] and all(
             record.get(role) == p["programs"][role]["path"] and
             record.get(role + "_sha256") == p["programs"][role]["sha256"]
             for role in ("node", "helper", "start")), "VERSIONED_CONTRACT_IDENTITY")
        activation = read_json(paths["activation"])
        need(type(activation.get("format")) is int and activation["format"] in (1, 2) and activation.get("phase") == "HEALTHY" and
             activation.get("commit") == p["commit"], "ACTIVATION_NOT_HEALTHY")
        # The current sealed source/native inventory receipt is ~6.9MB. Keep
        # ordinary approvals/configuration at 4MiB and give only this inventory
        # a separate bounded budget; every identity/helper check still applies.
        receipt = read_json(paths["receipt"], max_bytes=16 * 1024 * 1024)
        need(receipt.get("commit") == p["commit"] and receipt.get("sha256") == p["artifact_sha256"] and
             receipt.get("allowed_ref") == p["allowed_ref"], "ARTIFACT_RECEIPT_IDENTITY")
        approval = read_json(paths["import_approval"])
        need(approval == dict(format=1, commit=p["commit"], artifact_sha256=p["artifact_sha256"],
             allowed_ref=p["allowed_ref"], security_gate="PASS", linux_artifact_validation="PASS",
             human_review="APPROVED"), "INDEPENDENT_IMPORT_APPROVAL")
        result["checks"].append("CONTRACT_ACTIVATION_ARTIFACT")
        with paths["deployment_lock"].open("rb") as lock:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Stop("DEPLOYMENT_LOCK_BUSY") from None
            git = ["/usr/bin/git", "-c", "safe.directory=" + str(release), "-C", str(release)]
            need(runner(git + ["rev-parse", "HEAD"]) == p["commit"] and
                 runner(git + ["rev-parse", "HEAD^{tree}"]) == p["tree"], "GIT_IDENTITY")
            need(sha_file(release / "package-lock.json") == p["lock_sha256"], "LOCKFILE_DIGEST")
            need((release / ".next/BUILD_ID").read_text().strip() == p["build_id"], "BUILD_IDENTITY")
            need(runner([p["programs"]["node"]["path"], "--version"]) == "v22.23.4", "NODE_VERSION")
            for package, version in (("next", "16.4.1"), ("@prisma/client", "7.9.1")):
                need(read_json(release / "node_modules" / package / "package.json").get("version") == version,
                     "RUNTIME_PACKAGE_VERSION")
            verify_migrations(release, paths["database"], p["migration_inventory"], p["schema_sha256"])
            result["checks"].append("SOURCE_RUNTIME_AND_21_MIGRATIONS")
            show = runner(["/usr/bin/systemctl", "show", p["service_name"],
                           "--property=" + ",".join(SERVICE_PROPERTIES)])
            facts = dict(line.split("=", 1) for line in show.splitlines() if "=" in line)
            pid = verify_service(p, facts, release)
            process_before = None
            if not boundary:
                need(Path("/proc") .is_dir(), "LINUX_PROCESS_PROOF_MISSING")
                process_before = process_identity(pid)
                need(process_before[:2] == (str(release), p["programs"]["node"]["path"]), "PROCESS_IDENTITY")
            result["checks"].append("SERVICE_AND_STOP_CONTRACT")
            # Hash-verified installed helper, read-only modes only; no candidate
            # runtime imports, no pack/extract/state/approve/deploy subcommands.
            helper = ["/usr/bin/python3", "-I", "-B", p["programs"]["helper"]["path"]]
            runner(helper + ["verify", "--release", str(release), "--receipt", str(paths["receipt"]),
                            "--shared", str(paths["shared"]), "--git-user", p["application_user"],
                            "--sha256", p["artifact_sha256"], "--commit", p["commit"], "--allowed-ref", p["allowed_ref"]])
            runner(helper + ["runtime-ready", "--release", str(release), "--database", str(paths["database"]),
                            "--state", str(paths["activation"])])
            need(current.resolve(strict=True) == release and sha_file(paths["contracts"]) == p["contract_sha256"] and
                 read_json(paths["activation"]) == activation, "IDENTITY_CHANGED_DURING_CHECK")
            final_show = runner(["/usr/bin/systemctl", "show", p["service_name"],
                                 "--property=" + ",".join(SERVICE_PROPERTIES)])
            final_facts = dict(line.split("=", 1) for line in final_show.splitlines() if "=" in line)
            final_pid = verify_service(p, final_facts, release)
            need(final_facts == facts and final_pid == pid, "SERVICE_CHANGED_DURING_CHECK")
            if not boundary:
                need(process_identity(final_pid) == process_before, "PROCESS_CHANGED_DURING_CHECK")
            finished = clock()
            need(finished >= now, "CLOCK_MOVED_BACKWARDS")
            plan_shape(p, finished)
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
        result["checks"].append("INSTALLED_HELPER_READONLY_VALIDATION")
        result["status"] = "PASS"
        result["limitation"] = "A read-only preflight does not grant deployment/rollback approval or prove absence of other database writers."
    except Stop as e:
        result["stop_code"] = str(e)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError, sqlite3.Error, subprocess.SubprocessError, RuntimeError):
        # Never print exceptions: database paths, raw command errors or JSON
        # content may contain private configuration or operator input.
        result["stop_code"] = "UNVERIFIABLE_INPUT_OR_ENVIRONMENT"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--approval-plan", type=Path, required=True)
    parser.add_argument("--synthetic-root", type=Path, help="Explicit same-user fixture mode; never production proof")
    args = parser.parse_args()
    result = check(args.approval_plan, synthetic_root=args.synthetic_root)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
