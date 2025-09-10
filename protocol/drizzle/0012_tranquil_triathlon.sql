CREATE TYPE "public"."source_type" AS ENUM('file', 'integration', 'link');--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "source_type" "source_type";