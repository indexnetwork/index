CREATE TABLE IF NOT EXISTS "apikey" (
  "id" text PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reference_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "enabled" boolean DEFAULT true NOT NULL,
  "rate_limit_enabled" boolean DEFAULT false NOT NULL,
  "request_count" integer DEFAULT 0 NOT NULL
);
