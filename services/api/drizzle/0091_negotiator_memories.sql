CREATE TABLE "negotiator_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject_user_id" text,
	"content" text NOT NULL,
	"embedding" vector(2000),
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "negotiator_memories" ADD CONSTRAINT "negotiator_memories_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiator_memories" ADD CONSTRAINT "negotiator_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiator_memories" ADD CONSTRAINT "negotiator_memories_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "negotiator_memories_agent_kind_idx" ON "negotiator_memories" USING btree ("agent_id","kind");--> statement-breakpoint
CREATE INDEX "negotiator_memories_user_subject_idx" ON "negotiator_memories" USING btree ("user_id","subject_user_id");--> statement-breakpoint
CREATE INDEX "negotiator_memories_embedding_idx" ON "negotiator_memories" USING hnsw ("embedding" vector_cosine_ops);