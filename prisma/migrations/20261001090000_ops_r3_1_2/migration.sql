DROP TRIGGER IF EXISTS "ops_TeamGroupMembership_insert_scope";
DROP TRIGGER IF EXISTS "ops_TeamGroupMembership_update_scope";
DROP TRIGGER IF EXISTS "ops_CompetitionRound_insert_scope";
DROP TRIGGER IF EXISTS "ops_CompetitionRound_update_scope";
DROP TRIGGER IF EXISTS "ops_CompetitionGroup_insert_scope";
DROP TRIGGER IF EXISTS "ops_CompetitionGroup_update_scope";
DROP TRIGGER IF EXISTS "ops_Match_insert_scope";
DROP TRIGGER IF EXISTS "ops_Match_update_scope";
DROP TRIGGER IF EXISTS "Match_number_insert";
DROP TRIGGER IF EXISTS "Match_number_update";
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Match" (
    "matchNumber" INTEGER,
    "stageId" TEXT,
    "groupId" TEXT,
    "roundId" TEXT,
    "homePenaltyScore" INTEGER,
    "awayPenaltyScore" INTEGER,
    "resultVersion" INTEGER NOT NULL DEFAULT 0,
    "resultConfirmedAt" DATETIME,
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "kickoff" DATETIME,
    "endAt" DATETIME,
    "venue" TEXT,
    "round" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalMatchId" TEXT,
    "lastSyncedAt" DATETIME,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "status" TEXT NOT NULL,
    "applicationWindowStatus" TEXT NOT NULL DEFAULT 'CLOSED',
    "applicationDeadline" DATETIME,
    "publicNote" TEXT,
    "internalNote" TEXT,
    "cancelledAt" DATETIME,
    "cancellationReason" TEXT,
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Match_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CompetitionStage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CompetitionGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CompetitionRound" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Match_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Match" ("applicationDeadline", "applicationWindowStatus", "awayPenaltyScore", "awayScore", "awayTeamId", "cancellationReason", "cancelledAt", "competitionId", "createdAt", "endAt", "externalMatchId", "groupId", "homePenaltyScore", "homeScore", "homeTeamId", "id", "internalNote", "isTestData", "kickoff", "lastSyncedAt", "matchNumber", "publicNote", "resultConfirmedAt", "resultVersion", "round", "roundId", "slug", "source", "stage", "stageId", "status", "updatedAt", "venue") SELECT "applicationDeadline", "applicationWindowStatus", "awayPenaltyScore", "awayScore", "awayTeamId", "cancellationReason", "cancelledAt", "competitionId", "createdAt", "endAt", "externalMatchId", "groupId", "homePenaltyScore", "homeScore", "homeTeamId", "id", "internalNote", "isTestData", "kickoff", "lastSyncedAt", "matchNumber", "publicNote", "resultConfirmedAt", "resultVersion", "round", "roundId", "slug", "source", "stage", "stageId", "status", "updatedAt", "venue" FROM "Match";
DROP TABLE "Match";
ALTER TABLE "new_Match" RENAME TO "Match";
CREATE UNIQUE INDEX "Match_slug_key" ON "Match"("slug");
CREATE INDEX "Match_competitionId_kickoff_idx" ON "Match"("competitionId", "kickoff");
CREATE INDEX "Match_applicationWindowStatus_applicationDeadline_idx" ON "Match"("applicationWindowStatus", "applicationDeadline");
CREATE UNIQUE INDEX "Match_source_externalMatchId_key" ON "Match"("source", "externalMatchId");
CREATE UNIQUE INDEX "Match_competitionId_matchNumber_key" ON "Match"("competitionId", "matchNumber");
CREATE TABLE "new_CompetitionGroup" (
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "stageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CompetitionGroup_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CompetitionStage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CompetitionGroup" ("id", "name", "sortOrder", "stageId", "updatedAt") SELECT "id", "name", "sortOrder", "stageId", CURRENT_TIMESTAMP FROM "CompetitionGroup";
DROP TABLE "CompetitionGroup";
ALTER TABLE "new_CompetitionGroup" RENAME TO "CompetitionGroup";
CREATE UNIQUE INDEX "CompetitionGroup_stageId_name_key" ON "CompetitionGroup"("stageId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


CREATE TRIGGER "ops_TeamGroupMembership_insert_scope" BEFORE INSERT ON "TeamGroupMembership" WHEN NOT EXISTS (SELECT 1 FROM "CompetitionGroup" g JOIN "CompetitionStage" s ON s.id=g.stageId JOIN "Team" t ON t.id=NEW.teamId WHERE g.id=NEW.groupId AND s.id=NEW.stageId AND t.competitionId=s.competitionId AND s.type='GROUP') BEGIN SELECT RAISE(ABORT, 'OPS_STRUCTURE_SCOPE_INVALID'); END;

CREATE TRIGGER "ops_TeamGroupMembership_update_scope" BEFORE UPDATE ON "TeamGroupMembership" WHEN NOT EXISTS (SELECT 1 FROM "CompetitionGroup" g JOIN "CompetitionStage" s ON s.id=g.stageId JOIN "Team" t ON t.id=NEW.teamId WHERE g.id=NEW.groupId AND s.id=NEW.stageId AND t.competitionId=s.competitionId AND s.type='GROUP') BEGIN SELECT RAISE(ABORT, 'OPS_STRUCTURE_SCOPE_INVALID'); END;

CREATE TRIGGER "ops_CompetitionRound_insert_scope" BEFORE INSERT ON "CompetitionRound" WHEN NEW.groupId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CompetitionGroup" WHERE id=NEW.groupId AND stageId=NEW.stageId) BEGIN SELECT RAISE(ABORT, 'OPS_STRUCTURE_SCOPE_INVALID'); END;

CREATE TRIGGER "ops_CompetitionRound_update_scope" BEFORE UPDATE ON "CompetitionRound" WHEN NEW.groupId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CompetitionGroup" WHERE id=NEW.groupId AND stageId=NEW.stageId) BEGIN SELECT RAISE(ABORT, 'OPS_STRUCTURE_SCOPE_INVALID'); END;

CREATE TRIGGER "ops_CompetitionGroup_insert_scope" BEFORE INSERT ON "CompetitionGroup" WHEN NOT EXISTS (SELECT 1 FROM "CompetitionStage" WHERE id=NEW.stageId AND type='GROUP') BEGIN SELECT RAISE(ABORT, 'OPS_STRUCTURE_SCOPE_INVALID'); END;

CREATE TRIGGER "ops_CompetitionGroup_update_scope" BEFORE UPDATE ON "CompetitionGroup" WHEN NOT EXISTS (SELECT 1 FROM "CompetitionStage" WHERE id=NEW.stageId AND type='GROUP') BEGIN SELECT RAISE(ABORT, 'OPS_STRUCTURE_SCOPE_INVALID'); END;

CREATE TRIGGER "ops_Match_insert_scope" BEFORE INSERT ON "Match" WHEN NEW.homeTeamId=NEW.awayTeamId
 OR NOT EXISTS (SELECT 1 FROM "Team" WHERE id=NEW.homeTeamId AND competitionId=NEW.competitionId)
 OR NOT EXISTS (SELECT 1 FROM "Team" WHERE id=NEW.awayTeamId AND competitionId=NEW.competitionId)
 OR (NEW.stageId IS NULL AND (NEW.groupId IS NOT NULL OR NEW.roundId IS NOT NULL))
 OR (NEW.stageId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CompetitionStage" s WHERE s.id=NEW.stageId AND s.competitionId=NEW.competitionId AND (s.type!='GROUP' OR NEW.groupId IS NOT NULL)))
 OR (NEW.groupId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CompetitionGroup" g JOIN "TeamGroupMembership" h ON h.groupId=g.id AND h.teamId=NEW.homeTeamId JOIN "TeamGroupMembership" a ON a.groupId=g.id AND a.teamId=NEW.awayTeamId WHERE g.id=NEW.groupId AND g.stageId=NEW.stageId))
 OR (NEW.roundId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CompetitionRound" WHERE id=NEW.roundId AND stageId=NEW.stageId AND (groupId IS NULL OR groupId=NEW.groupId))) BEGIN SELECT RAISE(ABORT, 'OPS_STRUCTURE_SCOPE_INVALID'); END;

CREATE TRIGGER "ops_Match_update_scope" BEFORE UPDATE ON "Match" WHEN NEW.homeTeamId=NEW.awayTeamId
 OR NOT EXISTS (SELECT 1 FROM "Team" WHERE id=NEW.homeTeamId AND competitionId=NEW.competitionId)
 OR NOT EXISTS (SELECT 1 FROM "Team" WHERE id=NEW.awayTeamId AND competitionId=NEW.competitionId)
 OR (NEW.stageId IS NULL AND (NEW.groupId IS NOT NULL OR NEW.roundId IS NOT NULL))
 OR (NEW.stageId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CompetitionStage" s WHERE s.id=NEW.stageId AND s.competitionId=NEW.competitionId AND (s.type!='GROUP' OR NEW.groupId IS NOT NULL)))
 OR (NEW.groupId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CompetitionGroup" g JOIN "TeamGroupMembership" h ON h.groupId=g.id AND h.teamId=NEW.homeTeamId JOIN "TeamGroupMembership" a ON a.groupId=g.id AND a.teamId=NEW.awayTeamId WHERE g.id=NEW.groupId AND g.stageId=NEW.stageId))
 OR (NEW.roundId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CompetitionRound" WHERE id=NEW.roundId AND stageId=NEW.stageId AND (groupId IS NULL OR groupId=NEW.groupId))) BEGIN SELECT RAISE(ABORT, 'OPS_STRUCTURE_SCOPE_INVALID'); END;

CREATE TRIGGER "Match_number_insert" BEFORE INSERT ON "Match"
WHEN NEW."matchNumber" IS NOT NULL AND (typeof(NEW."matchNumber") <> 'integer' OR NEW."matchNumber" < 1 OR NEW."matchNumber" > 99999)
BEGIN SELECT RAISE(ABORT, 'Invalid match number'); END;

CREATE TRIGGER "Match_number_update" BEFORE UPDATE OF "matchNumber" ON "Match"
WHEN NEW."matchNumber" IS NOT NULL AND (typeof(NEW."matchNumber") <> 'integer' OR NEW."matchNumber" < 1 OR NEW."matchNumber" > 99999)
BEGIN SELECT RAISE(ABORT, 'Invalid match number'); END;
CREATE TRIGGER "ops_pending_match_insert" BEFORE INSERT ON "Match"
WHEN (NEW.kickoff IS NULL OR NEW.venue IS NULL OR length(trim(NEW.venue))=0)
 AND (NEW.applicationWindowStatus='OPEN' OR NEW.status='COMPLETED')
BEGIN SELECT RAISE(ABORT, 'OPS_MATCH_PENDING_SCHEDULE'); END;
CREATE TRIGGER "ops_pending_match_update" BEFORE UPDATE ON "Match"
WHEN (NEW.kickoff IS NULL OR NEW.venue IS NULL OR length(trim(NEW.venue))=0)
 AND (NEW.applicationWindowStatus='OPEN' OR NEW.status='COMPLETED')
BEGIN SELECT RAISE(ABORT, 'OPS_MATCH_PENDING_SCHEDULE'); END;
CREATE TRIGGER "ops_membership_match_delete" BEFORE DELETE ON "TeamGroupMembership"
WHEN EXISTS (SELECT 1 FROM "Match" WHERE stageId=OLD.stageId AND (homeTeamId=OLD.teamId OR awayTeamId=OLD.teamId))
BEGIN SELECT RAISE(ABORT, 'OPS_GROUP_HAS_MATCHES'); END;
CREATE TRIGGER "ops_membership_match_update" BEFORE UPDATE ON "TeamGroupMembership"
WHEN (NEW.groupId <> OLD.groupId OR NEW.stageId <> OLD.stageId OR NEW.teamId <> OLD.teamId) AND EXISTS (SELECT 1 FROM "Match" WHERE stageId=OLD.stageId AND (homeTeamId=OLD.teamId OR awayTeamId=OLD.teamId))
BEGIN SELECT RAISE(ABORT, 'OPS_GROUP_HAS_MATCHES'); END;
