CREATE TABLE "intent_verification_backfill_attempts" (
	"run_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"partition" text NOT NULL,
	"status" text NOT NULL,
	"payload_hash" text NOT NULL,
	"context_hash" text NOT NULL,
	"verifier_output" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "intent_verification_backfill_attempts_run_id_intent_id_pk" PRIMARY KEY("run_id","intent_id")
);
--> statement-breakpoint
CREATE TABLE "intent_verification_backfill_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"predicate_version" text NOT NULL,
	"verifier_name" text NOT NULL,
	"verifier_model" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "intent_verification_backfill_attempts" ADD CONSTRAINT "intent_verification_backfill_attempts_run_id_intent_verification_backfill_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."intent_verification_backfill_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_verification_backfill_attempts" ADD CONSTRAINT "intent_verification_backfill_attempts_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intent_verification_backfill_attempts_status_idx" ON "intent_verification_backfill_attempts" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "intent_verification_backfill_attempts_intent_idx" ON "intent_verification_backfill_attempts" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "intent_verification_backfill_runs_status_idx" ON "intent_verification_backfill_runs" USING btree ("status");