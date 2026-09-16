ALTER TABLE "protocol_agents" RENAME TO "agents";
--> statement-breakpoint
ALTER TABLE "protocol_intent_networks" RENAME TO "intent_networks";
--> statement-breakpoint
ALTER TABLE "protocol_intents" RENAME TO "intents";
--> statement-breakpoint
ALTER TABLE "protocol_negotiation_turns" RENAME TO "negotiation_turns";
--> statement-breakpoint
ALTER TABLE "protocol_negotiations" RENAME TO "negotiations";
--> statement-breakpoint
ALTER TABLE "protocol_network_members" RENAME TO "network_members";
--> statement-breakpoint
ALTER TABLE "protocol_networks" RENAME TO "networks";
--> statement-breakpoint
ALTER TABLE "protocol_opportunities" RENAME TO "opportunities";
--> statement-breakpoint
ALTER TABLE "protocol_opportunity_outcome_events" RENAME TO "opportunity_outcome_events";
--> statement-breakpoint
ALTER INDEX "protocol_agents_owner_id_idx" RENAME TO "agents_owner_id_idx";
--> statement-breakpoint
ALTER INDEX "protocol_agents_type_idx" RENAME TO "agents_type_idx";
--> statement-breakpoint
ALTER INDEX "protocol_agents_last_seen_at_idx" RENAME TO "agents_last_seen_at_idx";
--> statement-breakpoint
ALTER INDEX "protocol_uniq_agents_hermes_installation" RENAME TO "uniq_agents_hermes_installation";
--> statement-breakpoint
ALTER INDEX "protocol_uniq_agents_selected_negotiation_executor" RENAME TO "uniq_agents_selected_negotiation_executor";
--> statement-breakpoint
ALTER INDEX "protocol_intent_networks_network_id_idx" RENAME TO "intent_networks_network_id_idx";
--> statement-breakpoint
ALTER INDEX "protocol_embeddingIndex" RENAME TO "embeddingIndex";
--> statement-breakpoint
ALTER INDEX "protocol_negotiation_turns_negotiation_turn_idx" RENAME TO "negotiation_turns_negotiation_turn_idx";
--> statement-breakpoint
ALTER INDEX "protocol_negotiations_pair_key_idx" RENAME TO "negotiations_pair_key_idx";
--> statement-breakpoint
ALTER INDEX "protocol_negotiations_opportunity_id_idx" RENAME TO "negotiations_opportunity_id_idx";
--> statement-breakpoint
ALTER INDEX "protocol_negotiations_initiator_intent_idx" RENAME TO "negotiations_initiator_intent_idx";
--> statement-breakpoint
ALTER INDEX "protocol_negotiations_responder_intent_idx" RENAME TO "negotiations_responder_intent_idx";
--> statement-breakpoint
ALTER INDEX "protocol_negotiations_awaiting_user_idx" RENAME TO "negotiations_awaiting_user_idx";
--> statement-breakpoint
ALTER INDEX "protocol_networks_key_unique" RENAME TO "networks_key_unique";
--> statement-breakpoint
ALTER INDEX "protocol_opportunities_status_idx" RENAME TO "opportunities_status_idx";
--> statement-breakpoint
ALTER INDEX "protocol_uniq_opp_outcome_events_idempotency" RENAME TO "uniq_opp_outcome_events_idempotency";
--> statement-breakpoint
ALTER INDEX "protocol_idx_opp_outcome_events_scope" RENAME TO "idx_opp_outcome_events_scope";
--> statement-breakpoint
-- Constraint names still carry the prefixed table. Rebuild them from the
-- current table and referenced table names, including agent_sessions whose
-- intent FK was minted after the prefix landed.
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
      'agents', 'intent_networks', 'intents', 'negotiation_turns',
      'negotiations', 'network_members', 'networks',
      'opportunities', 'opportunity_outcome_events', 'agent_sessions'
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
