-- Remove manage:negotiations from chat orchestrator permissions.
-- Negotiations are now exclusively handled by the Index Negotiator agent.
UPDATE agent_permissions
SET actions = array_remove(actions, 'manage:negotiations')
WHERE agent_id = '00000000-0000-0000-0000-000000000001'
  AND 'manage:negotiations' = ANY(actions);

-- Add manage:opportunities to chat orchestrator (creates opportunities during discovery).
UPDATE agent_permissions
SET actions = array_append(actions, 'manage:opportunities')
WHERE agent_id = '00000000-0000-0000-0000-000000000001'
  AND NOT ('manage:opportunities' = ANY(actions));

-- Add manage:opportunities to negotiator (transitions opportunity status on accept/reject).
UPDATE agent_permissions
SET actions = array_append(actions, 'manage:opportunities')
WHERE agent_id = '00000000-0000-0000-0000-000000000002'
  AND NOT ('manage:opportunities' = ANY(actions));
