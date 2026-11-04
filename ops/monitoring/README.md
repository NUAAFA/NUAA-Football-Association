# M01 candidate sidecar — not installed

This directory contains a new, isolated operations candidate. It does not alter
the website, installed monitor, original event file, application SQLite database,
Nginx configuration, systemd units or production credentials. Production
installation, channel, recipient, messages and policies require separate approval.

## What is implemented

- `nuaafa_monitoring.py` uses only Python's standard library. `collect` aggregates
  Nginx combined access records and an explicitly supplied application log file.
  No IP, URL, referrer, user agent, SQL, personal name or arbitrary error text is
  persisted. Only numeric per-second buckets, file identity/offset, fingerprints,
  allowlisted categories and allowlisted incident payloads enter the private
  outbox. Normal HTTP 400/401/403/404 are requests, never 5xx errors.
- `HTTP_5XX_WINDOW` requires all three explicitly supplied threshold conditions:
  minimum requests, minimum errors, error ratio. Window is 900 seconds. Application
  classes are public-read-unavailable, Prisma initialization/query, SQLite
  BUSY/LOCKED. Log format/backlog/rotation coverage gaps are a separate check.
- New metric incidents use three bad observations / two good observations.
  Existing 22 checks and original incident timing are unchanged. The original
  installed programs and 23 tests are preserved byte-for-byte under `baseline/`,
  bound by `provenance.json`. They are regression fixtures, not an installer.
- `ingest` tails the original monitor JSONL read-only; only known incident kinds,
  known check names and numeric times are retained. Existing arbitrary daily
  summaries/service-failure message bodies are not forwarded. Backup/restore
  attempt failures remain covered by the original monitor's corresponding checks.
  First ingestion deliberately starts at EOF; historical events are not mailed.
  After the first `ingest`, explicit `bootstrap --latest ...` queues only current
  active original-monitor incidents, deduplicated against subsequent events.
- SQLite outbox is separate from business data. Event ID derives from check,
  incident start and kind. Incident and recovery retain the same incident ID.
  Single-process lock, 0700 state directory, 0600 database/lock, no symlink/hardlink
  database or input credentials. Ingestion offsets and new events commit together.
- SMTP uses certificate-verified implicit TLS and one explicitly approved receiver.
  It remains disabled in the example. Config and secret are dedicated private
  files; website `.env.production` is never loaded. Systemd credentials can supply
  root-managed files without putting addresses/secrets on the command line.
- States: PENDING, SENDING, SENT, RETRY, FAILED, UNKNOWN_DELIVERY. Configurable
  attempt limit (1–10); default retry delays 30/120/600 seconds and four attempts
  are engineering defaults, not an approved production strategy. Retries occur
  only for known pre-acceptance/connect/auth or explicit negative SMTP replies.
  The normal CLI sends at most one message per cycle, avoiding a 20-message SMTP
  batch overrunning the sample unit's 180-second budget. Each socket phase has a
  10-second timeout. DNS resolution or OS stalls may still exceed the supervisor
  budget; an interrupted SENDING record is quarantined for manual reconciliation.
  Exhausted retries remain visible as FAILED; no recursive sender alert is sent.
  `status` and every cycle expose aggregate notification health and exit 2 for
  FAILED/UNKNOWN/stale pending. An independently approved observer must watch this
  health output so a failed sender does not have to report its own failure.
- Recovery remains blocked until its parent incident is transport-accepted.
  Unknown adapter exceptions, DATA disconnects and an interrupted SENDING process
  become UNKNOWN_DELIVERY and require operator review; automatic blind resend is
  prohibited. Event IDs/Message-ID support correlation, but SMTP has no exact-once
  acceptance guarantee. No human receipt is inferred from SMTP acceptance.

## Log coverage and limitations

Initial log observation skips existing bytes and reports a coverage gap. Rotation
drains a matching uncompressed `.1` inode before the new file, bounded per cycle.
Missing rotations, copytruncate fingerprint/size changes, oversized lines,
malformed access records and backlog cannot silently become healthy. Partial
lines wait for a newline. No compressed log archive or unbounded backlog is read.
Copytruncate cannot be lossless when truncation and regrowth reproduce the same
prefix and exceed the previous offset; use rename rotation with retained `.1` and
bounded write rates. File collectors need a subsequent observation after startup
and rotation; they do not retrospectively claim full outage coverage.

Application file counters classify lines at observation time because the file
format is not a guaranteed timestamp envelope. The optional `collect --journal`
source instead invokes the fixed `/usr/bin/journalctl --unit=nuaafa.service`
read-only interface with cursor-bound JSON records and actual record timestamps.
Raw messages stay in bounded process memory; only numeric buckets and cursor
are committed together. A failed, oversized or invalid read cannot advance the
cursor. Journal collection is tested through real child-process interface fixtures;
actual privileged journal ACL integration is not claimed locally. Approve and
verify a minimal unit-scoped read mechanism before installation. Do not give the
email sender broad journal membership to bypass this boundary.

This same-host sender cannot prove notification delivery if the host is completely
down. An independent HTTPS checker with a separate failure domain and receiver
is still a separate approved deployment. The candidate does not claim it exists.

## Isolated commands

From repository root (all fixtures are generated in new local temporary dirs):

~~~sh
python3 scripts/test-ops-monitoring-baseline.py
python3 scripts/test-ops-monitoring.py
~~~

