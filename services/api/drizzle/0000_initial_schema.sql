CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."agent_type" AS ENUM('external', 'system');--> statement-breakpoint
CREATE TYPE "public"."intent_mode" AS ENUM('REFERENTIAL', 'ATTRIBUTIVE');--> statement-breakpoint
CREATE TYPE "public"."intent_status" AS ENUM('ACTIVE', 'PAUSED', 'FULFILLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."negotiation_outcome" AS ENUM('agreed', 'declined', 'closed');--> statement-breakpoint
CREATE TYPE "public"."negotiation_turn_action" AS ENUM('propose', 'counter', 'accept', 'decline');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('negotiating', 'pending', 'accepted', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('integration', 'discovery_form', 'enrichment');--> statement-breakpoint
CREATE TYPE "public"."speech_act_type" AS ENUM('COMMISSIVE', 'DIRECTIVE');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."participant_type" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"user_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"state" jsonb,
	"revision" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_sessions_user_id_intent_id_pk" PRIMARY KEY("user_id","intent_id")
);
--> statement-breakpoint
CREATE TABLE "protocol_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "agent_type" NOT NULL,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"runtime_kind" text,
	"installation_id" text,
	"runtime_setup_attempt_id" text,
	"notify_on_opportunity" boolean DEFAULT true NOT NULL,
	"daily_summary_enabled" boolean DEFAULT true NOT NULL,
	"handle_negotiations" boolean DEFAULT false NOT NULL,
	"last_daily_summary_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"reference_id" text NOT NULL,
	"config_id" text DEFAULT 'default',
	"name" text,
	"prefix" text,
	"start" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_enabled" boolean DEFAULT false NOT NULL,
	"rate_limit_max" integer,
	"rate_limit_time_window" integer,
	"request_count" integer DEFAULT 0 NOT NULL,
	"remaining" integer,
	"refill_amount" integer,
	"refill_interval" integer,
	"last_refill_at" timestamp with time zone,
	"last_request" timestamp with time zone,
	"metadata" text,
	"permissions" text
);
--> statement-breakpoint
CREATE TABLE "device_code" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text,
	"expires_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp,
	"polling_interval" integer,
	"client_id" text,
	"scope" text,
	CONSTRAINT "device_code_device_code_unique" UNIQUE("device_code")
);
--> statement-breakpoint
CREATE TABLE "protocol_intent_networks" (
	"intent_id" text NOT NULL,
	"network_id" text NOT NULL,
	"relevancy_score" numeric,
	"assignment_metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "protocol_intent_networks_intent_id_network_id_pk" PRIMARY KEY("intent_id","network_id")
);
--> statement-breakpoint
CREATE TABLE "protocol_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"summary" text,
	"is_incognito" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"last_visited_at" timestamp with time zone,
	"first_discovery_succeeded_at" timestamp with time zone,
	"user_id" text NOT NULL,
	"source_id" text,
	"source_type" "source_type",
	"embedding" vector(2000),
	"semantic_entropy" double precision DEFAULT 1,
	"referential_anchor" text,
	"intent_mode" "intent_mode" DEFAULT 'ATTRIBUTIVE',
	"speech_act_type" "speech_act_type",
	"felicity_authority" integer,
	"felicity_sincerity" integer,
	"felicity_clarity" integer,
	"status" "intent_status" DEFAULT 'ACTIVE'
);
--> statement-breakpoint
CREATE TABLE "jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protocol_negotiation_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"negotiation_id" text NOT NULL,
	"turn_index" integer NOT NULL,
	"seat_user_id" text NOT NULL,
	"action" "negotiation_turn_action" NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protocol_negotiations" (
	"id" text PRIMARY KEY NOT NULL,
	"pair_key" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"initiator_user_id" text NOT NULL,
	"initiator_intent_id" text NOT NULL,
	"responder_user_id" text NOT NULL,
	"responder_intent_id" text NOT NULL,
	"awaiting_user_id" text,
	"outcome" "negotiation_outcome",
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protocol_network_members" (
	"network_id" text NOT NULL,
	"user_id" text NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"prompt" text,
	"auto_assign" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "protocol_network_members_network_id_user_id_pk" PRIMARY KEY("network_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "protocol_networks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"key" text,
	"prompt" text,
	"image_url" text,
	"request_status" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"permissions" json DEFAULT '{"joinPolicy":"invite_only","invitationLink":null}'::json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "protocol_opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"detection" jsonb NOT NULL,
	"actors" jsonb NOT NULL,
	"interpretation" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"confidence" numeric NOT NULL,
	"status" "opportunity_status" DEFAULT 'pending' NOT NULL,
	"accepted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "protocol_opportunity_outcome_events" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_user_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"intent_fingerprint" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"network_id" text,
	"action" text NOT NULL,
	"candidate_snapshot" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"dedup_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user_notification_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"preferences" json DEFAULT '{"connectionUpdates":true}'::json,
	"unsubscribe_token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_notification_settings_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "user_notification_settings_unsubscribe_token_unique" UNIQUE("unsubscribe_token")
);
--> statement-breakpoint
CREATE TABLE "user_socials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"key" text,
	"avatar" text,
	"intro" text,
	"location" text,
	"onboarding" json DEFAULT '{}'::json,
	"timezone" text DEFAULT 'UTC',
	"last_weekly_email_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "conversation_metadata" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"conversation_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"participant_type" "participant_type" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hidden_at" timestamp with time zone,
	"last_read_at" timestamp with time zone,
	CONSTRAINT "conversation_participants_conversation_id_participant_id_pk" PRIMARY KEY("conversation_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"dm_pair" text,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"session_id" text,
	"sender_id" text NOT NULL,
	"role" "message_role" NOT NULL,
	"parts" jsonb NOT NULL,
	"metadata" jsonb,
	"extensions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_intent_id_protocol_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."protocol_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_agents" ADD CONSTRAINT "protocol_agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_reference_id_users_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_code" ADD CONSTRAINT "device_code_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_intent_networks" ADD CONSTRAINT "protocol_intent_networks_intent_id_protocol_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."protocol_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_intent_networks" ADD CONSTRAINT "protocol_intent_networks_network_id_protocol_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."protocol_networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_intents" ADD CONSTRAINT "protocol_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_negotiation_turns" ADD CONSTRAINT "protocol_negotiation_turns_negotiation_id_protocol_negotiations_id_fk" FOREIGN KEY ("negotiation_id") REFERENCES "public"."protocol_negotiations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_negotiation_turns" ADD CONSTRAINT "protocol_negotiation_turns_seat_user_id_users_id_fk" FOREIGN KEY ("seat_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_negotiations" ADD CONSTRAINT "protocol_negotiations_opportunity_id_protocol_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."protocol_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_negotiations" ADD CONSTRAINT "protocol_negotiations_initiator_user_id_users_id_fk" FOREIGN KEY ("initiator_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_negotiations" ADD CONSTRAINT "protocol_negotiations_initiator_intent_id_protocol_intents_id_fk" FOREIGN KEY ("initiator_intent_id") REFERENCES "public"."protocol_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_negotiations" ADD CONSTRAINT "protocol_negotiations_responder_user_id_users_id_fk" FOREIGN KEY ("responder_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_negotiations" ADD CONSTRAINT "protocol_negotiations_responder_intent_id_protocol_intents_id_fk" FOREIGN KEY ("responder_intent_id") REFERENCES "public"."protocol_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_negotiations" ADD CONSTRAINT "protocol_negotiations_awaiting_user_id_users_id_fk" FOREIGN KEY ("awaiting_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_network_members" ADD CONSTRAINT "protocol_network_members_network_id_protocol_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."protocol_networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_network_members" ADD CONSTRAINT "protocol_network_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_opportunities" ADD CONSTRAINT "protocol_opportunities_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_opportunity_outcome_events" ADD CONSTRAINT "protocol_opportunity_outcome_events_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD CONSTRAINT "user_notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_socials" ADD CONSTRAINT "user_socials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_metadata" ADD CONSTRAINT "conversation_metadata_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "protocol_agents_owner_id_idx" ON "protocol_agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "protocol_agents_type_idx" ON "protocol_agents" USING btree ("type");--> statement-breakpoint
CREATE INDEX "protocol_agents_last_seen_at_idx" ON "protocol_agents" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_uniq_agents_hermes_installation" ON "protocol_agents" USING btree ("owner_id","runtime_kind","installation_id") WHERE "protocol_agents"."type" = 'external' AND "protocol_agents"."runtime_kind" = 'hermes' AND "protocol_agents"."installation_id" IS NOT NULL AND "protocol_agents"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_uniq_agents_selected_negotiation_executor" ON "protocol_agents" USING btree ("owner_id") WHERE "protocol_agents"."type" = 'external' AND "protocol_agents"."handle_negotiations" = true AND "protocol_agents"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "device_code_user_code_idx" ON "device_code" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "protocol_intent_networks_network_id_idx" ON "protocol_intent_networks" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX "protocol_embeddingIndex" ON "protocol_intents" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_negotiation_turns_negotiation_turn_idx" ON "protocol_negotiation_turns" USING btree ("negotiation_id","turn_index");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_negotiations_pair_key_idx" ON "protocol_negotiations" USING btree ("pair_key");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_negotiations_opportunity_id_idx" ON "protocol_negotiations" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "protocol_negotiations_initiator_intent_idx" ON "protocol_negotiations" USING btree ("initiator_intent_id");--> statement-breakpoint
CREATE INDEX "protocol_negotiations_responder_intent_idx" ON "protocol_negotiations" USING btree ("responder_intent_id");--> statement-breakpoint
CREATE INDEX "protocol_negotiations_awaiting_user_idx" ON "protocol_negotiations" USING btree ("awaiting_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_networks_key_unique" ON "protocol_networks" USING btree ("key");--> statement-breakpoint
CREATE INDEX "protocol_opportunities_status_idx" ON "protocol_opportunities" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_uniq_opp_outcome_events_idempotency" ON "protocol_opportunity_outcome_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "protocol_idx_opp_outcome_events_scope" ON "protocol_opportunity_outcome_events" USING btree ("recipient_user_id","intent_id","intent_fingerprint");--> statement-breakpoint
CREATE INDEX "idx_user_socials_user_id" ON "user_socials" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_user_socials_user_label" ON "user_socials" USING btree ("user_id","label") WHERE "user_socials"."label" <> 'custom';--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_key_unique" ON "users" USING btree ("key");--> statement-breakpoint
CREATE INDEX "conversation_participants_participant_id_idx" ON "conversation_participants" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "conversation_participants_conversation_id_idx" ON "conversation_participants" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_sessions_conversation_started_idx" ON "conversation_sessions" USING btree ("conversation_id","started_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_dm_pair_idx" ON "conversations" USING btree ("dm_pair");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "messages_sender_id_idx" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_intent_created_at_idx" ON "messages" USING btree ("conversation_id",("metadata"->>'intentId'),"created_at","id");--> statement-breakpoint
CREATE INDEX "messages_session_id_created_at_idx" ON "messages" USING btree ("session_id","created_at","id");