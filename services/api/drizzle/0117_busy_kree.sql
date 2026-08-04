ALTER TABLE "networks" ADD COLUMN "master_key_hash" text;
ALTER TABLE "networks" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;

-- Backfill: experiment networks keep their master key and stay hidden
UPDATE "networks" SET "master_key_hash" = "experiment_master_key_hash", "hidden" = true
WHERE "is_experiment" = true;

ALTER TABLE "networks" DROP COLUMN "is_experiment";
ALTER TABLE "networks" DROP COLUMN "experiment_master_key_hash";
ALTER TABLE "networks" DROP COLUMN "type";
DROP TYPE "public"."network_type";
