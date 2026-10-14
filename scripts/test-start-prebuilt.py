#!/usr/bin/env python3
"""Execute the startup entry point in isolated fixtures; never install a service.

Only fixed deployment paths, Node path/port, account name and (on macOS) trusted
UID constants are adapted in a COPY. No startup function or exec is replaced.
Linux callers retain real root ownership and run the copy as a real app user.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
from prebuilt_test_support import resolve_runuser

REPO = Path(__file__).resolve().parents[1]


def adapt_wrapper(destination, current, releases, shared, node, user, port=3001):
    source = (REPO / "ops/deploy/start-prebuilt").read_text()
    replacements = {"CURRENT": str(current), "RELEASES": str(releases), "SHARED": str(shared),
                    "NODE": str(node), "APP_USER": user, "PORT": str(port)}
    if "CURRENT = " in source:
        for key, value in replacements.items():
            source, count = re.subn(r"^" + key + r" = .+$", key + " = " + repr(value), source, flags=re.M)
            assert count == 1, key
        if sys.platform != "linux":
            source, count = re.subn(r"^TRUSTED_UIDS = .+$", "TRUSTED_UIDS = {0, " + str(os.getuid()) + "}", source, flags=re.M)
            assert count == 1
    else:
        # Original minimal wrapper, retained for the before-fix regression.
        source = source.replace("/srv/nuaafa/current", str(current)).replace("/usr/bin/node", str(node)).replace('"3001"', repr(str(port)))
    destination.write_text(source)
    destination.chmod(0o755)
    return dict(source_sha256=hashlib.sha256((REPO / "ops/deploy/start-prebuilt").read_bytes()).hexdigest(),
                adapted_sha256=hashlib.sha256(destination.read_bytes()).hexdigest(), constants=replacements,
                platform=sys.platform, uid=os.getuid(), production_paths=False, systemd="NOT RUN")


class StartupTests(unittest.TestCase):
    def setUp(self):
        self.runuser = resolve_runuser() if os.getuid() == 0 else None
        parent = os.environ.get("NUAAFA_TEST_ROOT", str(REPO.parent))
        self.temp = tempfile.TemporaryDirectory(prefix="nuaafa-start-test-", dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.root.chmod(0o755)
        self.user = os.environ.get("NUAAFA_TEST_APP_USER", pwd.getpwuid(os.getuid()).pw_name)
        self.account = pwd.getpwnam(self.user)
        self.release = self.root / "releases" / ("a" * 40)
        (self.release / "node_modules/next/dist/bin").mkdir(parents=True)
        (self.release / "node_modules/next/dist/bin/next").write_text("synthetic entry only")
        (self.release / "node_modules/next/package.json").write_text('{"version":"16.3.8"}')
        (self.release / ".next").mkdir()
        (self.release / ".next/BUILD_ID").write_text("synthetic")
        (self.release / "prisma").mkdir()
        self.shared = self.root / "shared"
        (self.shared / "prisma").mkdir(parents=True)
        (self.shared / ".env.production").write_text("SYNTHETIC=1\n")
        (self.shared / ".env.production").chmod(0o640)
        (self.shared / "prisma/dev.db").write_text("synthetic metadata only")
        if os.getuid() == 0: os.chown(self.shared / ".env.production", 0, self.account.pw_gid)
        for name in (".env.production", "prisma/dev.db"):
            (self.release / name).symlink_to(self.shared / name)
        self.current = self.root / "current"
        self.current.symlink_to(self.release)
        self.node = self.root / "node"
        self.version = self.root / "node-version"
        self.version.write_text("v22.23.2")
        # Synthetic executable only records wrapper exec/cwd/env/uid. The separate
        # --runtime suite executes actual Next, native modules and HTTP.
        self.node.write_text('#!' + sys.executable + '\nimport os,sys,json\nfrom pathlib import Path\n'
                             'if sys.argv[1:] == ["--version"]: print(Path(' + repr(str(self.version)) + ').read_text())\n'
                             'else: print(json.dumps(dict(cwd=os.getcwd(),uid=os.getuid(),argv=sys.argv[1:],env=dict(os.environ))))\n')
        self.node.chmod(0o755)
        self.wrapper = self.root / "start-prebuilt"
        self.adapt()
        # Every fixture parent is canonical, readable, non-writable by the app.
        for base, dirs, files in os.walk(self.root):
            Path(base).chmod(0o755)

    def adapt(self, user=None):
        return adapt_wrapper(self.wrapper, self.current, self.release.parent, self.shared, self.node, user or self.user)

    def tearDown(self): self.temp.cleanup()

    def launch(self, *arguments):
        command = [sys.executable, "-I", str(self.wrapper), *arguments]
        if os.getuid() == 0: command = [self.runuser, "-u", self.user, "--", *command]
        return subprocess.run(command, cwd="/", env={"PATH": "/usr/bin:/bin", "NODE_OPTIONS": "--require=/must-not-load", "DATABASE_URL": "file:/must-not-open", "PYTHONPATH": "/must-not-import", "NODE_ENV": "development"}, capture_output=True, text=True, timeout=20)

    def test_check_release_is_read_only_and_does_not_execute_entry(self):
        before = (os.readlink(self.current), (self.shared / "prisma/dev.db").read_bytes(),
                  (self.shared / ".env.production").read_bytes())
        result = self.launch("--check-release", str(self.release))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")  # Synthetic Next entry would print exec metadata.
        self.assertEqual(before, (os.readlink(self.current), (self.shared / "prisma/dev.db").read_bytes(),
                                  (self.shared / ".env.production").read_bytes()))

    def test_check_release_uses_same_version_and_metadata_guards(self):
        self.version.write_text("v22.23.3")
        result = self.launch("--check-release", str(self.release))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("startup Node version differs", result.stderr)
        self.assertEqual(result.stdout, "")

    @unittest.skipUnless(sys.platform == "linux" and os.getuid() == 0, "real Linux root/app UID required")
    def test_check_release_rejects_application_owned_legacy(self):
        os.chown(self.release, self.account.pw_uid, self.account.pw_gid)
        result = self.launch("--check-release", str(self.release))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("startup metadata is not root controlled", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_clean_exec_environment_cwd_and_identity(self):
        result = self.launch()
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["cwd"], str(self.release))
        self.assertEqual(value["uid"], self.account.pw_uid)
        value["argv"][0] = str(Path(value["argv"][0]).resolve())
        self.assertEqual(value["argv"], [str(self.release / "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3001"])
        # Darwin/Python may add locale/CF metadata after exec. Neither carries
        # an application setting; all poison application inputs must be absent.
        environment = {k: v for k, v in value["env"].items() if k not in {"LC_CTYPE", "__CF_USER_TEXT_ENCODING"}}
        self.assertEqual(environment, {"PATH": "/usr/bin:/bin", "NODE_ENV": "production", "NEXT_TELEMETRY_DISABLED": "1"})

    def test_extra_environment_file_refused_before_exec(self):
        (self.release / ".env.production.local").write_text("SYNTHETIC=bad\n")
        result = self.launch()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("STOP", result.stderr)

    def test_wrong_node_version_refused_before_start(self):
        self.version.write_text("v24.0.0")
        self.assertNotEqual(self.launch().returncode, 0)

    def test_wrong_application_identity_refused(self):
        self.adapt(user="root")
        self.assertNotEqual(self.launch().returncode, 0)

    def test_shared_configuration_target_and_mode_refused(self):
        (self.shared / ".env.production").chmod(0o666)
        self.assertNotEqual(self.launch().returncode, 0)
        (self.shared / ".env.production").chmod(0o640)
        (self.release / ".env.production").unlink()
        (self.release / ".env.production").symlink_to(self.shared / "prisma/dev.db")
        self.assertNotEqual(self.launch().returncode, 0)


class CommandResolutionTests(unittest.TestCase):
    def test_root_launch_uses_absolute_command_and_poisoned_minimal_environment(self):
        fixture = StartupTests("test_clean_exec_environment_cwd_and_identity")
        fixture.runuser = "/usr/sbin/runuser"
        fixture.user = "synthetic-app"
        fixture.wrapper = Path("/synthetic/start-prebuilt")
        with patch.object(os, "getuid", return_value=0), patch.object(subprocess, "run") as launch:
            fixture.launch()
        args, kwargs = launch.call_args
        self.assertEqual(args[0][:4], ["/usr/sbin/runuser", "-u", "synthetic-app", "--"])
        self.assertEqual(kwargs["env"], {"PATH": "/usr/bin:/bin", "NODE_OPTIONS": "--require=/must-not-load",
            "DATABASE_URL": "file:/must-not-open", "PYTHONPATH": "/must-not-import", "NODE_ENV": "development"})

    def test_absolute_runuser_survives_minimal_path(self):
        # Metadata mocks prove resolution logic only; Linux startup uses real stat.
        with patch("prebuilt_test_support.shutil.which", return_value="/usr/sbin/runuser") as lookup, \
             patch("prebuilt_test_support.trusted_path", return_value=Path("/usr/sbin/runuser")) as check, \
             patch.object(Path, "stat", return_value=type("Info", (), {"st_mode": 0o100755})()), \
             patch("prebuilt_test_support.os.access", return_value=True), \
             patch.dict(os.environ, PATH="/usr/bin:/bin"):
            self.assertEqual(resolve_runuser(), "/usr/sbin/runuser")
        lookup.assert_called_once_with("runuser", path="/usr/sbin:/usr/bin")
        check.assert_called_once_with("/usr/sbin/runuser", kind="file")

    def test_missing_unsafe_and_nonexecutable_runuser_are_rejected(self):
        with patch("prebuilt_test_support.shutil.which", return_value=None), \
             self.assertRaisesRegex(FileNotFoundError, "runuser.*missing"):
            resolve_runuser()
        for reason in ("owner is not root", "group/world writable", "symlink", "wrong file type"):
            with self.subTest(reason=reason), \
                 patch("prebuilt_test_support.shutil.which", return_value="/usr/sbin/runuser"), \
                 patch("prebuilt_test_support.trusted_path", side_effect=ValueError(reason)), \
                 self.assertRaisesRegex(ValueError, reason):
                resolve_runuser()
        with patch("prebuilt_test_support.shutil.which", return_value="/usr/sbin/runuser"), \
             patch("prebuilt_test_support.trusted_path", return_value=Path("/usr/sbin/runuser")), \
             patch.object(Path, "stat", return_value=type("Info", (), {"st_mode": 0o100644})()), \
             self.assertRaisesRegex(ValueError, "not executable"):
            resolve_runuser()


if __name__ == "__main__":
    unittest.main(verbosity=2)
