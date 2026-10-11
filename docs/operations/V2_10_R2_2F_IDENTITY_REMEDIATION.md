# Legacy student ID compatibility preflight

`getRefereeStudentIdCompatibility` now reports `activeNonNormalizedStudentId`: active, nonempty stored IDs that differ from the existing trim/NFKC/uppercase canonical form. These records contribute to `unsafeLoginMigrationBlockers`, alongside missing active IDs and normalized duplicate groups. The diagnostic contains counts only; categories can overlap, so the total is not a count of distinct accounts.

Canonical login and password verification are unchanged. Inactive noncanonical IDs alone do not add an active normalization blocker; normalized collisions involving inactive records still count under the existing duplicate policy. The scan performs no writes and returns no raw IDs or account records. Synthetic tests cover canonical input, whitespace, case, NFKC, collisions, missing active IDs, inactive identities and unchanged stored data.

Production prevalence remains **UNKNOWN**. No real accounts were inspected or changed during R2-2F.

If a separately authorized preflight returns any blockers, stop identity-migration approval. An authorized administrator must privately identify the affected accounts, verify each account holder's authoritative student ID, and check collisions across both active and inactive identities before proposing a correction. Missing values require verified identity evidence; no guessed IDs are permitted. Collisions require a separate human decision and must never trigger automatic identity merges.

Keep original records intact until the exact account-by-account correction is approved, backed up and audited. Execute only those approved corrections in a separately authorized phase, then rerun the compatibility scan and test each affected login/session boundary. A clean synthetic fixture is not evidence that production is clear.
