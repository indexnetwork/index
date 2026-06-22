-- One-time backfill: revoke manage:negotiations from all personal-agent owner
-- permission rows. The handle_negotiations column (default false) already
-- matches the new policy. See spec 2026-04-17-personal-agent-notifications-design.md.
UPDATE agent_permissions p
SET actions = array_remove(actions, 'manage:negotiations')
FROM agents a
WHERE a.id = p.agent_id
  AND a.type = 'personal'
  AND 'manage:negotiations' = ANY(p.actions);
