-- Three tables with no live product reader. `intent_discovery_progress` was
-- aggregate worker observability the UI never rendered — `warming` derives from
-- `intents.first_discovery_succeeded_at`, which stays. `agent_test_messages`
-- backed a "Send test message" dialog whose pickup loop was never built.
-- `agent_transports` was agent metadata with no delivery path.

DROP TABLE IF EXISTS "intent_discovery_progress";
--> statement-breakpoint
DROP TABLE IF EXISTS "agent_test_messages";
--> statement-breakpoint
DROP TABLE IF EXISTS "agent_transports";
--> statement-breakpoint
DROP TYPE IF EXISTS "intent_discovery_progress_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "transport_channel";
