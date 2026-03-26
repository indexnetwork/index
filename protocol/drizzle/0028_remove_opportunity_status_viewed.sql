ALTER TABLE "opportunities" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
UPDATE "opportunities" SET "status" = 'pending' WHERE "status" = 'viewed';--> statement-breakpoint
DROP TYPE "public"."opportunity_status";--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('latent', 'draft', 'pending', 'accepted', 'rejected', 'expired');--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."opportunity_status";--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "status" SET DATA TYPE "public"."opportunity_status" USING "status"::"public"."opportunity_status";