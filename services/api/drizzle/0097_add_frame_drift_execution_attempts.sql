CREATE TABLE "frame_drift_execution_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"queue_name" text NOT NULL,
	"scheduler_id" text NOT NULL,
	"job_id" text NOT NULL,
	"job_name" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"bucket_end" timestamp with time zone NOT NULL,
	"attempt" integer NOT NULL,
	"max_attempts" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"terminal_status" text,
	"will_retry" boolean,
	"failure_category" text,
	CONSTRAINT "frame_drift_execution_attempts_identity_check" CHECK (
    length(btrim("frame_drift_execution_attempts"."queue_name")) > 0
    AND length(btrim("frame_drift_execution_attempts"."scheduler_id")) > 0
    AND length(btrim("frame_drift_execution_attempts"."job_id")) > 0
    AND length(btrim("frame_drift_execution_attempts"."job_name")) > 0
  ),
	CONSTRAINT "frame_drift_execution_attempts_daily_bucket_check" CHECK (
    "frame_drift_execution_attempts"."bucket_end" = "frame_drift_execution_attempts"."bucket_start" + interval '1 day'
    AND date_trunc('day', "frame_drift_execution_attempts"."bucket_start" AT TIME ZONE 'UTC') = "frame_drift_execution_attempts"."bucket_start" AT TIME ZONE 'UTC'
    AND date_trunc('day', "frame_drift_execution_attempts"."bucket_end" AT TIME ZONE 'UTC') = "frame_drift_execution_attempts"."bucket_end" AT TIME ZONE 'UTC'
    AND "frame_drift_execution_attempts"."scheduled_at" >= "frame_drift_execution_attempts"."bucket_end"
    AND "frame_drift_execution_attempts"."scheduled_at" < "frame_drift_execution_attempts"."bucket_end" + interval '1 day'
  ),
	CONSTRAINT "frame_drift_execution_attempts_attempt_bounds_check" CHECK (
    "frame_drift_execution_attempts"."attempt" BETWEEN 1 AND "frame_drift_execution_attempts"."max_attempts"
    AND "frame_drift_execution_attempts"."max_attempts" BETWEEN 1 AND 100
  ),
	CONSTRAINT "frame_drift_execution_attempts_terminal_status_check" CHECK (
    "frame_drift_execution_attempts"."terminal_status" IS NULL
    OR "frame_drift_execution_attempts"."terminal_status" IN ('inserted', 'duplicate', 'skipped', 'failed')
  ),
	CONSTRAINT "frame_drift_execution_attempts_failure_category_check" CHECK (
    "frame_drift_execution_attempts"."failure_category" IS NULL OR "frame_drift_execution_attempts"."failure_category" = 'measurement'
  ),
	CONSTRAINT "frame_drift_execution_attempts_terminal_state_check" CHECK (
    (
      "frame_drift_execution_attempts"."terminal_status" IS NULL
      AND "frame_drift_execution_attempts"."completed_at" IS NULL
      AND "frame_drift_execution_attempts"."will_retry" IS NULL
      AND "frame_drift_execution_attempts"."failure_category" IS NULL
    ) OR (
      "frame_drift_execution_attempts"."terminal_status" IN ('inserted', 'duplicate', 'skipped')
      AND "frame_drift_execution_attempts"."completed_at" IS NOT NULL
      AND "frame_drift_execution_attempts"."completed_at" >= "frame_drift_execution_attempts"."started_at"
      AND "frame_drift_execution_attempts"."will_retry" IS NOT NULL
      AND "frame_drift_execution_attempts"."will_retry" = false
      AND "frame_drift_execution_attempts"."failure_category" IS NULL
    ) OR (
      "frame_drift_execution_attempts"."terminal_status" = 'failed'
      AND "frame_drift_execution_attempts"."completed_at" IS NOT NULL
      AND "frame_drift_execution_attempts"."completed_at" >= "frame_drift_execution_attempts"."started_at"
      AND "frame_drift_execution_attempts"."will_retry" IS NOT NULL
      AND "frame_drift_execution_attempts"."failure_category" IS NOT NULL
      AND "frame_drift_execution_attempts"."failure_category" = 'measurement'
    )
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "frame_drift_execution_attempts_job_attempt_uniq" ON "frame_drift_execution_attempts" USING btree ("job_id","attempt");--> statement-breakpoint
CREATE INDEX "frame_drift_execution_attempts_bucket_start_idx" ON "frame_drift_execution_attempts" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX "frame_drift_execution_attempts_incomplete_idx" ON "frame_drift_execution_attempts" USING btree ("started_at") WHERE "frame_drift_execution_attempts"."completed_at" IS NULL;