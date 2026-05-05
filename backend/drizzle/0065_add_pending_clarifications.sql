CREATE TABLE "pending_clarifications" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"intent_id" text,
	"candidate_user_id" text NOT NULL,
	"opportunity_id" text,
	"network_id" text,
	"source_agent_name" text,
	"question" text NOT NULL,
	"relevancy_score" text,
	"search_query" text,
	"answer" text,
	"answered_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_clarifications" ADD CONSTRAINT "pending_clarifications_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_clarifications_conversation_id_idx" ON "pending_clarifications" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "pending_clarifications_user_id_idx" ON "pending_clarifications" USING btree ("user_id");