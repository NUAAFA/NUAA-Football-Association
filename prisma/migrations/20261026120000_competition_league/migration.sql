-- Existing competitions keep their current group/knockout structure and results.
ALTER TABLE "Competition" ADD COLUMN "competitionSystem" TEXT NOT NULL DEFAULT 'GROUP_KNOCKOUT';
