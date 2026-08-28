CREATE TYPE "discovery_match_candidate_status" AS ENUM ('pending', 'opened', 'superseded', 'expired');

CREATE TABLE "discovery_match_candidates" (
  "id" text PRIMARY KEY NOT NULL,
  "pair_key" text NOT NULL,
  "network_id" text NOT NULL REFERENCES "networks"("id") ON DELETE cascade,
  "intent_a" text NOT NULL REFERENCES "intents"("id") ON DELETE cascade,
  "intent_b" text NOT NULL REFERENCES "intents"("id") ON DELETE cascade,
  "user_a" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "user_b" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "score" numeric NOT NULL,
  "reasoning" text NOT NULL,
  "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" "discovery_match_candidate_status" DEFAULT 'pending' NOT NULL,
  "opened_opportunity_id" text REFERENCES "opportunities"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- One row per pair. This constraint IS the discovery dedup: both principals'
-- discovery runs converge here instead of racing to persist two opportunities
-- between the same two people.
CREATE UNIQUE INDEX "discovery_match_candidates_pair_key_idx" ON "discovery_match_candidates" ("pair_key");
CREATE INDEX "discovery_match_candidates_intent_a_idx" ON "discovery_match_candidates" ("intent_a");
CREATE INDEX "discovery_match_candidates_intent_b_idx" ON "discovery_match_candidates" ("intent_b");
