-- Convert intent_stakes.intents from text[] to uuid[]
-- This enables index usage and eliminates type casting overhead

-- Step 1: Alter column type to uuid[]
ALTER TABLE "intent_stakes" 
  ALTER COLUMN "intents" 
  TYPE uuid[] 
  USING "intents"::uuid[];

-- Step 2: Add GIN index for fast array containment queries
CREATE INDEX IF NOT EXISTS "intent_stakes_intents_gin" 
  ON "intent_stakes" 
  USING GIN ("intents");

-- Step 3: Add index on user_id for faster filtering
CREATE INDEX IF NOT EXISTS "intents_user_id_idx" 
  ON "intents" ("user_id") 
  WHERE "archived_at" IS NULL;

