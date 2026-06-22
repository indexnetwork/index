-- Delete any existing webhook transport rows. No personal agent currently
-- depends on this transport; see spec 2026-04-17-personal-agent-notifications-design.md.
DELETE FROM agent_transports WHERE channel = 'webhook';

-- Drop the 'webhook' label from transport_channel by rebuilding the enum.
-- PostgreSQL doesn't support DROP VALUE on a type; rename + recreate + swap.
ALTER TYPE transport_channel RENAME TO transport_channel_old;
CREATE TYPE transport_channel AS ENUM ('mcp');
ALTER TABLE agent_transports
  ALTER COLUMN channel TYPE transport_channel
  USING channel::text::transport_channel;
DROP TYPE transport_channel_old;
