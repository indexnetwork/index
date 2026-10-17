import { z } from 'zod';
import type { Sql } from './db.ts';
import { TraceInputSchema } from './schema.ts';
import type { AgentNote, Seat, TextItem, TraceInput } from './schema.ts';
import { deriveHumanOutcome, scrubNames, validateAgentVerdict } from './sources.ts';

interface NegotiationRow {
  negotiation_id: string;
  outcome: string | null;
  settled_at: Date | null;
  opened_at: Date;
  opportunity_status: string;
  initiator_intent_id: string;
  responder_intent_id: string;
  initiator_user_id: string;
  responder_user_id: string;
  initiator_name: string;
  responder_name: string;
  initiator_intro: string | null;
  responder_intro: string | null;
  initiator_payload: string;
  responder_payload: string;
}

interface MessageRow {
  id: string;
  role: string;
  parts: unknown;
  created_at: Date;
  scoped: boolean;
}

const PartsSchema = z.array(z.object({ kind: z.string(), text: z.string().optional() }));

function messageText(parts: unknown): string {
  const parsed = PartsSchema.safeParse(parts);
  if (!parsed.success) return '';
  return parsed.data.filter((part) => part.kind === 'text').map((part) => part.text ?? '').join('\n').trim();
}

function classifyNote(text: string): AgentNote['kind'] | null {
  if (/^Progress:/i.test(text)) return null;
  if (/^Brief:/i.test(text)) return 'brief';
  if (/^Decision:/i.test(text)) return 'decision';
  if (/^Stall:/i.test(text)) return 'stall';
  return 'other';
}

export interface LoadOptions {
  scrub?: boolean;
}

async function loadMessages(sql: Sql, intentId: string, opportunityId: string) {
  return sql<MessageRow[]>`
    select id, role, parts, created_at, scoped from (
      select m.id, m.role::text as role, m.parts, m.created_at,
        coalesce(bool_or(match->>'opportunityId' = ${opportunityId}), false) as scoped,
        count(match) as match_count
      from messages m
      left join lateral jsonb_array_elements(
        case when jsonb_typeof(m.metadata->'principalMessage'->'matches') = 'array' then m.metadata->'principalMessage'->'matches' else '[]'::jsonb end
      ) as match on true
      where m.metadata->>'intentId' = ${intentId}
      group by m.id, m.role, m.parts, m.created_at
    ) tagged
    where scoped or (role = 'user' and match_count = 0)
    order by created_at, id
  `;
}

export async function loadTrace(sql: Sql, opportunityId: string, options: LoadOptions = {}): Promise<TraceInput | null> {
  const scrub = options.scrub ?? true;
  const rows = await sql<NegotiationRow[]>`
    select n.id as negotiation_id, n.outcome::text as outcome, n.settled_at, n.created_at as opened_at,
      o.status::text as opportunity_status,
      n.initiator_intent_id, n.responder_intent_id, n.initiator_user_id, n.responder_user_id,
      iu.name as initiator_name, ru.name as responder_name,
      iu.intro as initiator_intro, ru.intro as responder_intro,
      ii.payload as initiator_payload, ri.payload as responder_payload
    from negotiations n
    join opportunities o on o.id = n.opportunity_id
    join users iu on iu.id = n.initiator_user_id
    join users ru on ru.id = n.responder_user_id
    join intents ii on ii.id = n.initiator_intent_id
    join intents ri on ri.id = n.responder_intent_id
    where n.opportunity_id = ${opportunityId}
  `;
  const negotiation = rows[0];
  if (!negotiation) return null;

  const turnRows = await sql<{ turn_index: number; seat_user_id: string; action: string; message: string; created_at: Date }[]>`
    select turn_index, seat_user_id, action::text as action, message, created_at
    from negotiation_turns where negotiation_id = ${negotiation.negotiation_id} order by turn_index
  `;
  const eventRows = await sql<{ type: string; at: Date }[]>`
    select type, at from opportunity_events where opportunity_id = ${opportunityId} order by at
  `;

  const names = {
    A: [negotiation.initiator_name],
    B: [negotiation.responder_name],
  };
  const clean = (text: string) => (scrub ? scrubNames(text, names) : text);

  const seatIntent: Record<Seat, string> = { A: negotiation.initiator_intent_id, B: negotiation.responder_intent_id };
  const principals = {} as TraceInput['principals'];
  for (const seat of ['A', 'B'] as const) {
    const messageRows = await loadMessages(sql, seatIntent[seat], opportunityId);
    const conversation: TextItem[] = [];
    const agentNotes: AgentNote[] = [];
    messageRows.forEach((row, index) => {
      const text = messageText(row.parts);
      if (!text) return;
      if (row.role === 'user') {
        conversation.push({ id: `conv:${seat}:${index}`, at: row.created_at.toISOString(), text: clean(text) });
        return;
      }
      const kind = classifyNote(text);
      if (kind) agentNotes.push({ id: `note:${seat}:${index}`, at: row.created_at.toISOString(), kind, text: clean(text) });
    });
    const payload = seat === 'A' ? negotiation.initiator_payload : negotiation.responder_payload;
    const intro = seat === 'A' ? negotiation.initiator_intro : negotiation.responder_intro;
    principals[seat] = { intent: clean(payload), intro: intro ? clean(intro) : null, conversation, agentNotes };
  }

  const agentVerdict = validateAgentVerdict(negotiation.outcome);
  const committed = eventRows.filter((event) => event.type === 'committed');
  const firstCommit = committed[0];
  const hoursToFirstCommit = firstCommit && negotiation.settled_at
    ? Math.max(0, (firstCommit.at.getTime() - negotiation.settled_at.getTime()) / 3_600_000)
    : null;

  const trace: TraceInput = {
    interactionId: opportunityId,
    opportunityId,
    source: 'real',
    purpose: principals.A.intent,
    openedAt: negotiation.opened_at.toISOString(),
    agentVerdict,
    opportunityStatus: negotiation.opportunity_status,
    committedCount: committed.length,
    humanOutcome: deriveHumanOutcome({ agentVerdict, opportunityStatus: negotiation.opportunity_status, committedCount: committed.length }),
    hoursToFirstCommit,
    principals,
    turns: turnRows.map((turn) => ({
      index: turn.turn_index,
      seat: turn.seat_user_id === negotiation.initiator_user_id ? 'A' : 'B',
      action: turn.action as TraceInput['turns'][number]['action'],
      message: clean(turn.message),
      at: turn.created_at.toISOString(),
    })),
  };
  return TraceInputSchema.parse(trace);
}
