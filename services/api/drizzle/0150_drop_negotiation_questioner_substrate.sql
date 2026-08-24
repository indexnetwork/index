-- The retired negotiation consultation state has no executable successor.
-- Terminalize those old tasks before removing the enum member and settlement index.
UPDATE tasks
SET state = 'canceled', updated_at = NOW()
WHERE state = 'input_required';

DROP INDEX IF EXISTS tasks_negotiation_continuation_settlement_uniq;
DROP INDEX IF EXISTS questions_negotiation_provenance_uniq;

ALTER TYPE task_state RENAME TO task_state_legacy;
CREATE TYPE task_state AS ENUM (
  'submitted', 'working', 'completed', 'failed', 'canceled', 'rejected',
  'auth_required', 'waiting_for_agent', 'claimed', 'paused'
);
ALTER TABLE tasks
  ALTER COLUMN state DROP DEFAULT,
  ALTER COLUMN state TYPE task_state USING state::text::task_state,
  ALTER COLUMN state SET DEFAULT 'submitted';
DROP TYPE task_state_legacy;
