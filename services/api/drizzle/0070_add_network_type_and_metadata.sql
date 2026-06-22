CREATE TYPE "public"."network_type" AS ENUM('community', 'event');--> statement-breakpoint
ALTER TABLE "network_members" ALTER COLUMN "metadata" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "network_members" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
UPDATE "network_members" SET "metadata" = '{}'::jsonb WHERE "metadata" IS NULL;--> statement-breakpoint
ALTER TABLE "network_members" ALTER COLUMN "metadata" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "network_integrations" ADD COLUMN "sync_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "type" "network_type" DEFAULT 'community' NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;