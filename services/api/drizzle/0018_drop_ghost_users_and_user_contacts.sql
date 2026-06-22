-- Step 1: Collect ghost user IDs
CREATE TEMP TABLE ghost_ids AS
SELECT id FROM "users" WHERE "is_ghost" = true;

-- Step 2: Delete all rows referencing ghost users
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_message_metadata') THEN
    DELETE FROM "chat_message_metadata" WHERE "message_id" IN (
      SELECT "id" FROM "chat_messages" WHERE "session_id" IN (
        SELECT "id" FROM "chat_sessions" WHERE "user_id" IN (SELECT id FROM ghost_ids)
      )
    );
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_messages') THEN
    DELETE FROM "chat_messages" WHERE "session_id" IN (
      SELECT "id" FROM "chat_sessions" WHERE "user_id" IN (SELECT id FROM ghost_ids)
    );
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_session_metadata') THEN
    DELETE FROM "chat_session_metadata" WHERE "session_id" IN (
      SELECT "id" FROM "chat_sessions" WHERE "user_id" IN (SELECT id FROM ghost_ids)
    );
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_sessions') THEN
    DELETE FROM "chat_sessions" WHERE "user_id" IN (SELECT id FROM ghost_ids);
  END IF;
END $$;
DELETE FROM "intent_indexes" WHERE "intent_id" IN (
  SELECT "id" FROM "intents" WHERE "user_id" IN (SELECT id FROM ghost_ids)
);
DELETE FROM "intents" WHERE "user_id" IN (SELECT id FROM ghost_ids);
DELETE FROM "index_members" WHERE "user_id" IN (SELECT id FROM ghost_ids);
DELETE FROM "personal_indexes" WHERE "user_id" IN (SELECT id FROM ghost_ids);
DELETE FROM "files" WHERE "user_id" IN (SELECT id FROM ghost_ids);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hidden_conversations') THEN
    DELETE FROM "hidden_conversations" WHERE "user_id" IN (SELECT id FROM ghost_ids);
  END IF;
END $$;
DELETE FROM "hyde_documents" WHERE "source_type" = 'profile' AND "source_id" IN (SELECT id FROM ghost_ids);
DELETE FROM "user_profiles" WHERE "user_id" IN (SELECT id FROM ghost_ids);
DELETE FROM "user_notification_settings" WHERE "user_id" IN (SELECT id FROM ghost_ids);
DELETE FROM "opportunities" WHERE "id" IN (
  SELECT "id" FROM "opportunities" WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements("actors") AS actor
    WHERE actor->>'userId' IN (SELECT id FROM ghost_ids)
  )
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_contacts') THEN
    DELETE FROM "user_contacts" WHERE "owner_id" IN (SELECT id FROM ghost_ids) OR "user_id" IN (SELECT id FROM ghost_ids);
  END IF;
END $$;

-- Step 3: Delete ghost users
DELETE FROM "users" WHERE "is_ghost" = true;

-- Step 4: Drop user_contacts table
DROP TABLE IF EXISTS "user_contacts";

-- Step 5: Drop contact source enum
DROP TYPE IF EXISTS "contact_source";

-- Cleanup
DROP TABLE IF EXISTS ghost_ids;
