CREATE TABLE "cross_network_yield_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"network_a_id" text NOT NULL,
	"network_b_id" text NOT NULL,
	"opportunity_count" bigint NOT NULL,
	"potential_active_intent_pair_count" bigint NOT NULL,
	"yield_rate" double precision NOT NULL,
	"yield_rate_delta" double precision,
	"prior_bucket_start" timestamp with time zone,
	"bucket_start" timestamp with time zone NOT NULL,
	"bucket_end" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cross_network_yield_snapshots_canonical_pair_check" CHECK ("cross_network_yield_snapshots"."network_a_id" < "cross_network_yield_snapshots"."network_b_id"),
	CONSTRAINT "cross_network_yield_snapshots_opportunity_count_check" CHECK ("cross_network_yield_snapshots"."opportunity_count" >= 0),
	CONSTRAINT "cross_network_yield_snapshots_potential_pair_count_check" CHECK ("cross_network_yield_snapshots"."potential_active_intent_pair_count" > 0),
	CONSTRAINT "cross_network_yield_snapshots_yield_rate_check" CHECK ("cross_network_yield_snapshots"."yield_rate" >= 0),
	CONSTRAINT "cross_network_yield_snapshots_bucket_range_check" CHECK ("cross_network_yield_snapshots"."bucket_end" > "cross_network_yield_snapshots"."bucket_start")
);
--> statement-breakpoint
CREATE TABLE "frame_centroid_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"network_id" text NOT NULL,
	"corpus" text NOT NULL,
	"centroid" vector(2000) NOT NULL,
	"sample_count" integer NOT NULL,
	"configured_embedding_model" text NOT NULL,
	"cosine_drift" double precision,
	"prior_bucket_start" timestamp with time zone,
	"bucket_start" timestamp with time zone NOT NULL,
	"bucket_end" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "frame_centroid_snapshots_corpus_check" CHECK ("frame_centroid_snapshots"."corpus" IN ('premise', 'intent', 'user_context')),
	CONSTRAINT "frame_centroid_snapshots_sample_count_check" CHECK ("frame_centroid_snapshots"."sample_count" > 0),
	CONSTRAINT "frame_centroid_snapshots_cosine_drift_check" CHECK ("frame_centroid_snapshots"."cosine_drift" IS NULL OR ("frame_centroid_snapshots"."cosine_drift" >= 0 AND "frame_centroid_snapshots"."cosine_drift" <= 2)),
	CONSTRAINT "frame_centroid_snapshots_bucket_range_check" CHECK ("frame_centroid_snapshots"."bucket_end" > "frame_centroid_snapshots"."bucket_start")
);
--> statement-breakpoint
CREATE TABLE "frame_drift_observation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"bucket_end" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"configured_embedding_model" text NOT NULL,
	"max_networks" integer NOT NULL,
	"max_pairs" integer NOT NULL,
	"min_users" integer NOT NULL,
	"stable_cohort_hash" text,
	"aggregate_diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "frame_drift_observation_runs_bucket_check" CHECK ("frame_drift_observation_runs"."bucket_end" = "frame_drift_observation_runs"."bucket_start" + interval '1 day' AND "frame_drift_observation_runs"."captured_at" >= "frame_drift_observation_runs"."bucket_end"),
	CONSTRAINT "frame_drift_observation_runs_configured_embedding_model_check" CHECK (length(btrim("frame_drift_observation_runs"."configured_embedding_model")) > 0),
	CONSTRAINT "frame_drift_observation_runs_max_networks_check" CHECK ("frame_drift_observation_runs"."max_networks" BETWEEN 1 AND 200),
	CONSTRAINT "frame_drift_observation_runs_max_pairs_check" CHECK ("frame_drift_observation_runs"."max_pairs" BETWEEN 1 AND 10000),
	CONSTRAINT "frame_drift_observation_runs_min_users_check" CHECK ("frame_drift_observation_runs"."min_users" BETWEEN 2 AND 100),
	CONSTRAINT "frame_drift_observation_runs_stable_cohort_hash_check" CHECK ("frame_drift_observation_runs"."stable_cohort_hash" IS NULL OR "frame_drift_observation_runs"."stable_cohort_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "frame_drift_observation_runs_aggregate_diagnostics_check" CHECK (jsonb_typeof("frame_drift_observation_runs"."aggregate_diagnostics") = 'object')
);
--> statement-breakpoint
ALTER TABLE "cross_network_yield_snapshots" ADD CONSTRAINT "cross_network_yield_snapshots_run_id_frame_drift_observation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."frame_drift_observation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_network_yield_snapshots" ADD CONSTRAINT "cross_network_yield_snapshots_network_a_id_networks_id_fk" FOREIGN KEY ("network_a_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_network_yield_snapshots" ADD CONSTRAINT "cross_network_yield_snapshots_network_b_id_networks_id_fk" FOREIGN KEY ("network_b_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frame_centroid_snapshots" ADD CONSTRAINT "frame_centroid_snapshots_run_id_frame_drift_observation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."frame_drift_observation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frame_centroid_snapshots" ADD CONSTRAINT "frame_centroid_snapshots_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cross_network_yield_snapshots_daily_uniq" ON "cross_network_yield_snapshots" USING btree ("network_a_id","network_b_id","bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "frame_centroid_snapshots_daily_uniq" ON "frame_centroid_snapshots" USING btree ("network_id","corpus","configured_embedding_model","bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "frame_drift_observation_runs_bucket_start_uniq" ON "frame_drift_observation_runs" USING btree ("bucket_start");