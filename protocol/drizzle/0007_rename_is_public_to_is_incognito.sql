-- Rename is_public column to is_incognito and flip the logic
-- First, add the new column with opposite default
ALTER TABLE "intents" ADD COLUMN "is_incognito" boolean DEFAULT false NOT NULL;

-- Update existing data: if is_public was true, is_incognito should be false, and vice versa
UPDATE "intents" SET "is_incognito" = NOT "is_public";

-- Drop the old column
ALTER TABLE "intents" DROP COLUMN "is_public"; 