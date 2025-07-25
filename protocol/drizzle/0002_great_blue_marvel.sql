ALTER TABLE "intent_indexes" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_connection_events" DROP COLUMN IF EXISTS "agreement_data";