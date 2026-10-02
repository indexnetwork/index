ALTER TABLE "intents" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "intents" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;
--> statement-breakpoint
UPDATE "intents" SET "status" = CASE "status"
  WHEN 'ACTIVE' THEN 'active'
  WHEN 'PAUSED' THEN 'paused'
  WHEN 'FULFILLED' THEN 'paused'
  WHEN 'EXPIRED' THEN 'paused'
  ELSE "status"
END
WHERE "status" IS NOT NULL;
--> statement-breakpoint
DROP TYPE "public"."intent_status";
--> statement-breakpoint
CREATE TYPE "public"."intent_status" AS ENUM('active', 'paused');
--> statement-breakpoint
ALTER TABLE "intents" ALTER COLUMN "status" SET DATA TYPE "public"."intent_status" USING "status"::"public"."intent_status";
--> statement-breakpoint
ALTER TABLE "intents" ALTER COLUMN "status" SET DEFAULT 'active';
