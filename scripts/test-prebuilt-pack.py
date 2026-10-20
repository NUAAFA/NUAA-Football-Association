#!/usr/bin/env python3
"""Adversarial pack tests in owned synthetic trees; Linux contract is mocked here."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("pack_fixtures", REPO / "scripts/test-prebuilt-artifact.py")
F = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(F)
A = F.A
ALIAS = ".next/node_modules/@libsql/client-0123456789abcdef"
PACKAGE = "node_modules/@libsql/client"


class SafePackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        F.ArtifactTests.setUpClass()

    @classmethod
    def tearDownClass(cls):
        F.ArtifactTests.tearDownClass()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="nuaafa-safe-pack-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / "source"
        shutil.copytree(F.ArtifactTests.source, self.source, symlinks=True)
        self.package = self.source / PACKAGE
        self.package.mkdir(parents=True)
        (self.package / "package.json").write_bytes(A.json_bytes({"version": "0.17.4", "main": "index.cjs"}))
        (self.package / "index.cjs").write_text("module.exports={marker:'materialized-runtime'};\n")
        (self.package / "lib").mkdir()
        (self.package / "lib/data.txt").write_bytes(b"synthetic Next runtime dependency\n")
        lock = A.load_json((self.source / "package-lock.json").read_bytes())
        lock["packages"][PACKAGE] = {"version": "0.17.4", "integrity": "synthetic-locked"}
        (self.source / "package-lock.json").write_bytes(A.json_bytes(lock))
        (self.source / "node_modules/.package-lock.json").write_bytes(A.json_bytes(lock))
        F.run("git", "-C", str(self.source), "add", "package-lock.json")
        F.run("git", "-C", str(self.source), "commit", "-m", "synthetic locked Next alias")
        self.commit = F.run("git", "-C", str(self.source), "rev-parse", "HEAD")
        self.alias = self.source / ALIAS
        self.alias.parent.mkdir(parents=True)
        self.alias.symlink_to(A.BuildInventory.RAW_TARGET)
        self.output = self.root / "artifact.tar.gz"
        self.sidecar = self.output.with_suffix(".gz.sha256")

    def pack(self):
        with patch.object(A, "platform_info", return_value=F.PLATFORM), contextlib.redirect_stdout(io.StringIO()):
            A.pack(self.source, self.output, self.commit)
        return A.read_archive(self.output, A.file_digest(self.output), self.commit)

    def reject(self):
        with self.assertRaises((ValueError, OSError, RecursionError)):
            self.pack()
        self.assertFalse(os.path.lexists(self.output))
        self.assertFalse(os.path.lexists(self.sidecar))
        self.assertTrue(self.alias.is_symlink())
        self.assertEqual(F.run("git", "-C", str(self.source), "status", "--porcelain"), "")

    def change_target(self, target):
        self.alias.unlink()
        self.alias.symlink_to(target)

    def test_materialized_files_sha_manifest_extract_and_next_resolution(self):
        manifest = self.pack()
        self.assertTrue(self.alias.is_symlink())
        self.assertNotIn(ALIAS, manifest["files"])
        for name in ("package.json", "index.cjs", "lib/data.txt"):
            entry = manifest["files"][ALIAS + "/" + name]
            self.assertEqual(entry["type"], "file")
            self.assertEqual(entry["sha256"], A.file_digest(self.package / name))
            self.assertEqual(entry, manifest["files"][PACKAGE + "/" + name])
        with tarfile.open(self.output) as tar:
            self.assertTrue(all(m.isfile() or m.issym() for m in tar))
            self.assertTrue(all(m.isfile() for m in tar if m.name.startswith(ALIAS + "/")))
        extracted = self.root / "extracted"
        extracted.mkdir()
        A.read_archive(self.output, A.file_digest(self.output), self.commit, extracted)
        self.assertTrue((extracted / ALIAS).is_dir())
        self.assertFalse((extracted / ALIAS).is_symlink())
        # Exercise Node's actual lookup from a Next server chunk, not a mocked resolver.
        probe = "const {createRequire}=require('node:module'); const r=createRequire(process.argv[1]+'/.next/server/chunks/probe.cjs'); if(r('@libsql/client-0123456789abcdef').marker!=='materialized-runtime') process.exit(2)"
        subprocess.run(["node", "-e", probe, str(extracted)], check=True)
        self.assertEqual(self.sidecar.read_text().split()[0], A.file_digest(self.output))
        A.validate_manifest(manifest, self.commit)

    def test_external_directory_and_relative_escape_rejected_without_read(self):
        outside = self.root / "outside"
        outside.mkdir()
        canary = outside / "canary"
        canary.write_text("must never open")
        for target in ("../../../../outside", "../../../node_modules/@libsql/client/../../../../outside"):
            with self.subTest(target=target):
                self.change_target(target)
                with patch.object(A, "open_regular", wraps=A.open_regular) as opened:
                    self.reject()
                self.assertFalse(any(str(canary) == str(c.args[0]) for c in opened.call_args_list))

    def test_absolute_target_rejected_even_inside_checkout(self):
        self.change_target(str(self.package))
        self.reject()

    def test_cycle_and_dangling_target_rejected(self):
        for target in ("client-0123456789abcdef", "missing", "../../../node_modules/@libsql/missing"):
            with self.subTest(target=target):
                self.change_target(target)
                self.reject()
        self.change_target(A.BuildInventory.RAW_TARGET)
        shutil.rmtree(self.package)
        self.reject()

    def test_target_parent_link_rejected(self):
        moved = self.root / "moved-scope"
        scope = self.source / "node_modules/@libsql"
        scope.rename(moved)
        scope.symlink_to(moved)
        self.reject()

    def test_unapproved_directory_and_file_alias_rejected(self):
        for path, target in ((".next/arbitrary", "../node_modules/@libsql/client"),
                             (".next/node_modules/@libsql/client-other", A.BuildInventory.RAW_TARGET),
                             (".next/unapproved-file", "../node_modules/@libsql/client/index.cjs")):
            with self.subTest(path=path):
                extra = self.source / path
                extra.symlink_to(target)
                self.reject()
                extra.unlink()

    def test_nested_directory_file_cycle_and_dangling_links_rejected(self):
        extra = self.package / "nested"
        for target in ("lib", "index.cjs", "nested", "absent", "../../../../outside"):
            with self.subTest(target=target):
                extra.symlink_to(target)
                self.reject()
                extra.unlink()

    def test_sensitive_paths_and_sensitive_links_rejected_without_read(self):
        for name in (".env.production", "dev.db", "secret.pem", "id_ed25519"):
            with self.subTest(name=name):
                item = self.package / name
                item.write_text("synthetic secret canary")
                with patch.object(A, "open_regular", wraps=A.open_regular) as opened:
                    self.reject()
                self.assertFalse(any(str(item) == str(c.args[0]) for c in opened.call_args_list))
                item.unlink()
        (self.package / "secret-link").symlink_to("../../../../.env.production")
        self.reject()

    def test_hardlink_fifo_and_socket_rejected(self):
        extra = self.package / "unsafe"
        os.link(self.package / "lib/data.txt", extra)
        self.reject()
        extra.unlink()
        os.mkfifo(extra)
        self.reject()
        extra.unlink()
        import socket
        sock = socket.socket(socket.AF_UNIX)
        previous = Path.cwd()
        try:
            # Relative bind avoids macOS's short Unix socket pathname limit.
            os.chdir(self.package)
            sock.bind(extra.name)
            os.chdir(previous)
            self.reject()
        finally:
            os.chdir(previous)
            sock.close()

    def test_alias_and_target_replacement_rejected(self):
        for replace in ("link", "directory", "file", "file-content", "file-to-sensitive-link"):
            with self.subTest(replace=replace):
                # Use a fresh independent fixture for every injected race.
                inventory = A.BuildInventory(self.source, A.build_json(self.source / "package-lock.json"))
                inventory.collect(A.source_paths(self.source))
                saved = self.root / ("saved-" + replace)
                item = self.alias if replace == "link" else self.package if replace == "directory" else self.package / "index.cjs"
                item.rename(saved)
                if replace == "link": item.symlink_to(A.BuildInventory.RAW_TARGET)
                elif replace == "directory": shutil.copytree(saved, item)
                elif replace == "file-to-sensitive-link": item.symlink_to(self.root / ".env.production")
                else: item.write_bytes(saved.read_bytes() if replace == "file" else b"changed")
                with self.assertRaises((ValueError, OSError)):
                    with tarfile.open(self.root / (replace + ".tar"), "w") as tar:
                        inventory.write(tar)
                if item.is_dir() and not item.is_symlink(): shutil.rmtree(item)
                else: item.unlink()
                saved.rename(item)

    def test_count_single_file_total_size_and_ustar_limits(self):
        baseline = self.pack()
        self.output.unlink(); self.sidecar.unlink()
        for key, value in (("MAX_FILES", len(baseline["files"]) - 1), ("MAX_FILE", 1),
                           ("MAX_BYTES", sum(e.get("size", 0) for e in baseline["files"].values()) - 1)):
            with self.subTest(limit=key), patch.object(A, key, value): self.reject()
        (self.package / ("x" * 101)).write_text("USTAR cannot encode this basename")
        self.reject()

    def test_output_and_sidecar_conflicts_preserve_unknown_files(self):
        for path in (self.output, self.sidecar):
            with self.subTest(path=path):
                path.write_text("unknown retained output")
                with self.assertRaises(ValueError): self.pack()
                self.assertEqual(path.read_text(), "unknown retained output")
                path.unlink()
        self.output.symlink_to(self.root / "missing")
        with self.assertRaises(ValueError): self.pack()
        self.assertTrue(self.output.is_symlink())

    def test_midstream_failure_interrupt_and_replaced_output_cleanup(self):
        original = tarfile.TarFile.addfile
        def fail(tar, info, source=None):
            if info.name.startswith(ALIAS + "/"): raise ValueError("injected materialization failure")
            return original(tar, info, source)
        with patch.object(tarfile.TarFile, "addfile", fail): self.reject()
        with patch.object(A.BuildInventory, "write", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt): self.pack()
        self.assertFalse(self.output.exists())
        def replace_output(_inventory, _tar):
            self.output.rename(self.root / "owned-output")
            self.output.write_text("unknown replacement")
            raise ValueError("injected replacement")
        with patch.object(A.BuildInventory, "write", replace_output):
            with self.assertRaises(ValueError): self.pack()
        self.assertEqual(self.output.read_text(), "unknown replacement")

    def test_manifest_hash_and_content_tampering_still_fail(self):
        manifest = self.pack()
        entry = manifest["files"][ALIAS + "/index.cjs"]
        altered = self.root / "altered.tar.gz"
        with tarfile.open(self.output) as src, tarfile.open(altered, "w:gz", format=tarfile.USTAR_FORMAT) as dst:
            for member in src:
                raw = src.extractfile(member).read() if member.isfile() else None
                if member.name == ALIAS + "/index.cjs": raw = b"!" * entry["size"]
                dst.addfile(member, io.BytesIO(raw) if raw is not None else None)
        with self.assertRaisesRegex(ValueError, "member digest mismatch"):
            A.read_archive(altered, A.file_digest(altered), self.commit)

    def esbuild_pair(self):
        platform = A.BuildInventory.ESBUILD_PLATFORMS[(sys.platform, os.uname().machine)]
        package = "node_modules/@esbuild/" + platform
        lock = A.build_json(self.source / "package-lock.json")
        for name in ("node_modules/esbuild", package):
            lock["packages"][name] = {"version": "0.25.0", "integrity": "synthetic-esbuild"}
            path = self.source / name / "package.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(A.json_bytes({"version": "0.25.0"}))
        (self.source / "package-lock.json").write_bytes(A.json_bytes(lock))
        (self.source / "node_modules/.package-lock.json").write_bytes(A.json_bytes(lock))
        F.run("git", "-C", str(self.source), "add", "package-lock.json")
        F.run("git", "-C", str(self.source), "commit", "-m", "synthetic locked esbuild")
        self.commit = F.run("git", "-C", str(self.source), "rev-parse", "HEAD")
        binary = self.source / package / "bin/esbuild"
        launcher = self.source / "node_modules/esbuild/bin/esbuild"
        binary.parent.mkdir(); launcher.parent.mkdir()
        binary.write_bytes(b"\x7fELFsynthetic-esbuild")
        binary.chmod(0o755)
        os.link(binary, launcher)
        return binary, launcher

    def test_verified_esbuild_pair_materializes_as_two_regular_files(self):
        pair = self.esbuild_pair()
        manifest = self.pack()
        with tarfile.open(self.output) as tar:
            for path in pair:
                name = path.relative_to(self.source).as_posix()
                self.assertTrue(tar.getmember(name).isfile())
                self.assertEqual(manifest["files"][name]["sha256"], A.file_digest(path))
        extracted = self.root / "esbuild-extracted"
        extracted.mkdir()
        A.read_archive(self.output, A.file_digest(self.output), self.commit, extracted)
        for path in pair:
            self.assertEqual((extracted / path.relative_to(self.source)).stat().st_nlink, 1)
        self.assertNotEqual((extracted / pair[0].relative_to(self.source)).stat().st_ino,
                            (extracted / pair[1].relative_to(self.source)).stat().st_ino)

    def test_esbuild_external_extra_mismatched_and_replaced_hardlinks_rejected(self):
        binary, launcher = self.esbuild_pair()
        external = self.root / "external-sensitive-canary"
        os.link(binary, external)
        self.reject()  # Third inode name is never accepted, even outside checkout.
        external.unlink()
        launcher.unlink(); launcher.write_bytes(binary.read_bytes())
        os.link(launcher, external)
        self.reject()  # nlink=2 is insufficient without the exact matching pair.
        external.unlink(); launcher.unlink(); os.link(binary, launcher)
        inventory = A.BuildInventory(self.source, A.build_json(self.source / "package-lock.json"))
        inventory.collect(A.source_paths(self.source))
        binary.write_bytes(b"changed between inventory and tar")
        with self.assertRaises(ValueError):
            with tarfile.open(self.root / "changed-pair.tar", "w") as tar: inventory.write(tar)


if __name__ == "__main__":
    unittest.main(verbosity=2)
