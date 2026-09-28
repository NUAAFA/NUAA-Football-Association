# Dynamic public Team Directory R1

The current directory on `/teams` is owned by Unified Admin at `/admin/team-directory` under the existing `competitions:read` and `competitions:write` permissions. Admin selects one Competition, publishes the directory, edits the Association contact, and edits public metadata on Teams already assigned to that Competition. The directory also offers the existing organization, joint and freeform team creation shortcuts and batch visibility controls. These reuse Competition-scoped Team records and the existing organization/team services; they do not create a second team identity.

## Data choice

`Team.competitionId` already makes each Team strictly Competition scoped. R1 extends `Team` with nullable public status, contact and note fields plus separate visibility and order fields. The Team primary key represents the unique Competition + Team entry; a second entry table would duplicate this existing relationship. `publicStatus` is free text. No Competition-specific contact is placed on a permanent Organization record.

`TeamDirectorySettings` is a single row with id `current`. It stores the active Competition, publication flag, and independently editable Association contact. The nullable FK uses `ON DELETE SET NULL`. Deleting a Team removes its public metadata with the Team. No historical Team archive schema or data changes.

## Public rule and freshness

The directory can be published while `Competition.publicPublished` is false so recruitment can precede the full Competition detail page. The selected Competition must exist and have `isTestData=false`; the public read also checks this flag. Only Teams under that Competition with `directoryIsPublic=true` render. An unpublished Competition name appears as plain text, without a link to its unavailable detail page. No selected/published Competition and a Competition with zero public Teams have separate empty states, with no historical fallback.

`getPublicTeamDirectory()` selects and returns only approved public identity, status, QQ, email, and note fields. The `/teams` route renders dynamically on each request. Mutations also use the existing `revalidatePath` helper to invalidate `/teams`, including Competition and Team changes. Thus a subsequent request sees a Competition or contact switch without rebuilding or restarting the server.

Writes pass through the authenticated Unified Admin API and service. The service validates non-test Competition selection, Team membership in that Competition, email, order, text length, and visibility. Each settings or Team update and its AuditLog entry share a transaction. A Competition switch also emits a separate audit action. Audit metadata records identifiers and change flags without contact snapshots.

## Verification

`npm run test:team-directory-r1` creates an isolated pre-change database with the accepted main migrations, seeds legacy Competition/Team/Match/Referee rows, applies this migration with Prisma, verifies preserved row counts, zero FK violations, SQLite integrity, clean migration status, and a no-op second deploy. It then tests two Competition switches, contact changes, privacy projection, deletion safety, RBAC, and audit. `npm run test:public-competition-dynamic:http` covers the R3 Competition and historical archive regression. Production build and responsive browser smoke remain required before review.
