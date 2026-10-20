#!/usr/bin/env python3
"""Normal-workload checks that optional diagnostics preserve verifier results."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "ops/deploy/prebuilt-artifact.py"
spec = importlib.util.spec_from_file_location("timing_artifact", HELPER)
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)


def events(stderr):
    return [json.loads(line.split(" ", 1)[1]) for line in stderr.splitlines()
            if line.startswith("NUAAFA_PREBUILT_TIMING ")]


class TimingCompatibility(unittest.TestCase):
    def test_source_batch_checks_exact_git_blobs_and_rejects_wrong_digest(self):
        commit = A.git(ROOT, "rev-parse", "HEAD").decode().strip()
        names = ["package.json", "prisma/schema.prisma", "src/lib/prisma.ts"]
        files = {}
        for name in names:
            data = A.git(ROOT, "show", commit + ":" + name)
            files[name] = dict(type="file", size=len(data), sha256=hashlib.sha256(data).hexdigest())
        manifest = dict(sources=names, files=files)
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr), A.timing_session():
            A.verify_source_blobs(ROOT, manifest, commit)
        queries = next(row for row in events(stderr.getvalue()) if row["phase"] == "git_source_checks")
        self.assertEqual(queries["calls"], 2)
        files[names[-1]]["size"] += 1
        with self.assertRaisesRegex(ValueError, "trusted source blob type or size mismatch"):
            A.verify_source_blobs(ROOT, manifest, commit)
        files[names[-1]]["size"] -= 1
        files[names[-1]]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "source differs from trusted commit"):
            A.verify_source_blobs(ROOT, manifest, commit)

    def test_digest_is_identical_and_aggregated_without_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ordinary-file.txt"
            data = b"Normal archive compatibility fixture\n"
            path.write_bytes(data)
            baseline = A.file_digest(path)
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr), A.timing_session():
                self.assertEqual(A.file_digest(path), baseline)
                self.assertEqual(A.file_digest(path), hashlib.sha256(data).hexdigest())
            rows = events(stderr.getvalue())
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["calls"], 2)
            self.assertEqual(rows[0]["failed_calls"], 0)
            self.assertGreaterEqual(rows[0]["elapsed_seconds"], 0)
            self.assertNotIn(str(path), stderr.getvalue())
            self.assertFalse(A.TIMING_ENABLED)

    def test_original_exception_survives_and_session_restores_state(self):
        original = ValueError("ordinary rejected fixture")
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            with self.assertRaises(ValueError) as caught, A.timing_session():
                with A.measured_phase("validation"):
                    raise original
        self.assertIs(caught.exception, original)
        self.assertFalse(A.TIMING_ENABLED)
        rows = events(stderr.getvalue())
        self.assertEqual([row["event"] for row in rows], ["start", "end"])
        self.assertEqual(rows[-1]["status"], "FAIL")

    def test_cli_checksum_failure_keeps_status_stdout_and_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = root / "ordinary-input.tar.gz"
            source.write_bytes(b"ordinary fixture bytes")
            results = []
            for diagnostics in (False, True):
                output = root / ("timed-copy" if diagnostics else "plain-copy")
                args = [sys.executable, "-I", str(HELPER)]
                if diagnostics:
                    args.append("--timings")
                args += ["snapshot", "--archive", str(source), "--destination", str(output), "--sha256", "0" * 64]
                result = subprocess.run(args, text=True, capture_output=True, timeout=10)
                results.append(result)
                self.assertFalse(output.exists())
            self.assertEqual([result.returncode for result in results], [1, 1])
            self.assertEqual(results[0].stdout, results[1].stdout)
            self.assertIn("independent SHA-256 mismatch", results[1].stderr)
            self.assertEqual(events(results[1].stderr)[-1]["status"], "FAIL")

    def test_bash_timings_preserve_success_and_failure_status(self):
        for status in (0, 7):
            results = []
            for enabled in ("false", "true"):
                script = 'source "$1"; prebuilt_timing="$2"; ordinary() { echo normal-output; return "$3"; }; status=0; prebuilt_phase ordinary ordinary "$@" || status=$?; exit "$status"'
                result = subprocess.run(["bash", "-c", script, "test", str(ROOT / "ops/deploy/nuaafa-deploy"), enabled, str(status)],
                                        text=True, capture_output=True, timeout=10)
                results.append(result)
            self.assertEqual([r.returncode for r in results], [status, status])
            self.assertEqual(results[0].stdout, results[1].stdout)
            self.assertEqual(results[0].stderr, "")
            row = json.loads(results[1].stderr.split(" ", 1)[1])
            self.assertEqual(row["phase"], "ordinary")
            self.assertGreaterEqual(row["elapsed_seconds"], 0)


if __name__ == "__main__":
    unittest.main()
