-- Migration to convert linkPermissions from text[] array to jsonb object format
-- This migration converts existing linkPermissions arrays to the new format: {permissions: [...], code: uuid}

-- First, let's see what we're working with
-- SELECT id, title, link_permissions FROM indexes WHERE link_permissions IS NOT NULL;

-- Step 1: Create a temporary column with jsonb type
ALTER TABLE indexes ADD COLUMN link_permissions_new jsonb DEFAULT NULL;

-- Step 2: Convert existing non-empty arrays to new object format
UPDATE indexes 
SET link_permissions_new = jsonb_build_object(
  'permissions', array_to_json(link_permissions),
  'code', gen_random_uuid()::text
)
WHERE link_permissions IS NOT NULL 
  AND array_length(link_permissions, 1) > 0;

-- Step 3: Drop the old column and rename the new one
ALTER TABLE indexes DROP COLUMN link_permissions;
ALTER TABLE indexes RENAME COLUMN link_permissions_new TO link_permissions;

-- Verify the migration
-- SELECT id, title, link_permissions FROM indexes WHERE link_permissions IS NOT NULL; 