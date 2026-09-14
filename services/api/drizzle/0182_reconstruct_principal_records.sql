-- Preserve the exact displayed question, including questions written only to a
-- checkpoint by the notification simulator. Existing canonical messages win.
DO $$
DECLARE
  saved record;
  question jsonb;
  timeline record;
  timeline_id text;
BEGIN
  FOR saved IN SELECT * FROM agent_sessions WHERE state IS NOT NULL LOOP
    question := saved.state #> '{inbox,question}';
    IF question->>'id' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM messages
      WHERE conversation_id = saved.conversation_id
        AND metadata->>'intentId' = saved.intent_id
        AND metadata #>> '{principalMessage,kind}' = 'question'
        AND metadata #>> '{principalMessage,questionId}' = question->>'id'
    ) THEN
      SELECT * INTO timeline FROM conversation_sessions
        WHERE conversation_id = saved.conversation_id
        ORDER BY last_message_at DESC, started_at DESC, id DESC LIMIT 1;
      IF timeline.id IS NULL OR saved.updated_at - timeline.last_message_at > interval '24 hours' THEN
        timeline_id := 'question-cutover-session:' || (question->>'id');
        INSERT INTO conversation_sessions (id, conversation_id, started_at, last_message_at)
          VALUES (timeline_id, saved.conversation_id, saved.updated_at, saved.updated_at);
      ELSE
        timeline_id := timeline.id;
        UPDATE conversation_sessions SET
          started_at = least(started_at, saved.updated_at),
          last_message_at = greatest(last_message_at, saved.updated_at)
          WHERE id = timeline_id;
      END IF;
      INSERT INTO messages (id, conversation_id, session_id, sender_id, role, parts, metadata, created_at)
      VALUES (
        'question-cutover:' || (question->>'id'), saved.conversation_id, timeline_id, 'system-agent', 'agent',
        jsonb_build_array(jsonb_build_object('kind', 'text', 'text', question->>'question')),
        jsonb_build_object('intentId', saved.intent_id, 'principalMessage', jsonb_strip_nulls(jsonb_build_object(
          'kind', 'question', 'questionId', question->>'id', 'options', question->'options',
          'scope', question->'scope', 'matches', coalesce(question->'matches', '[]'::jsonb)
        ))), saved.updated_at
      );
      UPDATE conversations SET last_message_at = greatest(last_message_at, saved.updated_at),
        updated_at = greatest(updated_at, saved.updated_at) WHERE id = saved.conversation_id;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- Unanswered questions other than the exact displayed one were canceled by the
-- old runtime. Record that fact once so reconstruction cannot resurrect them.
INSERT INTO messages (id, conversation_id, sender_id, role, parts, metadata, created_at)
SELECT DISTINCT ON (q.metadata #>> '{principalMessage,questionId}')
  'question-retirement:' || (q.metadata #>> '{principalMessage,questionId}'),
  s.conversation_id, 'system-agent', 'agent', '[]'::jsonb,
  jsonb_build_object('intentId', s.intent_id, 'retiredQuestionId', q.metadata #>> '{principalMessage,questionId}'),
  s.updated_at
FROM agent_sessions s JOIN messages q ON q.conversation_id = s.conversation_id
  AND q.metadata->>'intentId' = s.intent_id
WHERE s.state IS NOT NULL AND q.role = 'agent' AND q.sender_id = 'system-agent'
  AND q.metadata #>> '{principalMessage,kind}' = 'question'
  AND q.metadata #>> '{principalMessage,questionId}' IS NOT NULL
  AND (q.metadata #>> '{principalMessage,questionId}') IS DISTINCT FROM (s.state #>> '{inbox,question,id}')
  AND NOT EXISTS (
    SELECT 1 FROM messages a WHERE a.conversation_id = s.conversation_id
      AND a.metadata->>'intentId' = s.intent_id AND a.metadata #>> '{principalMessage,kind}' = 'answer'
      AND a.metadata #>> '{principalMessage,questionId}' = q.metadata #>> '{principalMessage,questionId}'
  )
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- Old review notes are evidence, not complete delegations or new authority.
-- A null sourceMessageId keeps them in H2A context but cannot authorize A2A.
INSERT INTO messages (id, conversation_id, sender_id, role, parts, metadata, created_at)
SELECT 'delegation-cutover:' || s.user_id || ':' || s.intent_id || ':' || (m->>'opportunityId'),
  s.conversation_id, 'system-agent', 'agent', '[]'::jsonb,
  jsonb_build_object('intentId', s.intent_id, 'principalDelegation', jsonb_build_object(
    'opportunityId', m->>'opportunityId', 'brief', m->>'reviewNote', 'sourceMessageId', NULL
  )), s.updated_at
FROM agent_sessions s CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.state->'matches', '[]'::jsonb)) m
WHERE nullif(btrim(m->>'reviewNote'), '') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM protocol_negotiations n WHERE n.opportunity_id = m->>'opportunityId'
      AND (n.initiator_user_id = s.user_id AND n.initiator_intent_id = s.intent_id
        OR n.responder_user_id = s.user_id AND n.responder_intent_id = s.intent_id)
  )
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE "agent_sessions" DROP COLUMN "state";
--> statement-breakpoint
ALTER TABLE "agent_sessions" DROP COLUMN "revision";
