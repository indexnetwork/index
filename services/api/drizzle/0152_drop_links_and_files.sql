DROP TABLE IF EXISTS "links";
DROP TABLE IF EXISTS "files";

UPDATE "intents"
SET "source_type" = NULL
WHERE "source_type" IN ('file', 'link');

ALTER TYPE "public"."source_type" RENAME TO "source_type_old";
CREATE TYPE "public"."source_type" AS ENUM('integration', 'discovery_form', 'enrichment');
ALTER TABLE "intents" ALTER COLUMN "source_type" TYPE "public"."source_type" USING "source_type"::text::"public"."source_type";
DROP TYPE "public"."source_type_old";
