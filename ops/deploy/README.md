# NUAAFA V2.10 deployment source — current contract

Current source: `V2.10-PREBUILT-2`. The source has not been installed on production.
The [import/journal closure report](../../docs/operations/V2_10_IMPORT_JOURNAL_CLOSURE_REPORT.txt)
records this revision and supersedes changed-path conclusions in the preserved
comprehensive/prebuilt reports. Ubuntu execution and
real root/application-user tests remain **NOT RUN**. Unresolved High advisories
keep production **NO-GO**.

## Prebuilt modes

Future CLI contract only; these commands have not run on production:

```bash
nuaafa-deploy --import-artifact /absolute/candidate.tar.gz \
  --artifact-sha256 EXACT_64_HEX_FROM_AUTHENTICATED_RUN \
  --allowed-ref refs/heads/integration/v2.10-ui-release EXACT_40_HEX_COMMIT
nuaafa-deploy --activate-prebuilt \
  --artifact-sha256 EXACT_64_HEX_FROM_AUTHENTICATED_RUN \
  --allowed-ref refs/heads/integration/v2.10-ui-release EXACT_40_HEX_COMMIT
```

Import takes a root-controlled lock, creates a bounded private archive snapshot,
checks the independent digest, safely verifies/extracts every entry, clones trusted
Git as the application user, proves allowed-ref reachability, and materializes a
new root-owned runtime with inert Git metadata. It publishes an external root-owned
receipt before the canonical release. An orphan receipt blocks further reuse.
Import never reads shared data, executes candidate code, installs/builds, migrates,
switches current or controls services. First and repeat imports both fetch the
allowed ref into a fresh application-user checkout and verify its origin, exact
commit, ancestry and clean full worktree before validating the trimmed runtime.
The root receipt also records the verified remote HEAD.

The runtime intentionally excludes tracked `README.md`, `AGENTS.md`, `.github`,
`docs` and `ops` files. Its full Git index is retained for exact commit/blob lookup;
ordinary Git status therefore contains expected tracked deletions. Runtime
validation instead requires the complete commit-derived source set, exact source
bytes, exact HEAD/origin/ref ancestry, full receipt file/directory/native inventory,
and sealed ownership. Missing or modified included sources, extra excluded files,
extra `.env*`, wrong origin/HEAD/ref and unsafe receipt metadata are rejected.
Legacy full checkouts continue to require a clean Git worktree.

Runtime directories are root-owned `0755`, files `0644`/`0755`; only `.next/cache`
is application-owned `0700`. Private workspaces and receipts remain root-private.
Git runs as the application user with command-scoped `safe.directory` for the exact
release; no global exemption. Unknown collision files/directories are preserved.

Activation requires a separate root-controlled exact approval record at
`/etc/nuaafa/prebuilt-approvals/<commit>.json`: format `1`, exact commit, exact
`artifact_sha256`, exact `allowed_ref`, `security_gate=PASS`,
`linux_artifact_validation=PASS`, `human_review=APPROVED`. No approval is generated.
Application validation while audit fails cannot satisfy release approval.

Activation verifies receipt, full tree, platform/ABI/OpenSSL, fresh ref reachability,
current release, trusted student-ID preflight, schema/migration compatibility,
DB migration history and service contract. It creates and independently verifies a
fresh combined DB/upload backup, stops service, performs forward migration, checks
complete history, rechecks IDs/tree/approval, switches current and verifies service
state, exact health JSON and service process working directory. Backup/migration
run from the verified release with explicit paths and no install/build/generation.

## Startup and configuration

Future production use requires separate authorization to install the reviewed
deployer, helper, student-ID guard and `start-prebuilt` wrapper and adopt its service
contract. Nothing was installed or changed in systemd/Nginx this round.

ExecStart must be the root-controlled wrapper, User `nuaafa`, WorkingDirectory
`/srv/nuaafa/current`. The wrapper verifies application UID, canonical direct
current link, trusted parent/build/CLI metadata, exact shared links, configuration
permissions and Next `16.3.8`. It rejects extra `.env*` before executing Next,
clears inherited environment, uses host
`/usr/bin/node` version `22.23.2`, and starts packaged Next on `127.0.0.1:3001`.
Unit fragment/drop-ins must be root controlled. Additional start/stop commands,
environment sources, alternate filesystem roots and bind mounts are rejected.

Only `.env.production -> /srv/nuaafa/shared/.env.production` and
`prisma/dev.db -> /srv/nuaafa/shared/prisma/dev.db` are allowed. The environment
must be canonical, root-owned, non-root non-writable, not world accessible and
readable through the approved application group. Validators inspect metadata only.
Additional `.env*`, ignored configuration/source files, extra directories and unsafe
links are rejected. No production secrets were read.

## Recovery

