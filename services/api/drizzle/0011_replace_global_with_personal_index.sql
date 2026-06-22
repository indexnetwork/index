-- ============================================================================
-- PHASE 1: Data cleanup (while is_global column still exists)
-- ============================================================================

-- Remove all global index data
DELETE FROM intent_indexes WHERE index_id IN (SELECT id FROM indexes WHERE is_global = true);--> statement-breakpoint
DELETE FROM index_members WHERE index_id IN (SELECT id FROM indexes WHERE is_global = true);--> statement-breakpoint
UPDATE chat_sessions SET index_id = NULL WHERE index_id IN (SELECT id FROM indexes WHERE is_global = true);--> statement-breakpoint
UPDATE integrations SET index_id = NULL WHERE index_id IN (SELECT id FROM indexes WHERE is_global = true);--> statement-breakpoint
DELETE FROM indexes WHERE is_global = true;--> statement-breakpoint

-- Deduplicate intent_indexes before adding PK
DELETE FROM intent_indexes a USING intent_indexes b WHERE a.ctid < b.ctid AND a.intent_id = b.intent_id AND a.index_id = b.index_id;--> statement-breakpoint

-- ============================================================================
-- PHASE 2: DDL changes
-- ============================================================================

DROP INDEX "indexes_is_global_unique";--> statement-breakpoint
ALTER TABLE "intent_indexes" ADD CONSTRAINT "intent_indexes_intent_id_index_id_pk" PRIMARY KEY("intent_id","index_id");--> statement-breakpoint
ALTER TABLE "indexes" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "indexes" ADD CONSTRAINT "indexes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "indexes_is_personal_owner" ON "indexes" USING btree ("is_personal","owner_id") WHERE is_personal = true;--> statement-breakpoint
ALTER TABLE "indexes" DROP COLUMN "is_global";--> statement-breakpoint

-- ============================================================================
-- PHASE 3: Data backfill — create personal indexes for every user
-- ============================================================================

-- Create a personal index for each non-deleted user
INSERT INTO indexes (id, title, prompt, is_personal, owner_id, created_at, updated_at)
SELECT gen_random_uuid(), 'My Network', 'Personal index containing the owner''s imported contacts for network-scoped discovery.', true, u.id, NOW(), NOW()
FROM users u WHERE u.deleted_at IS NULL ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Add owner as member of their personal index
INSERT INTO index_members (index_id, user_id, permissions, auto_assign, created_at, updated_at)
SELECT i.id, i.owner_id, ARRAY['owner'], false, NOW(), NOW()
FROM indexes i WHERE i.is_personal = true ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Add each user's contacts as members of the owner's personal index
INSERT INTO index_members (index_id, user_id, permissions, auto_assign, created_at, updated_at)
SELECT i.id, uc.user_id, ARRAY['contact'], false, NOW(), NOW()
FROM user_contacts uc JOIN indexes i ON i.owner_id = uc.owner_id AND i.is_personal = true
WHERE uc.deleted_at IS NULL ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Link active intents of contacts into the owner's personal index
INSERT INTO intent_indexes (intent_id, index_id, created_at)
SELECT int.id, i.id, NOW()
FROM user_contacts uc
JOIN indexes i ON i.owner_id = uc.owner_id AND i.is_personal = true
JOIN intents int ON int.user_id = uc.user_id AND int.status = 'ACTIVE' AND int.archived_at IS NULL
WHERE uc.deleted_at IS NULL ON CONFLICT DO NOTHING;--> statement-breakpoint

-- ============================================================================
-- PHASE 4: Add CHECK constraint after backfill (all personal indexes now have owner_id)
-- ============================================================================
ALTER TABLE "indexes" ADD CONSTRAINT "personal_owner_check" CHECK (NOT is_personal OR owner_id IS NOT NULL);
