-- `conversations.persona` labelled which in-process H2A agent loop owned a
-- conversation. Every one of those loops is gone: the surviving writers (H2H
-- DMs, agent DMs, negotiation conversations) all left the column at 'none', and
-- listings key off participant topology instead.

ALTER TABLE "conversations" DROP COLUMN IF EXISTS "persona";
