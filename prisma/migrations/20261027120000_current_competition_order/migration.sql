-- Correct the three current, public 2026 events without changing their content or fixtures.
-- Future display changes remain editable through the existing publicOrder admin field.
UPDATE "Competition"
SET "publicOrder" = CASE "slug"
  WHEN 'fresherscup' THEN 10
  WHEN '2026futsal' THEN 20
  WHEN 'women' THEN 30
END
WHERE "slug" IN ('fresherscup', '2026futsal', 'women')
  AND "year" = 2026
  AND "publicPublished" = 1
  AND "isTestData" = 0;
