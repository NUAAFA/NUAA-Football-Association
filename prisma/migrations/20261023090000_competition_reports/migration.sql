ALTER TABLE "ContentPost" ADD COLUMN "competitionId" TEXT REFERENCES "Competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ContentPost_competitionId_status_publishedAt_idx" ON "ContentPost"("competitionId", "status", "publishedAt");
