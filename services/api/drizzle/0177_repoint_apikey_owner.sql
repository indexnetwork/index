-- The Better Auth apiKey plugin owns this table now, and it writes the owner
-- into `reference_id` only — it has no `user_id` field. Every existing row was
-- minted with both columns set to the same user, so backfill from whichever is
-- populated, then make `reference_id` the constrained owner pointer and drop
-- the column nothing writes any more.

UPDATE "apikey" SET "reference_id" = "user_id" WHERE "reference_id" IS NULL AND "user_id" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "apikey" WHERE "reference_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "apikey" DROP COLUMN IF EXISTS "user_id";
--> statement-breakpoint
ALTER TABLE "apikey" ALTER COLUMN "reference_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_reference_id_users_id_fk"
  FOREIGN KEY ("reference_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
