CREATE TYPE "public"."signal_intake_run_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "signal_intake_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"answers_hash" text NOT NULL,
	"status" "signal_intake_run_status" DEFAULT 'pending' NOT NULL,
	"proposal_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_intake_runs" ADD CONSTRAINT "signal_intake_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signal_intake_runs_user_answers_uniq" ON "signal_intake_runs" USING btree ("user_id","answers_hash");--> statement-breakpoint
CREATE INDEX "signal_intake_runs_user_id_idx" ON "signal_intake_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "signal_intake_runs_created_at_idx" ON "signal_intake_runs" USING btree ("created_at");