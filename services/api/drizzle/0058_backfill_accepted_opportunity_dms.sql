-- Backfill DM conversations for accepted opportunities that have no conversation yet.
--
-- Opportunities store actors as JSONB array of { "userId": "...", "role": "...", ... }.
-- We pair every non-introducer actor combination (LEAST/GREATEST ensures the dm_pair
-- string is sorted the same way as ConversationDatabaseAdapter.getOrCreateDM()).
-- ON CONFLICT (dm_pair) skips pairs that already have a conversation.
-- conversation_participants uses (conversation_id, participant_id) as primary key,
-- so the UNION ALL insert is safe for newly-created conversations only.

--> statement-breakpoint
WITH accepted_pairs AS (
  SELECT DISTINCT
    LEAST(a1.actor->>'userId', a2.actor->>'userId')    AS user_a,
    GREATEST(a1.actor->>'userId', a2.actor->>'userId') AS user_b
  FROM opportunities o,
       jsonb_array_elements(o.actors) WITH ORDINALITY AS a1(actor, i),
       jsonb_array_elements(o.actors) WITH ORDINALITY AS a2(actor, j)
  WHERE o.status = 'accepted'
    AND a1.i < a2.j
    AND COALESCE(a1.actor->>'role', '') <> 'introducer'
    AND COALESCE(a2.actor->>'role', '') <> 'introducer'
    AND a1.actor->>'userId' IS NOT NULL
    AND a2.actor->>'userId' IS NOT NULL
    AND a1.actor->>'userId' <> a2.actor->>'userId'
),
new_convs AS (
  INSERT INTO conversations (id, dm_pair, created_at, updated_at)
  SELECT gen_random_uuid(), user_a || ':' || user_b, now(), now()
  FROM accepted_pairs
  ON CONFLICT (dm_pair) DO NOTHING
  RETURNING id, dm_pair
)
INSERT INTO conversation_participants (conversation_id, participant_id, participant_type)
SELECT id, split_part(dm_pair, ':', 1), 'user' FROM new_convs
UNION ALL
SELECT id, split_part(dm_pair, ':', 2), 'user' FROM new_convs;
