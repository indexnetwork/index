CREATE TABLE "cross_network_yield_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
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
	"network_id" text NOT NULL,
	"corpus" text NOT NULL,
	"centroid" vector(2000) NOT NULL,
	"sample_count" integer NOT NULL,
	"embedding_model" text NOT NULL,
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
ALTER TABLE "cross_network_yield_snapshots" ADD CONSTRAINT "cross_network_yield_snapshots_network_a_id_networks_id_fk" FOREIGN KEY ("network_a_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_network_yield_snapshots" ADD CONSTRAINT "cross_network_yield_snapshots_network_b_id_networks_id_fk" FOREIGN KEY ("network_b_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frame_centroid_snapshots" ADD CONSTRAINT "frame_centroid_snapshots_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cross_network_yield_snapshots_daily_uniq" ON "cross_network_yield_snapshots" USING btree ("network_a_id","network_b_id","bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "frame_centroid_snapshots_daily_uniq" ON "frame_centroid_snapshots" USING btree ("network_id","corpus","embedding_model","bucket_start");