# OPS-R3.1.3 local release preflight

Date: 2026-10-01 (Europe/London). Starting branch: `codex/ops-r3-1-1`; starting HEAD: `86658c6838dfe93b93147bb0ce34e00acf5ca228`. Inherited R3.1.2/R3.1.3 dirty source was preserved.

All 69 entries in the implementation report source fingerprint matched the inherited workspace before final packaging. Packaging removed only an extra EOF blank line in `referee-api-input-error.ts`; no business code changed. Existing evidence-preservation Git attributes were extended to the R3.1.2/R3.1.3 evidence directories so raw CLI output and patch context lines remain intact. Package-lock v3 fixes Next 16.3.8, Prisma 7.9.1 and saxen 11.1.1. No dependency upgrades or old migration edits.

`node scripts/verify-ops-r3-1-3.mjs` completed with exit 0: 15 commands, including build/lint/unicode/typecheck/diff, R3.1.3 migration/service/isolated HTTP, R3.1/R3.1.1, the 28-command regression batch, runtime/HTTP security and content/media HTTP. All 28 child regressions exit 0. The linked machine records in `../evidence/final-verification-results.json` and `../evidence/regressions/results.json` were regenerated during this release turn.

`python3 scripts/test-ops-r3-1-2-migration.py`: exit 0, legacy schedule/scores/result versions/tasks/memberships, triggers and FK checks preserved. `npm run test:production-hardening`: exit 0 (isolated synthetic backup/restore matrix; not a production backup). Local runtime: Node v24.21.0, npm 11.19.0.

Final browser smoke used the existing isolated 3195 server; its product source hashes exactly match the workspace. Visually inspected teams and standings, and opened all four tabs. Teams: 13 total, 12 grouped, 1 ungrouped, 2 groups. Removal inspect: SQA project team has 5 matches, 0 safe/1 blocked and disabled confirmation; ungrouped fixture team has 1 safe/0 blocked and an exact final list. Both dialogs canceled without deleting fixture records. Matches: 30 in ascending 1..30 order, 29 pending/1 scheduled/0 ended; unknown time and venue render as pending. Standings: unstarted, zero statistics, no permanent reason/input clutter. DOCX input available; manual matching and 28/30 partial-import evidence reused from the unchanged-source implementation browser run, with service/DOCX/HTTP tests freshly rerun. No production browser actions or writes have occurred at this point.

Additional Linux deployer matrix: NOT VERIFIED on macOS. Initial exit 1 from Darwin mktemp returning /var paths that resolve under /private; a temporary canonical-root mktemp wrapper advanced the test but Darwin mv lacks GNU -T, producing exit 1. Repository/deployer source and assertions were not modified. This platform limitation must not be recorded as a PASS; Linux server verification remains pending. The historical `rc:check` is a full isolated RC runner with Node 22.23.2 and a frozen advisory inventory, not a read-only live production preflight.

Credential hygiene: the untracked historical legacy fixture preparation log contained a synthetic password; its password field was redacted before staging. No database, env, key, production backup or upload root will be committed.

Production backup, production-copy rehearsal, migration, build, restart, authenticated smoke and deployed SHA remain pending until verified via WireGuard SSH.
