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
	CONSTRAINT "cross_network_yield_snapshots_canonical_pair_check" CHECK ("cross_network_yield_snapshots"."network_a_id" < "cross_network_yield_snapshots"."network_b_id")
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
	CONSTRAINT "frame_centroid_snapshots_corpus_check" CHECK ("frame_centroid_snapshots"."corpus" IN ('premise', 'intent', 'user_context'))
);
--> statement-breakpoint
ALTER TABLE "cross_network_yield_snapshots" ADD CONSTRAINT "cross_network_yield_snapshots_network_a_id_networks_id_fk" FOREIGN KEY ("network_a_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_network_yield_snapshots" ADD CONSTRAINT "cross_network_yield_snapshots_network_b_id_networks_id_fk" FOREIGN KEY ("network_b_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frame_centroid_snapshots" ADD CONSTRAINT "frame_centroid_snapshots_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cross_network_yield_snapshots_daily_uniq" ON "cross_network_yield_snapshots" USING btree ("network_a_id","network_b_id","bucket_start");--> statement-breakpoint
CREATE INDEX "cross_network_yield_snapshots_latest_idx" ON "cross_network_yield_snapshots" USING btree ("network_a_id","network_b_id","bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "frame_centroid_snapshots_daily_uniq" ON "frame_centroid_snapshots" USING btree ("network_id","corpus","embedding_model","bucket_start");--> statement-breakpoint
CREATE INDEX "frame_centroid_snapshots_latest_idx" ON "frame_centroid_snapshots" USING btree ("network_id","corpus","embedding_model","bucket_start");--> statement-breakpoint
CREATE INDEX "opportunities_created_at_idx" ON "opportunities" USING btree ("created_at");