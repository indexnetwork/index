-- Shadow-migrate legacy webhooks into the agent registry.
-- Runtime delivery still uses the legacy webhooks table for now, so this
-- migration is additive only.

DO $$
BEGIN
  IF to_regclass('public.webhooks') IS NULL THEN
    RAISE NOTICE 'Skipping webhook migration because public.webhooks does not exist';
    RETURN;
  END IF;

  INSERT INTO agents (id, owner_id, name, description, type, status, metadata, created_at, updated_at)
  SELECT
    w.id,
    w.user_id,
    COALESCE(NULLIF(BTRIM(w.description), ''), 'Migrated webhook ' || LEFT(w.url, 48)),
    w.description,
    'personal',
    CASE WHEN w.active THEN 'active' ELSE 'inactive' END,
    jsonb_build_object(
      'migratedFrom', 'webhook',
      'legacyWebhookId', w.id,
      'legacyEvents', to_jsonb(w.events)
    ),
    w.created_at,
    w.updated_at
  FROM public.webhooks w
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO agent_transports (id, agent_id, channel, config, priority, active, failure_count, created_at, updated_at)
  SELECT
    'webhook-transport:' || w.id,
    w.id,
    'webhook',
    jsonb_build_object(
      'url', w.url,
      'secret', w.secret,
      'legacyWebhookId', w.id,
      'legacyEvents', to_jsonb(w.events)
    ),
    0,
    w.active,
    w.failure_count,
    w.created_at,
    w.updated_at
  FROM public.webhooks w
  ON CONFLICT (id) DO NOTHING;

  -- Only backfill permissions when the legacy webhook subscribed exclusively to
  -- negotiation events; that mapping is the only unambiguous one today.
  INSERT INTO agent_permissions (id, agent_id, user_id, scope, scope_id, actions, created_at)
  SELECT
    'webhook-permission:' || w.id || ':negotiations',
    w.id,
    w.user_id,
    'global',
    NULL,
    ARRAY['manage:negotiations'],
    w.created_at
  FROM public.webhooks w
  WHERE EXISTS (
    SELECT 1
    FROM unnest(w.events) AS evt
    WHERE evt LIKE 'negotiation.%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(w.events) AS evt
    WHERE evt NOT LIKE 'negotiation.%'
  )
  ON CONFLICT (id) DO NOTHING;
END $$;
