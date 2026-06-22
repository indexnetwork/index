-- Seed two system agents with well-known UUIDs.
-- Canonical ownership stays with yanki@index.network for now; the broader
-- admin/system-user set is handled at the application level.

WITH system_owner AS (
  SELECT id
  FROM users
  WHERE lower(email) = 'yanki@index.network'
  LIMIT 1
)
INSERT INTO agents (id, owner_id, name, description, type, status, metadata)
SELECT
  seeded.id,
  system_owner.id,
  seeded.name,
  seeded.description,
  'system',
  'active',
  '{}'::jsonb
FROM system_owner
CROSS JOIN (
  VALUES
    (
      '00000000-0000-0000-0000-000000000001',
      'Index Chat Orchestrator',
      'Built-in chat agent that manages profiles, intents, networks, contacts, and negotiations on behalf of users.'
    ),
    (
      '00000000-0000-0000-0000-000000000002',
      'Index Negotiator',
      'Built-in agent that handles negotiation turns when no external agent responds.'
    )
) AS seeded(id, name, description)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_permissions (id, agent_id, user_id, scope, actions)
SELECT
  gen_random_uuid()::text,
  '00000000-0000-0000-0000-000000000001',
  u.id,
  'global',
  ARRAY['manage:profile', 'manage:intents', 'manage:networks', 'manage:contacts', 'manage:negotiations']
FROM users u
WHERE u.deleted_at IS NULL
  AND u.is_ghost = false
  AND (u.onboarding::jsonb ->> 'completedAt') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM agents a WHERE a.id = '00000000-0000-0000-0000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM agent_permissions ap
    WHERE ap.agent_id = '00000000-0000-0000-0000-000000000001'
      AND ap.user_id = u.id
      AND ap.scope = 'global'
  );

INSERT INTO agent_permissions (id, agent_id, user_id, scope, actions)
SELECT
  gen_random_uuid()::text,
  '00000000-0000-0000-0000-000000000002',
  u.id,
  'global',
  ARRAY['manage:negotiations']
FROM users u
WHERE u.deleted_at IS NULL
  AND u.is_ghost = false
  AND (u.onboarding::jsonb ->> 'completedAt') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM agents a WHERE a.id = '00000000-0000-0000-0000-000000000002'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM agent_permissions ap
    WHERE ap.agent_id = '00000000-0000-0000-0000-000000000002'
      AND ap.user_id = u.id
      AND ap.scope = 'global'
  );
