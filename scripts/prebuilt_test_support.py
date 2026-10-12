"""Strict disposable-fixture checks; never used by the production deployer."""
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile


def diagnostic(record):
    print("fixture metadata: " + json.dumps(record, sort_keys=True), file=sys.stderr)


def trusted_path(path, kind="directory"):
    """Check the literal path and every ancestor, without trusting a location."""
    path = Path(path)
    failures = []
    try:
        canonical = str(path.resolve(strict=True))
    except (OSError, RuntimeError) as error:
        canonical = None
        failures.append(str(error))
    if not path.is_absolute() or canonical != str(path):
        failures.append("path is not absolute and canonical: " + str(path))
    for item in (path, *path.parents):
        record = dict(path=str(item), uid=None, mode=None, symlink=None,
                      canonical=canonical if item == path else None)
        reasons = []
        try:
            info = item.lstat()
            record.update(uid=info.st_uid, mode=oct(stat.S_IMODE(info.st_mode)),
                          symlink=stat.S_ISLNK(info.st_mode), file_type=stat.S_IFMT(info.st_mode))
            if record["symlink"]: reasons.append("symlink")
            if info.st_uid != 0: reasons.append("owner is not root")
            if info.st_mode & 0o022: reasons.append("group/world writable")
            expected = stat.S_ISREG if item == path and kind == "file" else stat.S_ISDIR
            if not expected(info.st_mode): reasons.append("wrong file type")
        except OSError as error:
            reasons.append(str(error))
        if item == path and canonical != str(path): reasons.append("noncanonical path")
        record["rejection"] = "; ".join(reasons) or None
        diagnostic(record)
        failures.extend(str(item) + ": " + reason for reason in reasons)
    if failures:
        raise ValueError("untrusted test path: " + "; ".join(failures))
    return path


def fixture_parent(candidates=("/var/lib", "/var/cache")):
    failures = []
    for candidate in candidates:
        try:
            return trusted_path(candidate)
        except (OSError, ValueError) as error:
            failures.append(str(error))
    raise ValueError("no trusted root fixture parent: " + " | ".join(failures))


def resolve_system_command(name):
    # Resolve before applying the application's minimal/poisoned environment.
    # Search only canonical system locations, never inherited PATH entries.
    if name not in {"runuser", "useradd", "userdel", "groupdel"}:
        raise ValueError("unexpected fixture system command")
    found = shutil.which(name, path="/usr/sbin:/usr/bin")
    if found is None:
        raise FileNotFoundError(name + " is missing or not executable in /usr/sbin:/usr/bin")
    executable = trusted_path(found, kind="file")
    if not executable.stat().st_mode & 0o111 or not os.access(executable, os.X_OK):
        raise ValueError(name + " is not executable: " + str(executable))
    diagnostic(dict(command=name, resolved=str(executable), executable=True))
    return str(executable)


def resolve_runuser():
    return resolve_system_command("runuser")


def exclusive_fixture(resources):
    parent = fixture_parent()
    # Register ownership immediately, before chmod/postcreation validation.
    root = Path(tempfile.mkdtemp(prefix="nuaafa-permission-", dir=parent))
    resources.remember_root(root)
    root.chmod(0o755)
    trusted_path(root)
    resources.check_root_identity()
    return root
