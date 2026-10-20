#!/usr/bin/env python3
"""Exercise the REAL Bash health decision with simulated systemctl/proc inputs.

This verifies decision logic; it never installs/controls systemd and must not
be reported as native Linux service acceptance.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]


class RecoveryHealthTests(unittest.TestCase):
    def test_mainpid_cwd_database_health_and_active_state_required(self):
        with tempfile.TemporaryDirectory(prefix="nuaafa-recovery-health-") as directory:
            root = Path(directory).resolve()
            release = root / ("a" * 40)
            release.mkdir()
            current = root / "current"
            current.symlink_to(release)
            script = r"""
set -Eeuo pipefail
source "$DEPLOYER"
prebuilt_python="/usr/bin/python3"
current_link="$CURRENT"
systemctl() {
 case "$1" in
 is-active) [ "$ACTIVE" = yes ];;
 show) printf '%s\n' "$PID";;
 *) echo forbidden-service-mutation >&2; return 99;;
 esac
}
curl() { printf '%s' "$HEALTH"; }
sleep() { :; }
resolve_existing_path() {
 if [[ "$1" = /proc/*/cwd ]]; then printf '%s\n' "$PID_CWD";
 else "$prebuilt_python" -I -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$1"; fi
}
wait_for_health
"""
            for name, changes, accepted in (
                ("correct", {}, True),
                ("inactive", {"ACTIVE": "no"}, False),
                ("zero-pid", {"PID": "0"}, False),
                ("invalid-pid", {"PID": "123 injected"}, False),
                ("wrong-cwd", {"PID_CWD": str(root / "wrong")}, False),
                ("database-unhealthy", {"HEALTH": '{"status":"error"}'}, False),
                ("extra-health-fields", {"HEALTH": '{"status":"ok","unexpected":true}'}, False),
            ):
                with self.subTest(name=name):
                    env = dict(os.environ, DEPLOYER=str(REPO / "ops/deploy/nuaafa-deploy"),
                               CURRENT=str(current), ACTIVE="yes", PID="123",
                               PID_CWD=str(release), HEALTH='{"status":"ok"}', **{})
                    env.update(changes)
                    result = subprocess.run(["/bin/bash", "-c", script], env=env, capture_output=True, text=True, timeout=20)
                    self.assertEqual(result.returncode == 0, accepted, result.stdout + result.stderr)
                    self.assertEqual(os.readlink(current), str(release))
                    self.assertNotIn("forbidden-service-mutation", result.stderr)


if __name__ == "__main__":
    unittest.main()
