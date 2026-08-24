-- Question retirement, step 2: the pool-discriminator mining generator is
-- removed, along with its push cycle and answer-reaction chaining
-- (docs/plans/2026-08-18-conversational-questions.md, "Retirements"). Void the
-- pending pool_discovery rows it left behind: nothing mints, delivers, chains,
-- or reacts to them any more.
--
-- Same shape as 0127/0132: dismissal, not deletion, with the auditable
-- `voidedReason = 'retired_mode'` marker. Answered pool rows keep their state
-- and history. Targeting `status = 'pending'` only makes this idempotent.

UPDATE questions
SET
  status = 'dismissed',
  detection = jsonb_set(detection, '{voidedReason}', '"retired_mode"'::jsonb, true)
WHERE detection->>'mode' = 'pool_discovery'
  AND status = 'pending';
