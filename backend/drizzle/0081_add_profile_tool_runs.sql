CREATE TABLE "profile_tool_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text,
	"operation" text NOT NULL,
	"status" "discovery_run_status" DEFAULT 'queued' NOT NULL,
	"input" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"progress" jsonb,
	"result" jsonb,
	"error" text,
	"cancel_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "profile_tool_runs" ADD CONSTRAINT "profile_tool_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_tool_runs" ADD CONSTRAINT "profile_tool_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_tool_runs_user_created_idx" ON "profile_tool_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "profile_tool_runs_status_created_idx" ON "profile_tool_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "profile_tool_runs_operation_created_idx" ON "profile_tool_runs" USING btree ("operation","created_at");--> statement-breakpoint
CREATE INDEX "profile_tool_runs_expires_at_idx" ON "profile_tool_runs" USING btree ("expires_at");