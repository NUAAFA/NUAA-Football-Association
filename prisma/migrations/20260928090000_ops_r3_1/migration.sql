-- CreateTable
CREATE TABLE "CompetitionStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "competitionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CompetitionStage_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompetitionGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CompetitionGroup_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CompetitionStage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompetitionRound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stageId" TEXT NOT NULL,
    "groupId" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CompetitionRound_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CompetitionStage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CompetitionRound_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CompetitionGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamGroupMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    CONSTRAINT "TeamGroupMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeamGroupMembership_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CompetitionStage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeamGroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CompetitionGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupConfirmation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "teamIds" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupConfirmation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CompetitionGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentPostId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "displayName" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByAdminId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentAttachment_contentPostId_fkey" FOREIGN KEY ("contentPostId") REFERENCES "ContentPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentAttachment_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Match" (
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
    "kickoff" DATETIME NOT NULL,
    "endAt" DATETIME,
    "venue" TEXT NOT NULL,
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
INSERT INTO "new_Match" ("applicationDeadline", "applicationWindowStatus", "awayScore", "awayTeamId", "cancellationReason", "cancelledAt", "competitionId", "createdAt", "endAt", "externalMatchId", "homeScore", "homeTeamId", "id", "internalNote", "isTestData", "kickoff", "lastSyncedAt", "publicNote", "round", "slug", "source", "stage", "status", "updatedAt", "venue") SELECT "applicationDeadline", "applicationWindowStatus", "awayScore", "awayTeamId", "cancellationReason", "cancelledAt", "competitionId", "createdAt", "endAt", "externalMatchId", "homeScore", "homeTeamId", "id", "internalNote", "isTestData", "kickoff", "lastSyncedAt", "publicNote", "round", "slug", "source", "stage", "status", "updatedAt", "venue" FROM "Match";
DROP TABLE "Match";
ALTER TABLE "new_Match" RENAME TO "Match";
CREATE UNIQUE INDEX "Match_slug_key" ON "Match"("slug");
CREATE INDEX "Match_competitionId_kickoff_idx" ON "Match"("competitionId", "kickoff");
CREATE INDEX "Match_applicationWindowStatus_applicationDeadline_idx" ON "Match"("applicationWindowStatus", "applicationDeadline");
CREATE UNIQUE INDEX "Match_source_externalMatchId_key" ON "Match"("source", "externalMatchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionStage_competitionId_name_key" ON "CompetitionStage"("competitionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionGroup_stageId_name_key" ON "CompetitionGroup"("stageId", "name");

-- CreateIndex
CREATE INDEX "CompetitionRound_stageId_groupId_idx" ON "CompetitionRound"("stageId", "groupId");

-- CreateIndex
CREATE INDEX "TeamGroupMembership_groupId_idx" ON "TeamGroupMembership"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamGroupMembership_stageId_teamId_key" ON "TeamGroupMembership"("stageId", "teamId");

-- CreateIndex
CREATE INDEX "GroupConfirmation_groupId_kind_createdAt_idx" ON "GroupConfirmation"("groupId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ContentAttachment_mediaAssetId_idx" ON "ContentAttachment"("mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentAttachment_contentPostId_mediaAssetId_key" ON "ContentAttachment"("contentPostId", "mediaAssetId");

-- SQLite NULL uniqueness: one name per ungrouped stage, or per explicit group.
CREATE UNIQUE INDEX "CompetitionRound_ungrouped_name" ON "CompetitionRound"("stageId", "name") WHERE "groupId" IS NULL;
CREATE UNIQUE INDEX "CompetitionRound_grouped_name" ON "CompetitionRound"("stageId", "groupId", "name") WHERE "groupId" IS NOT NULL;

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