The root-controlled, atomic/fsynced journal is
`/srv/nuaafa/prebuilt-activation.json`. Both full and prebuilt activation verify the
old release's complete identity, build and shared-link metadata before backup,
stop or migration. An imported old release is verified against its own receipt,
digest and ref; legacy old releases retain strict clean-worktree validation.
Recovery rechecks these conditions. Only old Git/build/shared-link validation,
old current switch, successful old restart and verified old health can yield
`ROLLED_BACK`. Failed recovery yields `MANUAL_REQUIRED` and attempts service stop;
a failed stop is reported. Ordinary failures and SIGINT/SIGTERM run recovery.
An interrupted/failed `MIGRATING` state never automatically restarts old code or
restores DB. Differing old/candidate schema or migration inventories block before
writes. There are no automatic down migrations.

For unfinished journals, SIGKILL/power loss, orphan receipts, collisions or
journal/current mismatch: keep service stopped where possible. After separate
production authorization, inspect journal, current/service/PID, migration history,
verified backup and exact source/runtime identities. Do not delete unknown files,
clear the journal or restore DB to bypass the block. An operator must establish a
compatible forward repair or explicitly approve a controlled recovery before
recording a terminal state. The lock releases on process exit; its inode remains.

## Legacy modes and validation

Historical full/stage/activate-staged modes require an independent exact root-owned
`legacy-<commit>.json` with `legacy_host_build=APPROVED` and `human_review=APPROVED`.
Imported candidates are refused by receipt/marker checks. No legacy approval is
generated and prebuilt activation never falls back to host build. Legacy builds
remain unisolated and require their own reviewed scope. Full mode now builds before
migration and uses compatibility, stop, journal and verified recovery gates.
Activate-staged keeps the separately approved link-only boundary. With an existing
terminal journal it may only retain the journal-confirmed current version; a
different target is rejected before switching and requires full activation. An
already-current result leaves the journal unchanged and explicitly does not claim
fresh health validation. Incomplete/manual/mismatched journals remain blocked.
The previously approved absent-journal legacy link-only path creates no journal.

`python3 scripts/test-prebuilt-artifact.py` uses synthetic archives, local Git and
actual import `main`, Git and state/check-state logic, with marked
same-user/service/platform adapters for deployment simulations. It includes
excluded tracked files, first/repeat import, real journal sequences, old-release
prechecks and recovery to a separately imported old artifact.
`npm run test:deployer` runs the preserved isolated legacy matrix.
`test-prebuilt-runtime.mjs` tests relocated native modules, HTTP and synthetic
backup/verify/restore plus the actual deployer backup function. Its
`--startup-fixture`/`--wrapper` pair executes the actual startup wrapper from `/`,
with inherited application environment deliberately poisoned.
`python3 scripts/test-start-prebuilt.py` probes wrapper identity, environment,
configuration and Node-version rejection through the actual script entry.
`test-tiptap-browser.mjs` uses an explicitly selected isolated runtime and bundled
Playwright to exercise edit/save/reopen/preview/publish and illegal-content
rejection. Every browser URL is intercepted and served only from loopback.

`sudo env "PATH=$PATH" python3 scripts/test-prebuilt-linux.py` is for a disposable
Ubuntu runner only. It creates an ephemeral user/root-owned trees under `/opt`,
executes real import/repeat verification without replacing ownership/Git validators,
rejects unsafe metadata and missing approvals, and removes its own fixture/user.
Optional `--archive/--commit/--sha256` sends the exact archive through real deployer
import twice, retains the same digest, and starts actual Next through a copy of the
wrapper as the nonprivileged user. Only fixed deployment paths/account/host Node
are adapted; root metadata/UID enforcement is retained on Linux. It also validates
real journal sequences and pre-stop rejection. No persistent service or production access.
On macOS it exits `2`: **NOT RUN**.

The workflow uses pinned Actions, Ubuntu 24.04 x64, Node 22.23.2 and clean locked
install. Safety/cross-user fixtures and real packaging/import-twice/wrapper runtime
validation always run after successful prior checks. Authenticated digest summary
and candidate upload alone are default-off and recheck the same tested digest.
One-day retention; security remains an independent failed gate;
there is no deployment or approval-generation step.

## Archived Fix-3A/Fix-3B provenance

The following text records historical source and behavior. Its hashes, default-mode
availability, operation ordering, cleanup and rollback statements are superseded
by the current contract above. They are not current installed-host evidence or
permission to bootstrap this revision.

# Historical NUAAFA production deployer provenance and reviewed modes

## Status

`ops/deploy/nuaafa-deploy` is the canonical source for the production deployer.
R1-3D PREFLIGHT FIX-3A adopted the then-installed production file byte for byte.
R1-3D PREFLIGHT FIX-3B starts from that frozen source and adds reviewed,
isolated-test-backed staging and activation primitives. It does not install or
execute the changed deployer on production and does not authorize Phase B.

| Field | Value |
| --- | --- |
| Fix-3A production/source baseline SHA-256 | `a3de22095a9d894c3ae2bc412c07432263dd0822f24d4bea28d2acadb545d694` |
| Fix-3B reviewed source SHA-256 | `a5267ba836d54e6857c9fcac317a4ac21f9dc7635ea3e72b5f09dfd105f712c5` |
| Version output | `nuaafa-deploy R1-3D-FIX-3B-1` |
| Canonical repository path | `ops/deploy/nuaafa-deploy` |
| Installed production path, if later approved | `/usr/local/sbin/nuaafa-deploy` |

