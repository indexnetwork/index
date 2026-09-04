-- Signal creation is two calls now: a stateless clarify round that stores
-- nothing, then a create that writes the intent and links it to the networks
-- the owner picked. The guided intake funnel and the propose/confirm handshake
-- are gone, so the tables that held their state have no readers or writers.

DROP TABLE IF EXISTS "intent_proposals";
--> statement-breakpoint
DROP TABLE IF EXISTS "signal_intake_runs";
--> statement-breakpoint
DROP TABLE IF EXISTS "signal_intake_packs";
--> statement-breakpoint
DROP TYPE IF EXISTS "intent_proposal_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "signal_intake_run_status";
