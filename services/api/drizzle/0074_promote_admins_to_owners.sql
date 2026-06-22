-- Promote all admin members to owners (dropping the admin tier)
UPDATE "network_members"
SET "permissions" = ARRAY['owner'],
    "updated_at" = NOW()
WHERE 'admin' = ANY("permissions");
