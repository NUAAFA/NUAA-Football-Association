-- Additive: historical matches retain NULL; SQLite permits multiple NULLs in this index.
ALTER TABLE "Match" ADD COLUMN "matchNumber" INTEGER;
CREATE UNIQUE INDEX "Match_competitionId_matchNumber_key" ON "Match"("competitionId", "matchNumber");
CREATE TRIGGER "Match_number_insert" BEFORE INSERT ON "Match"
WHEN NEW."matchNumber" IS NOT NULL AND (typeof(NEW."matchNumber") <> 'integer' OR NEW."matchNumber" < 1 OR NEW."matchNumber" > 99999)
BEGIN SELECT RAISE(ABORT, 'Invalid match number'); END;
CREATE TRIGGER "Match_number_update" BEFORE UPDATE OF "matchNumber" ON "Match"
WHEN NEW."matchNumber" IS NOT NULL AND (typeof(NEW."matchNumber") <> 'integer' OR NEW."matchNumber" < 1 OR NEW."matchNumber" > 99999)
BEGIN SELECT RAISE(ABORT, 'Invalid match number'); END;
