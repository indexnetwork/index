-- Repair system-agent setup after the initial agent-registry rollout.
-- Ensures the three admin/system users exist, system agents exist, and
-- completed users receive the required global system-agent permissions even
-- when earlier rows were partial.

INSERT INTO users (id, email, email_verified, name, onboarding, timezone, is_ghost, created_at, updated_at)
VALUES
  (gen_random_uuid()::text, 'yanki@index.network', true, 'Yanki', '{}'::json, 'UTC', false, now(), now()),
  (gen_random_uuid()::text, 'seref@index.network', true, 'Seref', '{}'::json, 'UTC', false, now(), now()),
  (gen_random_uuid()::text, 'seren@index.network', true, 'Seren', '{}'::json, 'UTC', false, now(), now())
ON CONFLICT (email) DO NOTHING;

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

WITH eligible_users AS (
  SELECT u.id
  FROM users u
  WHERE u.deleted_at IS NULL
    AND COALESCE(u.is_ghost, false) = false
    AND (u.onboarding::jsonb ->> 'completedAt') IS NOT NULL
),
required_actions(action) AS (
  VALUES
    ('manage:profile'),
    ('manage:intents'),
    ('manage:networks'),
    ('manage:contacts'),
    ('manage:negotiations')
),
missing_chat_users AS (
  SELECT u.id
  FROM eligible_users u
  WHERE EXISTS (
    SELECT 1 FROM agents a WHERE a.id = '00000000-0000-0000-0000-000000000001'
  )
    AND EXISTS (
      SELECT 1
      FROM required_actions ra
      WHERE NOT EXISTS (
        SELECT 1
        FROM agent_permissions ap
        WHERE ap.agent_id = '00000000-0000-0000-0000-000000000001'
          AND ap.user_id = u.id
          AND ap.scope = 'global'
          AND ra.action = ANY(ap.actions)
      )
    )
)
INSERT INTO agent_permissions (id, agent_id, user_id, scope, actions)
SELECT
  gen_random_uuid()::text,
  '00000000-0000-0000-0000-000000000001',
  u.id,
  'global',
  ARRAY['manage:profile', 'manage:intents', 'manage:networks', 'manage:contacts', 'manage:negotiations']
FROM missing_chat_users u;

WITH eligible_users AS (
  SELECT u.id
  FROM users u
  WHERE u.deleted_at IS NULL
    AND COALESCE(u.is_ghost, false) = false
    AND (u.onboarding::jsonb ->> 'completedAt') IS NOT NULL
),
missing_negotiator_users AS (
  SELECT u.id
  FROM eligible_users u
  WHERE EXISTS (
    SELECT 1 FROM agents a WHERE a.id = '00000000-0000-0000-0000-000000000002'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM agent_permissions ap
      WHERE ap.agent_id = '00000000-0000-0000-0000-000000000002'
        AND ap.user_id = u.id
        AND ap.scope = 'global'
        AND 'manage:negotiations' = ANY(ap.actions)
    )
)
INSERT INTO agent_permissions (id, agent_id, user_id, scope, actions)
SELECT
  gen_random_uuid()::text,
  '00000000-0000-0000-0000-000000000002',
  u.id,
  'global',
  ARRAY['manage:negotiations']
FROM missing_negotiator_users u;
