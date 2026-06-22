-- Prevent duplicate owner permission rows for the same (agent, user) when scope = 'global'.
-- Closes a race in reconcileNegotiationsPermission (AgentService) where concurrent toggle
-- requests could both issue revoke-then-grant sequences and end up with two rows.
--
-- Dedupe any pre-existing duplicates before enforcing the constraint. Keep the oldest
-- row per (agent_id, user_id, scope='global') and merge actions from extras into it so
-- no capability is lost.
WITH dupes AS (
  SELECT id,
         agent_id,
         user_id,
         actions,
         ROW_NUMBER() OVER (
           PARTITION BY agent_id, user_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM agent_permissions
  WHERE scope = 'global'
),
merged AS (
  SELECT d.agent_id,
         d.user_id,
         ARRAY(SELECT DISTINCT unnest(array_agg(a))) AS actions
  FROM dupes d,
       LATERAL unnest(d.actions) AS a
  GROUP BY d.agent_id, d.user_id
)
UPDATE agent_permissions p
SET actions = m.actions
FROM dupes d
JOIN merged m ON m.agent_id = d.agent_id AND m.user_id = d.user_id
WHERE d.rn = 1
  AND p.id = d.id;

DELETE FROM agent_permissions
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY agent_id, user_id
             ORDER BY created_at ASC, id ASC
           ) AS rn
    FROM agent_permissions
    WHERE scope = 'global'
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX uniq_agent_permissions_global
  ON agent_permissions (agent_id, user_id)
  WHERE scope = 'global';
