-- Additive: preserve all existing kickoff values and historical facts.
ALTER TABLE "Match" ADD COLUMN "tentativeDate" TEXT;
ALTER TABLE "Match" ADD COLUMN "tentativeSchedule" TEXT;
-- Protect confirmation snapshots even if a non-UI caller attempts direct SQL deletion.
CREATE TRIGGER "ops_team_confirmation_delete" BEFORE DELETE ON "Team"
WHEN EXISTS (SELECT 1 FROM "GroupConfirmation" c JOIN "CompetitionGroup" g ON g.id=c.groupId JOIN "CompetitionStage" s ON s.id=g.stageId, json_tree(c.teamIds) j WHERE s.competitionId=OLD.competitionId AND j.type='text' AND j.value=OLD.id)
BEGIN SELECT RAISE(ABORT, 'TEAM_FORMAL_CONFIRMATION_REFERENCED'); END;
