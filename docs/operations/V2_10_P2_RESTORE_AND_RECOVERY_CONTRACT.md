# V2.10 P2 restore and prebuilt recovery contract

This document covers the two targeted recovery fixes. It does not authorize a
production deployment, database restoration or a legacy-format conversion.

## Isolated combined restore

The TypeScript entry verifies the existing completion marker, manifest, SHA-256,
whole SQLite integrity, foreign keys and protected row counts. The Python
stdlib helper at `src/lib/restore-target.py` then copies and re-hashes that exact
snapshot and the full expected upload file set. Successful data bytes are
unchanged. New staged files are private (0600), directories 0700.

Use normalized absolute canonical paths. The allowed root and target parents
must belong to the invoking UID and must not be writable by group/others.
Ancestors must belong to root or that UID; root-owned sticky temporary
directories are supported. Symlinked ancestors, source aliases/overlap and
existing targets are rejected. Use a separate fresh restore destination; do not
target the running production DB or uploads.

Before any mkdir, lock, staging or capability probe, the helper pins the nearest
existing ancestors of all destinations and compares their dev/inode ancestry
with the source. An existing allowed root that contains the source is also
rejected. This recognizes actual directory aliases (including case-insensitive
names), rather than assuming different path strings represent different trees.
Missing suffixes remain a new branch below the pinned existing ancestor;
creation rechecks namespace identity and never creates descendants inside source.

The helper opens each directory component with O_DIRECTORY and O_NOFOLLOW and
retains those descriptors. Copying, creation and final publication are relative
to them, so replacing a path with a symlink cannot redirect a write. Namespace
identity checks reject an ancestor replacement seen during staging/publication.
The pinned allowed-root inode is the boundary throughout the operation. Root
and the invoking UID remain trusted principals, consistent with the other
operational tools; filesystem guards cannot stop them directly modifying their
own DB, backup or namespace. Unsafe ancestor permissions are rejected before
creating descendant restore directories.

Node's filesystem API does not expose descriptor-relative no-replace directory
rename. The helper uses Linux `renameat2(RENAME_NOREPLACE)` or Darwin
`renameatx_np(RENAME_EXCL)`, via stdlib ctypes, with no ordinary-rename fallback.
It proves the actual destination filesystem rejects preexisting files AND empty
directories before publishing user data. An unsupported OS/API/filesystem
fails closed. Linux and Darwin require `/usr/bin/python3`; other platforms
are not accepted by this restore implementation.

A persistent 0600 no-follow operation lock serializes cooperating restores in
one allowed root. OS no-replace still protects each target independently if it
appears after staging. The helper is a required source member of the sealed
artifact; an archive without it is rejected.

Two different destination entries cannot be published as one filesystem
transaction. If DB publication succeeds and uploads publication fails, the
restore returns an error and retains that DB and private staging. It never
unlinks the DB using a stale lstat result. Similarly, aborted/failed/successful
operations retain a private `.restore-UUID` directory containing operation
metadata and capability probes; failed operations may also contain staged data.
The exception identifies the operation directory and any published entries.
A complete return is emitted only after both publications and final identities
and hashes have passed. Callers must not promote a partial/error result.

Keep retained evidence until the operator has inspected it and separately
approved disposal. Retry into a new canonical private destination. No recursive
automatic cleanup or target deletion is performed by the restore engine, so it
cannot delete another process's later occupant. This policy deliberately favors
data preservation over removing interrupted staging.

The onPhase hooks remain test-only observation points. AbortSignal cancellation
terminates only the helper owned by that invocation; it never restores/deletes a
destination or terminates unrelated processes.

## Prebuilt previous-release acceptance

Before backup, service stop, migration or current switch, prebuilt activation:

1. Verifies the effective root-controlled systemd/wrapper contract.
2. Requires the previous release's own sealed receipt and exact source/digest/ref.
3. Executes `start-prebuilt --check-release <previous>` as the actual app UID,
   with an empty inherited environment.
4. Uses the same root-only path/build/shared-file/Next/Node checks as normal
   startup; check mode never executes Next, loads configuration or switches
   current.

New candidate pack/import/verification still requires restore-target.py. The
root-controlled deployer selects historical recovery verification only for the
previous release with its own authenticated sealed receipt. No manifest version
or caller-supplied release label selects this mode. Historical recovery retains
the exact commit-derived source inventory and source blob hashes: a newer commit
that tracks the helper cannot omit it even in this mode. Old sealed releases
whose commits predate the helper need no injected future file or changed receipt.

An application-owned legacy release cannot enter this prebuilt recovery path.
No automatic format/ownership conversion is performed. The separate legacy full
deployment mode retains its existing service contract; it is not a bypass for
prebuilt activation. A deployment requiring legacy transition needs a separately
reviewed plan.

On recoverable activation failure, the old sealed release is reverified,
including the startup contract, before switching/restarting. ROLLED_BACK is
persisted only after service active state, database-backed exact health JSON and
actual MainPID/cwd checks succeed. Uncertain MIGRATING states stay stopped and
MANUAL_REQUIRED. If writing the ROLLED_BACK journal fails, recovery also falls
through to stop/manual protection instead of reporting a completed rollback.

## Regression and evidence boundary

Targeted restore tests: `node --import tsx scripts/test-restore-target-safety.ts`.
They use synthetic SQLite data and uploads, including unchanged SHA assertions,
late targets, empty directories, symlink/ancestor replacement, interruption,
partial publication, concurrent restores and unsafe ancestor permissions.

Startup tests: `python3 scripts/test-start-prebuilt.py`. Native root/app UID
rejection tests run only under real Linux root with the isolated test app user.
State-machine/receipt tests: `python3 scripts/test-prebuilt-artifact.py`.
Health-decision tests: `python3 scripts/test-deploy-recovery-health.py`; their
systemctl/proc inputs are simulated and are not real systemd acceptance.

The existing CI gates remain enabled, with the new restore and health tests
added. Actual Linux root/app permission tests and authenticated Linux archive
runtime remain separate from macOS checks. A successful simulation must never
be recorded as native systemd PASS.
