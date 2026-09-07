-- The negotiation record. Index is the server for every negotiation: both
-- seats read this row and append turns against it, and Index computes the
-- settlement from its own log. There is no wire between agents and no copy.

CREATE TYPE "negotiation_outcome" AS ENUM ('agreed', 'declined', 'closed');
--> statement-breakpoint
CREATE TYPE "negotiation_turn_action" AS ENUM ('propose', 'counter', 'accept', 'decline');
--> statement-breakpoint
CREATE TABLE "negotiations" (
  "id" text PRIMARY KEY NOT NULL,
  "opportunity_id" text NOT NULL REFERENCES "opportunities"("id") ON DELETE cascade,
  "initiator_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "initiator_intent_id" text NOT NULL REFERENCES "intents"("id") ON DELETE cascade,
  "responder_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "responder_intent_id" text NOT NULL REFERENCES "intents"("id") ON DELETE cascade,
  "awaiting_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "outcome" "negotiation_outcome",
  "settled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- One negotiation per opportunity. Both principals' discovery runs can reach
-- the same pair; this is what stops the second one writing a second record.
CREATE UNIQUE INDEX "negotiations_opportunity_id_idx" ON "negotiations" ("opportunity_id");
--> statement-breakpoint
CREATE INDEX "negotiations_initiator_intent_idx" ON "negotiations" ("initiator_intent_id");
--> statement-breakpoint
CREATE INDEX "negotiations_responder_intent_idx" ON "negotiations" ("responder_intent_id");
--> statement-breakpoint
CREATE INDEX "negotiations_awaiting_user_idx" ON "negotiations" ("awaiting_user_id");
--> statement-breakpoint
CREATE TABLE "negotiation_turns" (
  "id" text PRIMARY KEY NOT NULL,
  "negotiation_id" text NOT NULL REFERENCES "negotiations"("id") ON DELETE cascade,
  "turn_index" integer NOT NULL,
  "seat_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "action" "negotiation_turn_action" NOT NULL,
  "message" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The concurrency control. A seat racing its counterparty, or retrying a
-- submit, collides here instead of appending a second turn at the same index.
CREATE UNIQUE INDEX "negotiation_turns_negotiation_turn_idx" ON "negotiation_turns" ("negotiation_id", "turn_index");
