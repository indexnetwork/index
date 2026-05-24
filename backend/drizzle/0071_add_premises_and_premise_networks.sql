CREATE TYPE "public"."premise_status" AS ENUM('ACTIVE', 'RETRACTED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "premise_networks" (
	"premise_id" text NOT NULL,
	"network_id" text NOT NULL,
	"relevancy_score" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "premise_networks_premise_id_network_id_pk" PRIMARY KEY("premise_id","network_id")
);
--> statement-breakpoint
CREATE TABLE "premises" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"assertion" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"analysis" jsonb,
	"validity" jsonb NOT NULL,
	"embedding" vector(2000),
	"status" "premise_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retracted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "premise_networks" ADD CONSTRAINT "premise_networks_premise_id_premises_id_fk" FOREIGN KEY ("premise_id") REFERENCES "public"."premises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premise_networks" ADD CONSTRAINT "premise_networks_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premises" ADD CONSTRAINT "premises_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "premise_networks_network_id_idx" ON "premise_networks" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX "premises_embedding_idx" ON "premises" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "premises_user_id_idx" ON "premises" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "premises_status_idx" ON "premises" USING btree ("status");