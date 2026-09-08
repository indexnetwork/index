-- Preserve rows, indexes, and constraints while assigning domain ownership.
ALTER TABLE "agents" RENAME TO "protocol_agents";
--> statement-breakpoint
ALTER TABLE "hyde_documents" RENAME TO "protocol_hyde_documents";
--> statement-breakpoint
ALTER TABLE "intent_networks" RENAME TO "protocol_intent_networks";
--> statement-breakpoint
ALTER TABLE "intents" RENAME TO "protocol_intents";
--> statement-breakpoint
ALTER TABLE "negotiation_turns" RENAME TO "protocol_negotiation_turns";
--> statement-breakpoint
ALTER TABLE "negotiations" RENAME TO "protocol_negotiations";
--> statement-breakpoint
ALTER TABLE "network_members" RENAME TO "protocol_network_members";
--> statement-breakpoint
ALTER TABLE "networks" RENAME TO "protocol_networks";
--> statement-breakpoint
ALTER TABLE "opportunities" RENAME TO "protocol_opportunities";
--> statement-breakpoint
ALTER TABLE "opportunity_outcome_events" RENAME TO "protocol_opportunity_outcome_events";
--> statement-breakpoint
ALTER INDEX "agents_owner_id_idx" RENAME TO "protocol_agents_owner_id_idx";
--> statement-breakpoint
ALTER INDEX "agents_type_idx" RENAME TO "protocol_agents_type_idx";
--> statement-breakpoint
ALTER INDEX "agents_last_seen_at_idx" RENAME TO "protocol_agents_last_seen_at_idx";
--> statement-breakpoint
ALTER INDEX "uniq_agents_hermes_installation" RENAME TO "protocol_uniq_agents_hermes_installation";
--> statement-breakpoint
ALTER INDEX "uniq_agents_selected_negotiation_executor" RENAME TO "protocol_uniq_agents_selected_negotiation_executor";
--> statement-breakpoint
ALTER INDEX "hyde_source_idx" RENAME TO "protocol_hyde_source_idx";
--> statement-breakpoint
ALTER INDEX "hyde_strategy_idx" RENAME TO "protocol_hyde_strategy_idx";
--> statement-breakpoint
ALTER INDEX "hyde_embedding_idx" RENAME TO "protocol_hyde_embedding_idx";
--> statement-breakpoint
ALTER INDEX "hyde_expires_idx" RENAME TO "protocol_hyde_expires_idx";
--> statement-breakpoint
ALTER INDEX "hyde_source_strategy_unique" RENAME TO "protocol_hyde_source_strategy_unique";
--> statement-breakpoint
ALTER INDEX "intent_networks_network_id_idx" RENAME TO "protocol_intent_networks_network_id_idx";
--> statement-breakpoint
ALTER INDEX "embeddingIndex" RENAME TO "protocol_embeddingIndex";
--> statement-breakpoint
ALTER INDEX "negotiation_turns_negotiation_turn_idx" RENAME TO "protocol_negotiation_turns_negotiation_turn_idx";
--> statement-breakpoint
ALTER INDEX "negotiations_pair_key_idx" RENAME TO "protocol_negotiations_pair_key_idx";
--> statement-breakpoint
ALTER INDEX "negotiations_opportunity_id_idx" RENAME TO "protocol_negotiations_opportunity_id_idx";
--> statement-breakpoint
ALTER INDEX "negotiations_initiator_intent_idx" RENAME TO "protocol_negotiations_initiator_intent_idx";
--> statement-breakpoint
ALTER INDEX "negotiations_responder_intent_idx" RENAME TO "protocol_negotiations_responder_intent_idx";
--> statement-breakpoint
ALTER INDEX "negotiations_awaiting_user_idx" RENAME TO "protocol_negotiations_awaiting_user_idx";
--> statement-breakpoint
ALTER INDEX "networks_key_unique" RENAME TO "protocol_networks_key_unique";
--> statement-breakpoint
ALTER INDEX "opportunities_status_idx" RENAME TO "protocol_opportunities_status_idx";
--> statement-breakpoint
ALTER INDEX "uniq_opp_outcome_events_idempotency" RENAME TO "protocol_uniq_opp_outcome_events_idempotency";
--> statement-breakpoint
ALTER INDEX "idx_opp_outcome_events_scope" RENAME TO "protocol_idx_opp_outcome_events_scope";
--> statement-breakpoint
-- Some older SQL migrations used Postgres-generated constraint names. Resolve
-- them by their columns, rather than assuming the later Drizzle spelling.
DO $$
DECLARE c record; target_name text;
BEGIN
  FOR c IN
    SELECT con.oid, con.conname, con.contype, tbl.relname AS table_name,
      ref.relname AS reference_name,
      (SELECT string_agg(att.attname, '_' ORDER BY cols.ord)
       FROM unnest(con.conkey) WITH ORDINALITY cols(num, ord)
       JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = cols.num) AS columns_name,
      (SELECT string_agg(att.attname, '_' ORDER BY cols.ord)
       FROM unnest(con.confkey) WITH ORDINALITY cols(num, ord)
       JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = cols.num) AS reference_columns,
      cardinality(con.conkey) AS column_count
    FROM pg_constraint con
    JOIN pg_class tbl ON tbl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    LEFT JOIN pg_class ref ON ref.oid = con.confrelid
    WHERE ns.nspname = 'public' AND tbl.relname IN (
      'protocol_agents', 'protocol_hyde_documents',
      'protocol_intent_networks', 'protocol_intents', 'protocol_negotiation_turns',
      'protocol_negotiations', 'protocol_network_members', 'protocol_networks',
      'protocol_opportunities', 'protocol_opportunity_outcome_events'
    ) AND con.contype IN ('p', 'f')
  LOOP
    target_name := left(CASE WHEN c.contype = 'f'
      THEN c.table_name || '_' || c.columns_name || '_' || c.reference_name || '_' || c.reference_columns || '_fk'
      WHEN c.column_count > 1 THEN c.table_name || '_' || c.columns_name || '_pk'
      ELSE c.table_name || '_pkey' END, 63);
    IF c.conname <> target_name THEN
      EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', c.table_name, c.conname, target_name);
    END IF;
  END LOOP;
END $$;
