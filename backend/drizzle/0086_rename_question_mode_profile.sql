-- WS11 (IND-368): the questioner 'profile' mode is renamed to 'enrichment'. The mode is
-- stored inside the questions.detection jsonb. Migrate existing rows so the dispatcher
-- (which matches detection.mode) keeps routing legacy gap-questions correctly.
UPDATE "questions"
SET "detection" = jsonb_set("detection", '{mode}', '"enrichment"')
WHERE "detection"->>'mode' = 'profile';