For an approved private test environment, create an empty state directory owned
by its low-privilege test user with mode 0700. Then run `--state-dir DIR ingest
--events FIXTURE_JSONL`, `bootstrap --latest FIXTURE_MONITOR_JSON`, and `collect
--access FIXTURE_ACCESS --application FIXTURE_APP --min-requests N --min-errors N
--error-ratio R`. These threshold values must come from the approved plan.
`send --config PRIVATE_CONFIG` is a separate explicit action; do not run it against
a real target until its exact recipient, count and time window are approved.

The complete candidate chain is a restricted root collector with fixed read-only
inputs → private SQLite → group-readable handoff → independent low-privilege
sender/private SQLite → certificate-verified SMTP. Both have service/timer
templates. The root collector uses NoNewPrivileges, only CAP_DAC_READ_SEARCH,
read-only filesystem, private network, and inaccessible business/SMTP paths
(including /run/credentials runtime copies).
There is no sudo rule, escalation chain, journal group membership or environment
loading. `readonly-inputs.py` is a fixed-source root diagnostic entry point, not a
permission granted to the sender. Only allowlisted events/counters/cursors leave
the fixed reader. Original 0600 snapshot replacements do not rely on fragile
per-file ACLs. Earlier sudo-based candidate design was superseded and removed.
Production installation remains an approval gate; Linux fictional UID/namespace
tests do not prove that production is installed.

## Required production acceptance

1. Bind exact candidate/source hashes and production identity; review log source,
   minimal ACLs, units, credential paths, approved thresholds and return codes.
2. Install only after separate approval; use a dedicated non-login user and
   separate root-managed sender config/secret. Never reuse application secrets.
3. Prove ingestion, bootstrap, numeric aggregation and unchanged original 22 checks.
4. Use a clearly labeled synthetic event without harming website/database;
   obtain send-side acceptance and receiver confirmation for approved failure,
   recovery and retry messages. Reconcile expected event IDs/counts.
5. Demonstrate terminal/uncertain delivery investigation without replaying blindly.
   UNKNOWN_DELIVERY needs a reviewed, recorded per-event reconciliation procedure;
   do not manually edit the outbox or delete it to force another send.
6. Only confirmed human receipt can turn ALERT DELIVERY from UNKNOWN to PASS.

## Durable bridge and capacity boundary

`fixed-bridge` has no raw log filename option. The collector keeps input cursors,
new metric incidents and queued exports in its own 0700/0600 SQLite. Its 0750
handoff directory is owned by the collector with a dedicated reader group; files
are 0640. The sender belongs only to that read group and cannot change handoff,
read collector state, original logs or business data. The collector has no sender
credential access or network namespace.

The first run reads only new original events, then always bootstraps currently
active original incidents; a pre-existing fault cannot be missed merely because
its original event predates installation. Handoff events are fsynced before export
acknowledgement. An interrupted acknowledgement causes safe same-ID replay. A
truncated/corrupted handoff is rebuilt atomically from **all retained durable DB
events**, including previously exported records; no pending-only reconstruction
can drop unread history. Sender `consume` reads from the first handoff byte,
deduplicates replay and bootstraps the separate active snapshot. It independently
checks collector-provided collected_epoch (never file mtime) and malformed/missing
input. Three bad/two good observations persist linked collector freshness fault
and recovery events in the sender outbox, even if the collector no longer runs.
The freshness limit (sample600 seconds) requires explicit configuration approval.
The fixed original-monitor source separately validates its actual UTC timestamp
and rejects missing/future/older-than900-second snapshots; a running collector
cannot rewrap a stopped original monitor's old healthy state as new evidence.

The example handoff budget is 8 MiB (explicit CLI argument, maximum64 MiB),
collector SQLite stops new intake at64 MiB, and export requires at least the
existing 5 GiB free-space floor plus snapshot size. Budget/space failure preserves
existing handoff and queued DB events and returns failure; it does not delete
events or reset cursors. A damaged handoff over the read budget stops for review.
Retention/compaction is not automatic and requires a separately approved policy.
Original input log rotation still has finite retention: missing source rotations
are explicitly degraded, never represented as complete past coverage.

Consume/ingest/bootstrap may print DEGRADED while returning0 so the
ordered final send can drain it. Final send/status return2 for terminal, unknown
or stale delivery; the sender unit fails visibly. An independent observer must
watch unit result, completion age and numeric health. The sender cannot prove its
own delivery during total host failure; external probing remains a separate gate.

## Current production HTTP source and scope correction

Full-context read-only evidence confirms `access_log off;` applies ONLY to the
hidden-file deny location. Ordinary HTTP/HTTPS NUAAFA traffic inherits the global
`/var/log/nginx/access.log` combined format. The fixed reader therefore uses that
existing exact path; no Nginx change is required for this candidate. Counts cover
logged requests, including HTTP redirects, with the explicit hidden-file exception.
Current evidence has one enabled NUAAFA configuration. If more virtual hosts are
added, the shared log attribution must be reviewed again before claiming site-only
counts. An earlier directive-only interpretation incorrectly labeled logging
disabled; that historical evidence is retained and corrected, not used as a gate.

All raw combined content is transient memory; only timestamp/status counters are
persisted. The optional new `$msec $status` privacy log example is a separately
approved future optimization, not an installation prerequisite. It needs its own
exact source-path candidate, permissions, rotation and approved Nginx test/reload.

See INSTALL-PLAN.md for concrete accounts, group, directories, capability boundary,
unit sequence and approval/rollback constraints. All real channel bindings, real
delivery, production installation and independent external probe remain
NOT RUN/UNKNOWN in this engineering candidate.
