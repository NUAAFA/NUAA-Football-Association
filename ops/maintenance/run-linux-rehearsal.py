#!/usr/bin/env python3
"""Run only on a disposable private/GitHub-hosted Linux test machine.

Fictional data only. Does not contact production, install services, or authorize
deployment. Existing root tests create/clean their own uniquely identified user
and fixture. The full workflow also packages the exact build and imports twice.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import platform
import pwd
import shutil
import subprocess
import sys


def production_paths_present(paths=("/srv/nuaafa", "/etc/nuaafa", "/opt/nuaafa")):
    # A broken symlink is still an unknown production-like object, not absence.
    return any(os.path.lexists(path) for path in paths)


def test_environment(environment, application_user=None, lookup=pwd.getpwnam):
    """Preserve the original startup suite's real root/app split and trusted parent."""
    user = application_user or environment.get("SUDO_USER")
    if not user:
        raise ValueError("A real non-root fixture application user is required")
    account = lookup(user)
    if account.pw_uid == 0:
        raise ValueError("Fixture application user must not be root")
    return dict(environment, NUAAFA_TEST_ROOT="/var/lib", NUAAFA_TEST_APP_USER=user)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-disposable", action="store_true", required=True)
    parser.add_argument("--application-user", help="Existing non-root CI account; defaults to SUDO_USER")
    args = parser.parse_args()
    if not args.confirm_disposable or platform.system() != "Linux" or platform.machine() != "x86_64" or os.geteuid() != 0:
        print(json.dumps({"status": "NOT RUN", "reason": "Requires explicit disposable Linux x64 root runner"}))
        return 2
    if production_paths_present():
        print(json.dumps({"status": "FAIL", "reason": "Production-like paths present; refusing rehearsal"}))
        return 1
    os_release = dict(line.split("=", 1) for line in Path("/etc/os-release").read_text().splitlines() if "=" in line)
    if os_release.get("ID", "").strip('"') != "ubuntu" or os_release.get("VERSION_ID", "").strip('"') != "24.04":
        print(json.dumps({"status": "NOT RUN", "reason": "Requires Ubuntu 24.04"}))
        return 2
    node = shutil.which("node")
    if node is None or subprocess.check_output([node, "--version"], text=True).strip() != "v22.23.4":
        print(json.dumps({"status": "NOT RUN", "reason": "Requires exact Node 22.23.4"}))
        return 2
    try:
        environment = test_environment(os.environ, args.application_user)
    except (KeyError, ValueError):
        print(json.dumps({"status": "NOT RUN", "reason": "A real non-root fixture application account is required"}))
        return 2
    repo = Path(__file__).resolve().parents[2]
    # Preserved suites intentionally import their adjacent test support module;
    # -I would remove that directory and turn a packaging difference into a fail.
    commands = [[sys.executable, "-B", str(repo / "scripts" / name)] for name in (
        "test-maintenance-contract.py", "test-start-prebuilt.py", "test-deploy-recovery-health.py",
        "test-prebuilt-artifact.py", "test-prebuilt-linux.py")]
    for command in commands:
        print(json.dumps({"started_at": dt.datetime.now(dt.timezone.utc).isoformat(), "test": Path(command[-1]).name}), flush=True)
        result = subprocess.run(command, cwd=repo, env=environment, check=False)
        print(json.dumps({"finished_at": dt.datetime.now(dt.timezone.utc).isoformat(), "test": Path(command[-1]).name,
                          "exit_code": result.returncode}), flush=True)
        if result.returncode:
            return result.returncode
    print(json.dumps({"status": "PASS", "scope": "Fictional Linux root/deployment safety; no real-data restore or production installation"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
