-- Migrate existing permissions from granular to owner/member model
-- This migration updates all index_members permissions to use the new simplified model

-- Update members with 'owner' permission (keep as owner)
UPDATE index_members
SET permissions = ARRAY['owner']
WHERE 'owner' = ANY(permissions);

-- Update members with any granular permissions but not owner (convert to member)
UPDATE index_members
SET permissions = ARRAY['member']
WHERE 
  ('can-read' = ANY(permissions) OR 
   'can-write' = ANY(permissions) OR 
   'can-write-intents' = ANY(permissions) OR 
   'can-discover' = ANY(permissions) OR
   'can-read-intents' = ANY(permissions))
  AND NOT ('owner' = ANY(permissions));

-- Update any remaining members with empty or unknown permissions to member
UPDATE index_members
SET permissions = ARRAY['member']
WHERE 
  permissions = ARRAY[]::text[] OR 
  (NOT ('owner' = ANY(permissions)) AND NOT ('member' = ANY(permissions)));

