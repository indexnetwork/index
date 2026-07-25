CREATE TYPE "public"."intent_proposal_status" AS ENUM('pending', 'consumed', 'rejected');--> statement-breakpoint
CREATE TABLE "intent_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"description" text NOT NULL,
	"network_id" text,
	"analysis" jsonb NOT NULL,
	"status" "intent_proposal_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_intent_id" text
);
--> statement-breakpoint
ALTER TABLE "intent_proposals" ADD CONSTRAINT "intent_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_proposals" ADD CONSTRAINT "intent_proposals_consumed_intent_id_intents_id_fk" FOREIGN KEY ("consumed_intent_id") REFERENCES "public"."intents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intent_proposals_user_id_idx" ON "intent_proposals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "intent_proposals_expires_at_idx" ON "intent_proposals" USING btree ("expires_at");
