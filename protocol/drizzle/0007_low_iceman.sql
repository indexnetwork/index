CREATE TYPE "public"."connection_action" AS ENUM('REQUEST', 'SKIP', 'CANCEL', 'ACCEPT', 'DECLINE', 'REMOVE');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_connection_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiator_user_id" uuid NOT NULL,
	"receiver_user_id" uuid NOT NULL,
	"connection_action" "connection_action" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intent_stakes" ADD COLUMN "intents" text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "is_incognito" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_connection_events" ADD CONSTRAINT "user_connection_events_initiator_user_id_users_id_fk" FOREIGN KEY ("initiator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_connection_events" ADD CONSTRAINT "user_connection_events_receiver_user_id_users_id_fk" FOREIGN KEY ("receiver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "intent_stakes" DROP COLUMN IF EXISTS "pair";--> statement-breakpoint
ALTER TABLE "intents" DROP COLUMN IF EXISTS "is_public";