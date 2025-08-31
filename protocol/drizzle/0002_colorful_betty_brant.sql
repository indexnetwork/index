CREATE TABLE IF NOT EXISTS "index_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"index_id" uuid NOT NULL,
	"url" text NOT NULL,
	"max_depth" integer DEFAULT 1 NOT NULL,
	"max_pages" integer DEFAULT 50 NOT NULL,
	"include_patterns" text[] DEFAULT '{}' NOT NULL,
	"exclude_patterns" text[] DEFAULT '{}' NOT NULL,
	"last_sync_at" timestamp,
	"last_status" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"external_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"index_id" uuid,
	"intent_id" uuid,
	"content_hash" text,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "integration_granted_resources" CASCADE;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "index_links" ADD CONSTRAINT "index_links_index_id_indexes_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."indexes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integration_items" ADD CONSTRAINT "integration_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integration_items" ADD CONSTRAINT "integration_items_index_id_indexes_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."indexes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integration_items" ADD CONSTRAINT "integration_items_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
