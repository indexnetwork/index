-- Create index_links table to manage crawlable URLs per index
CREATE TABLE IF NOT EXISTS "index_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "index_id" uuid NOT NULL REFERENCES "indexes"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "max_depth" integer DEFAULT 1 NOT NULL,
  "max_pages" integer DEFAULT 50 NOT NULL,
  "include_patterns" text[] DEFAULT '{}'::text[] NOT NULL,
  "exclude_patterns" text[] DEFAULT '{}'::text[] NOT NULL,
  "last_sync_at" timestamp NULL,
  "last_status" text NULL,
  "last_error" text NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "index_links_index_id_idx" ON "index_links" ("index_id");

-- Create integration_items mapping for dedupe across integrations (provider='web' for crawled pages)
CREATE TABLE IF NOT EXISTS "integration_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" varchar(32) NOT NULL,
  "external_id" text NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "index_id" uuid NULL REFERENCES "indexes"("id") ON DELETE CASCADE,
  "intent_id" uuid NULL REFERENCES "intents"("id") ON DELETE SET NULL,
  "content_hash" text NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "integration_items_user_idx" ON "integration_items" ("user_id");
CREATE INDEX IF NOT EXISTS "integration_items_index_idx" ON "integration_items" ("index_id");
CREATE INDEX IF NOT EXISTS "integration_items_provider_idx" ON "integration_items" ("provider");

-- Unique by provider + external_id + user + (nullable) index via expression index
CREATE UNIQUE INDEX IF NOT EXISTS "integration_items_unique_ext"
ON "integration_items" (
  "provider", "external_id", "user_id",
  COALESCE("index_id", '00000000-0000-0000-0000-000000000000')
);

