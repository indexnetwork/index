-- Negotiations an agent declined before declines paused the pair (#1845) are
-- still settled for good, so nothing can resume them. Convert them to the
-- paused shape: in talks, nobody to move, resumable by a seat. A human verdict
-- carries an actor and is never touched; on these rows the agents never
-- agreed, so no human could have acted.
DELETE FROM "opportunity_events" e
USING "negotiations" n
WHERE n."opportunity_id" = e."opportunity_id"
  AND n."outcome" = 'declined'
  AND e."type" = 'declined'
  AND e."actor_user_id" IS NULL;--> statement-breakpoint
UPDATE "opportunities" o
SET "status" = 'negotiating', "updated_at" = now()
FROM "negotiations" n
WHERE n."opportunity_id" = o."id"
  AND n."outcome" = 'declined'
  AND o."status" = 'rejected'
  AND NOT EXISTS (
    SELECT 1 FROM "opportunity_events" e
    WHERE e."opportunity_id" = o."id"
      AND e."type" IN ('declined', 'expired')
  );--> statement-breakpoint
UPDATE "negotiations" n
SET "outcome" = NULL, "settled_at" = NULL, "updated_at" = now()
FROM "opportunities" o
WHERE o."id" = n."opportunity_id"
  AND n."outcome" = 'declined'
  AND o."status" = 'negotiating';
