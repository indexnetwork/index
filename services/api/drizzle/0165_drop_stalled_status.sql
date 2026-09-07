-- `stalled` was the turn-cap outcome of the old A2A task loop: agents ran out
-- of turns and the opportunity landed in a state no human could act on. The
-- negotiation record has two outcomes and a close, so nothing produces it and
-- nothing reads it.
--
-- `opportunities_active_pair_idx` names the status values in its predicate, so
-- it is dropped and rebuilt around the type swap without `stalled`.

UPDATE "opportunities" SET "status" = 'expired' WHERE "status" = 'stalled';
--> statement-breakpoint
DROP INDEX "opportunities_active_pair_idx";
--> statement-breakpoint
ALTER TYPE "opportunity_status" RENAME TO "opportunity_status_old";
--> statement-breakpoint
CREATE TYPE "opportunity_status" AS ENUM ('negotiating', 'pending', 'accepted', 'rejected', 'expired');
--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "status" TYPE "opportunity_status" USING "status"::text::"opportunity_status";
--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "status" SET DEFAULT 'negotiating';
--> statement-breakpoint
DROP TYPE "opportunity_status_old";
--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_active_pair_idx"
  ON "opportunities" (
    (context->>'networkId'),
    LEAST(actors->0->>'intent', actors->1->>'intent'),
    GREATEST(actors->0->>'intent', actors->1->>'intent')
  )
  WHERE status IN ('negotiating', 'pending')
    AND actors->0->>'intent' IS NOT NULL
    AND actors->1->>'intent' IS NOT NULL;