The source is forced to LF by `.gitattributes` and remains executable in Git.
The separate bootstrap procedure requires both the old and new hashes, syntax,
owner, and mode checks before an atomic replacement.

### Preserved Fix-3A capture evidence

The Fix-3A baseline came from `/usr/local/sbin/nuaafa-deploy` at
`2026-08-24T13:08:04Z`. The observed production file was a regular executable,
owned by `root:root`, mode `0755`, size `3634` bytes, and its production,
captured-local, and committed-source hashes all matched the Fix-3A baseline
above. The then-observed current release was
`/srv/nuaafa/releases/09e8222c5e02193d38e9a0348385bd0987596168`;
that observation is evidence, never a permanent rollback assumption.

The Fix-3A secret scan found no embedded password, access token, private key,
SSH credential, database credential, session secret, API key, or `.env` value.
Fixed filesystem paths, the service/user names, SSH host alias, and repository
URL are operational configuration rather than secrets. Fix-3B retains that
boundary and adds no secret value.

## CLI

The default invocation remains the backward-compatible full deployment path.
The two new operations require an explicit exact 40-character lowercase SHA:

```bash
nuaafa-deploy --stage-only \
  --allowed-ref refs/heads/feat/v2.9-unified-admin-r1 \
  EXACT_40_HEX_SHA

nuaafa-deploy --activate-staged \
  --allowed-ref refs/heads/feat/v2.9-unified-admin-r1 \
  EXACT_40_HEX_SHA
```

`--dry-run` is compatible with stage-only, activate-staged, and the default
full mode. Conflicting modes, a missing SHA for either new mode, unsafe refs,
and invalid SHAs fail closed. `--help` documents the modes and `--version`
provides a deterministic operator-visible source version.

## Stage-only boundary

Stage-only takes the deployment lock, validates the fixed layout, fetches the
explicit allowed ref, proves the requested commit is its ancestor, checks out
detached, installs dependencies, runs the existing static/Prisma checks, builds,
validates `.next/BUILD_ID`, and writes deterministic provenance under the
release's `.git` directory. A new release is prepared under an operation-scoped
`.staging-<sha>-<pid>` directory and is published to the canonical SHA path only
after the build and provenance checks pass.

It does not run a backup or migration, alter the shared environment/database,
switch `current`, import content, provision uploads, touch timers, or control the
service. A failed partial preparation cannot be mistaken for a valid canonical
staged release. An existing canonical release is reused only after all staged
provenance checks pass.

## Activate-staged boundary

Activate-staged performs read-only validation of the canonical release path,
owner, origin, clean HEAD, recorded allowed-ref provenance, build artifact,
shared environment/database links, and current-link state. It then performs
only an operation-scoped same-parent atomic `current` link replacement.

It does not install, build, back up, migrate, import, modify environment data,
provision uploads, change timers, or stop/start/restart/reload the service. An
already-current verified release returns a deterministic success.

## Full deploy compatibility

The default path still runs checks, DB-only backup, `prisma migrate deploy`,
build verification, current switch, service restart, and health polling. Its
restart/health rollback continues to restore the prior application link without
claiming to roll back database migrations. Shared path helpers now fail closed
on ambiguous release, link, and temporary-current state; the isolated full-mode
regression proves the legacy operation ordering remains available.

## Safety and provenance

- Release and preparation directories must be canonical direct children of
  `/srv/nuaafa/releases`; unexpected types, symlinks, traversal, dirty worktrees,
  incorrect origins, and mismatched HEADs are rejected.
- `.env.production` and `prisma/dev.db` may only be direct links to canonical
  shared regular files. Existing unexpected entries and link chains fail closed.
- `current` may be absent or a direct link to an existing owned
  `/srv/nuaafa/releases/<40-hex>` release. A regular file, directory, outside
  target, chain, or invalid name is rejected.
- The temporary current link is unique to the operation and SHA. Any collision
  is rejected without unlinking it.
- Staged provenance binds format, commit, allowed ref, fetched ref HEAD,
  repository, BUILD_ID SHA-256, and deployer version.
- No release cleanup uses `rm -rf`, and unrelated releases are not deleted.

## Validation and production boundary

Run the isolated matrix with `npm run test:deployer`; it uses temporary roots,
test remotes, fake shared files, and mocked service/database actions, never
`/srv/nuaafa`. The RC runner includes this matrix together with the production
hardening, content gate, backup/restore, Prisma, TypeScript, lint, Unicode,
R1/R1-2/R1-3A/R1-3B, build, and clean-install gates.

The reviewed future installation procedure is
[`docs/operations/R1-3D_DEPLOYER_BOOTSTRAP.md`](../../docs/operations/R1-3D_DEPLOYER_BOOTSTRAP.md).
Do not execute it without separate human Phase B authorization.

No production database, filesystem, environment, service, timer, deployer
installation, deployment, push, or merge change was performed by Fix-3B.
