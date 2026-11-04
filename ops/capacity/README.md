# M02 read-only capacity and retention candidate

This directory does not install a timer, delete files, create a backup, change a disk
threshold, or restore any database. All real capacity changes need separate approval.
It preserves the existing 80% monitor threshold and 5 GiB free-space floor.

## Accounting

Run `python3 -I -B ops/capacity/planner.py inventory --root=/absolute/approved/root --category=unknown`.
The scanner uses descriptor-relative no-follow directory opens, does not cross device
boundaries, and returns UNKNOWN on entry/time/depth limits or unreadable/changing objects.
It reads metadata, not file contents. The default bounds are 100,000 entries / 30 seconds
/ 64 levels. There is no automatic category inference from a convenient directory name.

`logicalRegularBytes` counts names, `uniqueLogicalRegularBytes` deduplicates hardlinks,
and `uniqueAllocatedBytes` sums st_blocks*512 once per inode, including directories.
These are different measurements. Reflink/compression sharing cannot be measured by
st_blocks alone; do not treat this as an exact reclaimable-byte estimate. Do not add
overlapping root scans or count the same hardlink again across separate roots. The
filesystem fields distinguish user-available blocks from free blocks including reserves.
Metadata-only scans are live samples, not atomic filesystem snapshots.

## Peak-space plan

`peak` requires explicit byte estimates for backup, build, import, restore and temporary
work, in addition to current filesystem total and available bytes. It assumes they all
overlap on the same filesystem. A PASS requires space after their sum to be strictly
above both the 5 GiB floor and the existing 20%-free threshold. A current free-space
number by itself is not a safe peak-space plan. Serialized execution may reduce peak
space only after the serialization and every phase's measured peak are independently
verified and approved; the planner does not silently assume it.

## Retention proposal: all conditions required

The unapproved default proposal is daily 14 days / weekly 8 weeks / monthly 12 months.
The bucket algorithm protects the latest two verified points **per format** and explicit
rollback/hold IDs. It is tested with fictional preverified records only. This candidate
cannot authenticate execution of an external verifier from caller-supplied JSON, even
when the supplied hash and check fields match. Therefore `inspect_backup` always leaves
`retentionEligible=false` and `receiptExecutionProvenance=UNKNOWN`; the real `retention`
CLI keeps **every** inspected object as unproven. It cannot produce an actual approved
or eligible cleanup point. A future trusted verification integration and independent
approval are required. No apply/delete command exists.

Use `retention --config=/absolute/dedicated-nonsecret-config.json`. The config contains:

```
{
  "verifierPins": {"ONLINE_OPS": "<64 lower-case hex>", "MODERN_UNIFIED": "<64 lower-case hex>"},
  "protectedIds": ["<approved rollback or evidential hold ID>"],
  "policy": {"daily": 14, "weekly": 8, "monthly": 12},
  "backups": [{"root": "/absolute/explicit/backup", "receipt": {"...": "see below"}}]
}
```

A receipt is a **caller attestation**, not execution proof or a signature. It is not
created by this planner. Pin its full verifier's code hash from independent source/deployment
evidence, not from an untrusted backup's own metadata. The caller must run the existing
format-specific full verifier first: the installed ONLINE_OPS `backup.py verify`, or
the matching application `readAndVerifyCombinedBackup` for MODERN_UNIFIED. Do not mix
the formats or restore them with each other's tools. Record only metadata/identities:

```
{
  "status": "PASS", "profile": "ONLINE_OPS or MODERN_UNIFIED",
  "backupId": "<exact ID>", "checkedAt": "<UTC ISO time with zone>",
  "verifierSha256": "<independently pinned verifier code SHA-256>",
  "manifestSha256": "<SHA-256 of exact manifest bytes>",
  "payloadSetSha256": "<definition below>",
  "checks": {"payloadChecksums": "PASS", "fileSet": "PASS", "databaseIntegrity": "PASS", "foreignKeys": "PASS"}
}
```

ONLINE_OPS additionally requires `databaseLogical: PASS`; MODERN_UNIFIED requires
`migrationLedger: PASS` and `schemaCapabilities: PASS`. The payload set digest is
SHA-256 of UTF-8 `json.dumps(records, sort_keys=True, separators=(",", ":"))`, where
records maps each manifest-relative payload path to `{ "bytes": integer, "sha256": hex }`.
No personal rows, upload contents, environment secrets or notification addresses belong
in a receipt/config. A directory's name is not necessarily its manifest backup ID.

The planner independently rechecks completion binding, exact file set, all payload
sizes/hashes, immutable read-only SQLite integrity/FK, ONLINE_OPS logical fingerprints
or MODERN_UNIFIED migration names, and a fresh receipt (at most 24 hours old). It
rehashes payloads after database checks. Successful comparisons are labeled
`payloadAndDatabaseChecks=PASS` / `receiptBindingChecks=PASS`, while overall status
remains UNKNOWN and the point stays ineligible. These are preparation checks, not a
replacement for the full format-specific verifier or production approval. The library
bucket function's fictional preverified inputs do not authenticate any real backup.

Backup hashing is bounded to 100 GiB / 100,000 files / 60 seconds by default; reaching
a bound preserves UNKNOWN, never partial PASS. A protected complete snapshot is assumed
stable during verification; changing/unreadable evidence is preserved. The planner
does not acquire production locks or modify permissions. It opens SQLite with mode=ro,
immutable=1 and query_only; it never uses SQLite's writable default URI.

## Tests and approval

Run `python3 -I -B scripts/test-capacity-planning.py` with fictional temporary files.
Tests create hardlinks, sparse files, symlinks, FIFO, two distinct backup schemas and
SQLite snapshots. The fixtures' receipt pins are fictional; passing them does not
verify a real backup, offsite copy, Linux deployment or production cleanup.

Approval must name exact objects, current identity/hashes, capacity target, exclusions,
independent-copy/recovery prerequisites, operator, maintenance window and failure/rollback
handling. Unknown directories, SQLite WAL/SHM, logs, unapproved recovery points and
failed forensic evidence are never implicitly safe to remove. Prefer expansion or
approved future artifact placement over guessing reclaimable files.
