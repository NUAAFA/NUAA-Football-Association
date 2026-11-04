#!/usr/bin/env python3
"""Hash-bound original deployed tools, tests use fictional temporary sources only."""
import hashlib
import json
from pathlib import Path
import unittest

root = Path(__file__).resolve().parents[1] / 'ops/monitoring/baseline'
provenance = json.loads((root / 'provenance.json').read_text())
for name, expected in provenance['sha256'].items():
    if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('BASELINE_SOURCE_HASH_MISMATCH')
suite = unittest.TestLoader().discover(str(root), pattern='test_*.py')
if suite.countTestCases() != 23:
    raise SystemExit('BASELINE_CASE_SET_MISMATCH')
result = unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
