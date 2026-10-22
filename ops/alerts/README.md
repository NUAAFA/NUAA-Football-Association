# Isolated alert implementation

This standalone operations code does not change the application or its database.
All sample configurations are disabled. The sending unit permits loopback only;
production SMTP/heartbeat endpoints, verified sender identity, recipient list and
network allowlist must be approved separately before any real delivery.

`alerts.py bridge` reads the existing monitor's bounded event log and latest
observation. It rejects ambiguous JSON, file aliases, unsafe permissions, changed
log prefixes, rotation and truncation. Only fixed event fields enter the spool.
Partial final lines are retained for the next run. The cursor is committed after
durable event files, so a crash replays identical event IDs without losing events.
Unknown log rotations require reconciliation rather than automatic skipping.

The separate root-owned storage receipt must contain exactly `status`,
`backup_id`, `backup_utc` and `verified_utc`. Both the backup and verification must
be within 27 hours. A fresh verification cannot make an old backup fresh. Missing,
blocked or stale storage never generates a healthy heartbeat.

`alerts.py send` uses systemd-managed encrypted credentials, a separate service
user, a durable per-recipient outbox and mandatory implicit TLS. Only unresolved
recipients are retried. Network/4xx errors retry after 1, 5, 15 and then 60 minutes;
certificate, authentication and permanent errors quarantine. Socket timeouts are
supplemented by a process-wide deadline that cannot be swallowed by smtplib.
Messages are at least once: a crash after SMTP acceptance but before the durable
ack can duplicate a message. SMTP acceptance is not proof of inbox receipt.

Events and delivered/quarantined metadata are retained; there is no automatic
deletion. The 20 MiB / 10000 event limits fail visibly rather than discard data.
Retention/rotation tooling is not part of this change. Each pass handles at most
200 source events and 50 due messages. The source log is bounded at 8 MiB.

`alerts.py probe` is intended for a separately approved independent host. Public
HTTPS checks open after three failures and recover after two successes. Signed
heartbeats expire after twelve minutes. The receiver validation contract checks
TLS-delivered HMAC bodies, timestamps, replay and health consistency; the concrete
provider/webhook adapter is selected only after service confirmation. The tests
use a real loopback HTTPS receiver, not a production endpoint. Hosting the probe
on the primary server would not provide independent outage detection.

The host's monitor observations are trusted input after schema filtering; this
is not attestation against a compromised host. The independent public probe is
a separate observation path.

## Review installation map

| Source | Proposed destination | Ownership and mode |
|---|---|---|
| alerts.py | /usr/local/lib/nuaafa-alert/alerts.py | root:root 0644 |
| units/nuaafa-alert-* | /etc/systemd/system/ | root:root 0644 |
| bridge.example.json | /etc/nuaafa-alert/bridge.json | root:nuaafa-alert 0640, disabled |
| send.example.json | /etc/nuaafa-alert/send.json | root:nuaafa-alert 0640, disabled |
| externally approved storage receipt | /var/lib/nuaafa-alert-storage/acceptance.json | root:root 0600 |
| sanitized event spool | /var/lib/nuaafa-alert-input | root:nuaafa-alert 0750, events 0640 |
| sender state | /var/lib/nuaafa-alert-sender | nuaafa-alert:nuaafa-alert 0700, files 0600 |
| SMTP and heartbeat secrets | /etc/credstore.encrypted/ | root:root 0600; separate credentials |

Create the dedicated non-login user only under a later installation approval.
Do not grant it access to existing application state. Existing monitor directories
remain unchanged. The bridge has no network and cannot read production business
paths; the sender sees only the sanitized spool and its managed credentials.

Both services honor the existing background maintenance flag. Their two timers
must join the explicit future pause/drain inventory. External maintenance silence
needs an independent expiry and must not silently suppress storage/transport
failures. No timers or services are installed or enabled by these files.

## Verification

`scripts/test-alerts-isolated.py` uses freshly generated fictional CA/server keys,
real loopback SMTP/HTTPS, no real mailboxes and no production credentials. It covers
certificate/hostname/expiry, recipient refusal, retries, restart/crash, total
deadline, log rotation, disk failures, privacy, heartbeat replay and host outages.

The GitHub Ubuntu24 workflow additionally uses a namespace with no network routes,
actual systemd255 encrypted credentials and dedicated fixture users. Its native
units verify the original 10% CPU / 64 MiB / 16 task limits and maintenance skip,
while all TLS endpoints remain in the unit's private loopback namespace. Temporary
units/users have unique identities and only owned objects are cleaned up.

The separate legacy retirement regression removes the fallback only in a fictional
configuration and verifies unchanged named super-admin credentials against a new
fictional database. Production configuration editing, real login/session changes,
installation, merging, deployment and actual mail delivery remain outside this
implementation's execution scope.
