CREATE TYPE "public"."intent_discovery_progress_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'blocked');
--> statement-breakpoint
CREATE TABLE "intent_discovery_progress" (
  "intent_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "status" "intent_discovery_progress_status" DEFAULT 'queued' NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "assigned_community_count" integer DEFAULT 0 NOT NULL,
  "processed_community_count" integer DEFAULT 0 NOT NULL,
  "possible_overlap_count" integer DEFAULT 0 NOT NULL,
  "conversations_started_count" integer DEFAULT 0 NOT NULL,
  "queued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intent_discovery_progress" ADD CONSTRAINT "intent_discovery_progress_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "intent_discovery_progress" ADD CONSTRAINT "intent_discovery_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "intent_discovery_progress_user_updated_idx" ON "intent_discovery_progress" USING btree ("user_id","updated_at");
