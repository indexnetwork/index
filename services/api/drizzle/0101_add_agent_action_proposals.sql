CREATE TYPE "public"."agent_action_proposal_status" AS ENUM('pending', 'executing', 'consumed');--> statement-breakpoint
CREATE TABLE "agent_action_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text,
	"actions" jsonb NOT NULL,
	"status" "agent_action_proposal_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_action_proposals" ADD CONSTRAINT "agent_action_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_action_proposals_user_id_idx" ON "agent_action_proposals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_action_proposals_conversation_id_idx" ON "agent_action_proposals" USING btree ("conversation_id");