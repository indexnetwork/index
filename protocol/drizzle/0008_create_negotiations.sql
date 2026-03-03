-- Create negotiation status enum
CREATE TYPE "public"."negotiation_status" AS ENUM('initiated', 'in_progress', 'resolved', 'expired');

-- Create negotiation outcome enum
CREATE TYPE "public"."negotiation_outcome" AS ENUM('opportunity', 'disengaged', 'deferred');

-- Create negotiations table
CREATE TABLE IF NOT EXISTS "negotiations" (
  "id" text PRIMARY KEY NOT NULL,
  "status" "negotiation_status" DEFAULT 'initiated' NOT NULL,
  "outcome" "negotiation_outcome",
  "participants" jsonb NOT NULL,
  "trigger" jsonb NOT NULL,
  "turns" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "resolution" jsonb,
  "opportunity_id" text REFERENCES "opportunities"("id"),
  "current_turn" integer DEFAULT 0 NOT NULL,
  "max_turns" integer DEFAULT 3 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "negotiations_status_idx" ON "negotiations" USING btree ("status");
CREATE INDEX IF NOT EXISTS "negotiations_participants_idx" ON "negotiations" USING gin ("participants");
