ALTER TABLE "intents" ALTER COLUMN "source_type" SET DATA TYPE text USING "source_type"::text;
--> statement-breakpoint
UPDATE "intents" SET "source_type" = NULL WHERE "source_type" IN ('integration', 'discovery_form', 'enrichment');
--> statement-breakpoint
DROP TYPE "public"."source_type";
