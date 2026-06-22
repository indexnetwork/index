CREATE TABLE "user_contexts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"network_id" text NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(2000),
	"premise_hash" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_contexts" ADD CONSTRAINT "user_contexts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_contexts" ADD CONSTRAINT "user_contexts_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_contexts_user_network_uniq" ON "user_contexts" USING btree ("user_id","network_id");--> statement-breakpoint
CREATE INDEX "user_contexts_embedding_idx" ON "user_contexts" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "user_contexts_user_id_idx" ON "user_contexts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_contexts_network_id_idx" ON "user_contexts" USING btree ("network_id");