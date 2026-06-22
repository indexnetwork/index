-- Rename tables: indexes → networks, index_members → network_members,
-- personal_indexes → personal_networks, intent_indexes → intent_networks,
-- index_integrations → network_integrations.
-- Also rename index_id columns to network_id where applicable.
-- Uses ALTER TABLE ... RENAME to preserve data.

-- 1. Rename core tables
ALTER TABLE "indexes" RENAME TO "networks";--> statement-breakpoint
ALTER TABLE "index_members" RENAME TO "network_members";--> statement-breakpoint
ALTER TABLE "personal_indexes" RENAME TO "personal_networks";--> statement-breakpoint
ALTER TABLE "intent_indexes" RENAME TO "intent_networks";--> statement-breakpoint
ALTER TABLE "index_integrations" RENAME TO "network_integrations";--> statement-breakpoint

-- 2. Rename index_id → network_id columns
ALTER TABLE "network_members" RENAME COLUMN "index_id" TO "network_id";--> statement-breakpoint
ALTER TABLE "personal_networks" RENAME COLUMN "index_id" TO "network_id";--> statement-breakpoint
ALTER TABLE "intent_networks" RENAME COLUMN "index_id" TO "network_id";--> statement-breakpoint
ALTER TABLE "network_integrations" RENAME COLUMN "index_id" TO "network_id";--> statement-breakpoint

-- 3. Rename indexes (btree/unique) that reference old names
ALTER INDEX "intent_indexes_index_id_idx" RENAME TO "intent_networks_network_id_idx";--> statement-breakpoint
ALTER INDEX "personal_indexes_index_id_unique" RENAME TO "personal_networks_network_id_unique";--> statement-breakpoint

-- 4. Rename primary key constraints
ALTER TABLE "network_members" RENAME CONSTRAINT "index_members_index_id_user_id_pk" TO "network_members_network_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "intent_networks" RENAME CONSTRAINT "intent_indexes_intent_id_index_id_pk" TO "intent_networks_intent_id_network_id_pk";--> statement-breakpoint
ALTER TABLE "personal_networks" RENAME CONSTRAINT "personal_indexes_user_id_pk" TO "personal_networks_user_id_pk";--> statement-breakpoint
ALTER TABLE "network_integrations" RENAME CONSTRAINT "index_integrations_index_id_toolkit_pk" TO "network_integrations_network_id_toolkit_pk";--> statement-breakpoint

-- 5. Rename foreign key constraints
ALTER TABLE "network_members" RENAME CONSTRAINT "index_members_index_id_indexes_id_fk" TO "network_members_network_id_networks_id_fk";--> statement-breakpoint
ALTER TABLE "network_members" RENAME CONSTRAINT "index_members_user_id_users_id_fk" TO "network_members_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "personal_networks" RENAME CONSTRAINT "personal_indexes_user_id_users_id_fk" TO "personal_networks_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "personal_networks" RENAME CONSTRAINT "personal_indexes_index_id_indexes_id_fk" TO "personal_networks_network_id_networks_id_fk";--> statement-breakpoint
ALTER TABLE "intent_networks" RENAME CONSTRAINT "intent_indexes_intent_id_intents_id_fk" TO "intent_networks_intent_id_intents_id_fk";--> statement-breakpoint
ALTER TABLE "intent_networks" RENAME CONSTRAINT "intent_indexes_index_id_indexes_id_fk" TO "intent_networks_network_id_networks_id_fk";--> statement-breakpoint
ALTER TABLE "network_integrations" RENAME CONSTRAINT "index_integrations_index_id_indexes_id_fk" TO "network_integrations_network_id_networks_id_fk";--> statement-breakpoint

-- 6. Update onboarding JSON values for existing rows
UPDATE "users"
SET "onboarding" = jsonb_set("onboarding"::jsonb, '{currentStep}', '"create_network"')
WHERE "onboarding"::jsonb ->> 'currentStep' = 'create_index';--> statement-breakpoint

UPDATE "users"
SET "onboarding" = jsonb_set("onboarding"::jsonb, '{currentStep}', '"join_networks"')
WHERE "onboarding"::jsonb ->> 'currentStep' = 'join_indexes';--> statement-breakpoint

-- Also rename indexId → networkId key in onboarding JSON (if present)
UPDATE "users"
SET "onboarding" = ("onboarding"::jsonb - 'indexId') || jsonb_build_object('networkId', "onboarding"::jsonb -> 'indexId')
WHERE "onboarding"::jsonb ? 'indexId';
