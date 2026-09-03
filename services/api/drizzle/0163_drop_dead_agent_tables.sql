-- Remove the tables the in-process agent left behind. Each lost its only
-- writer when the personal agent, chat and negotiation graphs were deleted:
-- the negotiator's private memory, the intent agent's dossier and act ledger,
-- the chat session digest, and the negotiation round log whose fold
-- (`foldNegotiationRoundLog`) went away with the graph.
--
-- `intents.negotiation_batch_id` stays: OpportunityGraph still bumps a batch
-- through `bumpIntentNegotiationBatch`.

DROP TABLE IF EXISTS "negotiator_memories";
--> statement-breakpoint
DROP TABLE IF EXISTS "intent_dossier";
--> statement-breakpoint
DROP TABLE IF EXISTS "intent_agent_acts";
--> statement-breakpoint
DROP TABLE IF EXISTS "chat_session_summaries";
--> statement-breakpoint
DROP TABLE IF EXISTS "negotiation_round_log_events";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."intent_dossier_source";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."negotiation_round_log_event_kind";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."negotiation_round_log_event_via";
