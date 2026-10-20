-- Additive only: no rewrite of historical facts, grades, permissions, timestamps or versions.
ALTER TABLE "Referee" ADD COLUMN "gradeMode" TEXT NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE "Referee" ADD COLUMN "enrollmentYear" INTEGER;
ALTER TABLE "Referee" ADD COLUMN "gradeReason" TEXT;
ALTER TABLE "RefereeAppointment" ADD COLUMN "recordSource" TEXT NOT NULL DEFAULT 'PRE_MATCH';
ALTER TABLE "RefereeAppointment" ADD COLUMN "recordedAt" DATETIME;
ALTER TABLE "RefereeAppointment" ADD COLUMN "recordedByAdminId" TEXT;
ALTER TABLE "RefereeAppointment" ADD COLUMN "publicHistoryVisible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AppointmentVersion" ADD COLUMN "recordSource" TEXT NOT NULL DEFAULT 'PRE_MATCH';
CREATE INDEX "Match_structure_navigation_idx" ON "Match"("competitionId", "stageId", "roundId", "groupId", "kickoff", "id");
CREATE INDEX "Referee_gradeMode_enrollmentYear_idx" ON "Referee"("gradeMode", "enrollmentYear");
