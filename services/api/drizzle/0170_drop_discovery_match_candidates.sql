-- Discovery no longer stops at a pick-list: it opens every scored pair into an
-- opportunity and a negotiation in the same run. The candidates table was the
-- staging row between those two writes and nothing reads it.
--
-- The one job it still did was unordered-pair uniqueness, so `pair_key` moves
-- onto the negotiation it was protecting.

ALTER TABLE "negotiations" ADD COLUMN "pair_key" text;
--> statement-breakpoint
-- Same key `pairKeyOf` computes: length-prefixed network and the two intents in
-- sorted order, so the side that discovered the pair does not change the key.
UPDATE "negotiations" AS n
SET "pair_key" =
  length(o."context"->>'networkId') || ':' || (o."context"->>'networkId')
  || length(least(n."initiator_intent_id", n."responder_intent_id")) || ':' || least(n."initiator_intent_id", n."responder_intent_id")
  || length(greatest(n."initiator_intent_id", n."responder_intent_id")) || ':' || greatest(n."initiator_intent_id", n."responder_intent_id")
FROM "opportunities" AS o
WHERE o."id" = n."opportunity_id" AND o."context"->>'networkId' IS NOT NULL;
--> statement-breakpoint
DELETE FROM "negotiations" WHERE "pair_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "negotiations" ALTER COLUMN "pair_key" SET NOT NULL;
--> statement-breakpoint
-- This constraint IS the discovery dedup: both principals' runs converge here
-- instead of opening two negotiations between the same two intents.
CREATE UNIQUE INDEX "negotiations_pair_key_idx" ON "negotiations" ("pair_key");
--> statement-breakpoint
DROP TABLE IF EXISTS "discovery_match_candidates" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "discovery_match_candidate_status";
