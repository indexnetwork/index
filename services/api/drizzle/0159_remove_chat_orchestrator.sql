-- Remove the retired orchestrator chat persona and the Index Chat Orchestrator
-- system agent. The in-process H2A loop is gone; nothing writes either value.

-- 1. Relabel remaining conversations. The column default is already 'none'
--    (migration 0128). Historical orchestrator rows kept the old value so
--    history was not rewritten; with the persona gone they use the same
--    sentinel as DMs and negotiation shells.
UPDATE "conversations" SET "persona" = 'none' WHERE "persona" = 'orchestrator';

--> statement-breakpoint
-- 2. Delete the seeded system agent. Permissions, transports, test messages,
--    and negotiator memories cascade. Delivery rows that named it go to NULL.
DELETE FROM "agents" WHERE "id" = '00000000-0000-0000-0000-000000000001';
