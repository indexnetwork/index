-- The agent DM is one conversation per owner carrying every signal's questions,
-- tagged in `metadata->>'intentId'`. Every read of it filters on that tag, so
-- the tag is part of the index rather than a scan over the whole thread.

CREATE INDEX "messages_conversation_intent_created_at_idx"
  ON "messages" ("conversation_id", ("metadata"->>'intentId'), "created_at", "id");
