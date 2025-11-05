-- Add OWNER_APPROVE and OWNER_DENY to connection_action enum
DO $$ BEGIN
  ALTER TYPE "public"."connection_action" ADD VALUE IF NOT EXISTS 'OWNER_APPROVE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "public"."connection_action" ADD VALUE IF NOT EXISTS 'OWNER_DENY';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Note: The requireApproval field is added as part of the JSON permissions column
-- No SQL alteration needed since it's a flexible JSON structure
-- The schema.ts default will automatically include requireApproval: false for new indexes

