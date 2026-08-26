-- Question retirement: the pool_discovery generator (discriminator mining +
-- deterministic synthesis, IND-416/417/418/419/421) is removed. It fed one
-- blind QuestionerAgent that never saw the negotiation it was asking about —
-- the personal agent (IS-A) is now the only thing that authors questions
-- (docs/plans/2026-08-17-personal-agent-authored-questions.md). Void the
-- pending pool_discovery rows it left behind: nothing mines new discriminators,
-- claims new pushes, or applies new pool-ranking adjustments any more.
--
-- Same shape as 0127/0132/0136 (retired discovery/uptake/chat generators):
-- dismissal, not deletion, with the auditable `voidedReason = 'retired_mode'`
-- marker. Answered and already-dismissed pool_discovery rows keep their state
-- and history; this targets `status = 'pending'` only, which also makes the
-- migration idempotent.
UPDATE questions
SET
  status = 'dismissed',
  detection = jsonb_set(detection, '{voidedReason}', '"retired_mode"'::jsonb, true)
WHERE detection->>'mode' = 'pool_discovery'
  AND status = 'pending';

-- The proactive pool-push claim/delivery ledger has no future writer: drop
-- its expression indexes along with the write path.
DROP INDEX IF EXISTS questions_pool_push_recipient_intent_cycle_uniq;
DROP INDEX IF EXISTS questions_pool_push_recipient_claimed_at_idx;
