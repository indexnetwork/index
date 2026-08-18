/**
 * Parked-negotiation reader (conversational-questions delivery spine).
 *
 * Given `(userId, intentId)`, returns this user's parked negotiations on that
 * signal — the durable record of every open information need the regeneration
 * job renders into the signal's question-message
 * (docs/plans/2026-08-18-conversational-questions.md). "Parked" is derived,
 * never stored, and covers both flavours:
 *
 * - **Mid-flight consult**: the negotiation's exact task is `input_required`
 *   and its `metadata.turnContext.askUserBinding` names this user and intent
 *   as the recipient. The binding is written in the same flow that flips the
 *   state, so the pair is authoritative for whose input is required.
 * - **Post-stall park**: the opportunity is `stalled` AND the negotiation
 *   record ends in an `ask_user` gap message authored by this user's agent
 *   with `assessment.reasoning === NEGOTIATION_PARK_REASONING`. A stalled
 *   opportunity WITHOUT that trailing message is a terminal stall (past the
 *   ask cap, no gap authored, or the authored question was dropped as
 *   unsafe) — never routable, never surfaced.
 *
 * Read-only, scoped to the requesting user's own side by construction: the
 * mid-flight query matches the ask-user binding's recipient pair, and the
 * post-stall query requires the gap to be authored by `agent:<userId>` — the
 * counterparty's parks are unreachable through either predicate (the other
 * side's park is `classifyParkedNegotiation`'s `wrong_recipient` case, which
 * must never enter this user's message).
 *
 * TODO(#1432): `classifyParkedNegotiation` in the protocol package is the
 * canonical per-negotiation park predicate; this reader mirrors its
 * semantics set-wise (adapters may not import the protocol package). When
 * the answer-wiring PR lands, converge the two — either by lifting this
 * reader's predicate checks to a layer that can import the classifier, or by
 * a contract test asserting they agree.
 */
import { and, asc, db, eq, inArray, schema, sql } from './database.shared';
import { notArchivedNegotiationTaskWhere } from './negotiation-attempt.atomic';
import { log } from '../lib/log';

const logger = log.lib.from('parked-negotiation.reader.adapter');

/**
 * Fixed reasoning stamped on a post-stall park turn. Duplicated from the
 * protocol package's `negotiation.stall-gap.ts` rather than imported —
 * adapters may not import `@indexnetwork/protocol`, the value is the shape of
 * a stored row, and both writer and reader pinning the same literal is what
 * keeps them honest if either is refactored (the same pattern
 * `negotiator-client-dm.retrieval.adapter.ts` uses for its scope type).
 */
export const NEGOTIATION_PARK_REASONING = "Negotiation parked pending the client's answer.";

/**
 * More parked negotiations than one message can carry (the question block
 * caps at 20 questions). The reader keeps the oldest parks; the rest surface
 * on a later regeneration once earlier ones resolve.
 */
const MAX_PARKED_NEGOTIATIONS = 20;

/** Structural mirror of the protocol's `StructuredQuestion` (renderer quartet). */
export interface ParkedNegotiationQuestion {
  title: string;
  prompt: string;
  options: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
}

/** One transcript entry, reduced to what grounds a question-message. */
export interface ParkedNegotiationTurn {
  action: string;
  reasoning: string;
  message?: string;
}

export interface ParkedNegotiation {
  /** The opportunity row the negotiation runs on — its durable identity. */
  opportunityId: string;
  kind: 'mid_flight' | 'post_stall';
  /** Closed consultation category from the park turn's `askUser.reason`. */
  reason?: string;
  /**
   * The negotiator-authored question persisted at park time. Absent only when
   * the mid-flight safety gate stripped it from the turn.
   */
  question?: ParkedNegotiationQuestion;
  /** The negotiation's turns, oldest first, ending in the park turn. */
  transcript: ParkedNegotiationTurn[];
  /** When the park turn landed; parks are returned oldest first. */
  parkedAt: Date;
}

interface RawTurn {
  action?: unknown;
  assessment?: { reasoning?: unknown };
  message?: unknown;
  askUser?: { reason?: unknown; question?: unknown };
}

/** The `data` payload of an A2A turn message, or null for non-turn parts. */
function turnFromParts(parts: unknown): RawTurn | null {
  if (!Array.isArray(parts)) return null;
  const dataPart = parts.find((part) =>
    Boolean(part) && typeof part === 'object' && (part as { kind?: unknown }).kind === 'data');
  const data = (dataPart as { data?: unknown } | undefined)?.data;
  return data && typeof data === 'object' ? (data as RawTurn) : null;
}

function questionFrom(value: unknown): ParkedNegotiationQuestion | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const question = value as Record<string, unknown>;
  if (typeof question.title !== 'string' || typeof question.prompt !== 'string' || !Array.isArray(question.options)) {
    return undefined;
  }
  const options = question.options.flatMap((option) => {
    const candidate = option as Record<string, unknown> | null;
    return candidate && typeof candidate.label === 'string' && typeof candidate.description === 'string'
      ? [{ label: candidate.label, description: candidate.description }]
      : [];
  });
  if (options.length === 0) return undefined;
  return {
    title: question.title,
    prompt: question.prompt,
    options,
    ...(typeof question.multiSelect === 'boolean' ? { multiSelect: question.multiSelect } : {}),
  };
}

interface NegotiationRecord {
  turns: ParkedNegotiationTurn[];
  lastTurn: RawTurn | null;
  lastSenderId: string | null;
  lastCreatedAt: Date | null;
}

export class ParkedNegotiationReaderAdapter {
  /**
   * Reads the user's parked negotiations on one signal, oldest park first.
   * Resolves `[]` when the intent is not owned by the user — the caller never
   * has to pre-validate ownership.
   */
  async readParkedNegotiations(userId: string, intentId: string): Promise<ParkedNegotiation[]> {
    const normalizedIntentId = intentId?.trim();
    if (!userId || !normalizedIntentId) return [];

    const [ownedIntent] = await db
      .select({ id: schema.intents.id })
      .from(schema.intents)
      .where(and(eq(schema.intents.id, normalizedIntentId), eq(schema.intents.userId, userId)))
      .limit(1);
    if (!ownedIntent) return [];

    const midFlightRows = await db
      .select({ opportunityId: sql<string | null>`${schema.tasks.metadata}->>'opportunityId'` })
      .from(schema.tasks)
      .where(and(
        eq(schema.tasks.state, 'input_required'),
        sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
        notArchivedNegotiationTaskWhere(),
        sql`${schema.tasks.metadata}->'participantBindings' @> ${JSON.stringify([{
          userId,
          intentId: normalizedIntentId,
        }])}::jsonb`,
        sql`${schema.tasks.metadata}->'turnContext'->'askUserBinding' @> ${JSON.stringify({
          recipientUserId: userId,
          recipientIntentId: normalizedIntentId,
        })}::jsonb`,
      ));

    const stalledRows = await db
      .select({ id: schema.opportunities.id })
      .from(schema.opportunities)
      .where(and(
        eq(schema.opportunities.status, 'stalled'),
        sql`${schema.opportunities.actors} @> ${JSON.stringify([{
          userId,
          intent: normalizedIntentId,
        }])}::jsonb`,
      ));

    const midFlightIds = [...new Set(midFlightRows.flatMap((row) => (row.opportunityId ? [row.opportunityId] : [])))];
    const stalledIds = stalledRows.map((row) => row.id).filter((id) => !midFlightIds.includes(id));
    if (midFlightIds.length === 0 && stalledIds.length === 0) return [];

    const records = await this.loadNegotiationRecords([...midFlightIds, ...stalledIds]);

    const parked: ParkedNegotiation[] = [];
    for (const opportunityId of midFlightIds) {
      const record = records.get(opportunityId);
      // The exact task's `input_required` state is authoritative for a
      // mid-flight park; the trailing ask_user turn supplies the authored
      // question when the safety gate let it persist.
      if (!record) continue;
      parked.push(this.toParkedNegotiation(opportunityId, 'mid_flight', record));
    }
    for (const opportunityId of stalledIds) {
      const record = records.get(opportunityId);
      // Parked iff the record ends in the park gap authored by this user's
      // agent. Anything else on a stalled opportunity is a terminal stall.
      if (
        !record
        || record.lastTurn?.action !== 'ask_user'
        || record.lastTurn.assessment?.reasoning !== NEGOTIATION_PARK_REASONING
        || record.lastSenderId !== `agent:${userId}`
      ) continue;
      parked.push(this.toParkedNegotiation(opportunityId, 'post_stall', record));
    }

    parked.sort((a, b) => a.parkedAt.getTime() - b.parkedAt.getTime());
    if (parked.length > MAX_PARKED_NEGOTIATIONS) {
      logger.warn('Parked set exceeds one message; keeping the oldest parks', {
        userId,
        intentId: normalizedIntentId,
        parked: parked.length,
        kept: MAX_PARKED_NEGOTIATIONS,
      });
      return parked.slice(0, MAX_PARKED_NEGOTIATIONS);
    }
    return parked;
  }

  /** Negotiation records (turns oldest first) for the given opportunities. */
  private async loadNegotiationRecords(opportunityIds: string[]): Promise<Map<string, NegotiationRecord>> {
    const taskRows = await db
      .select({
        id: schema.tasks.id,
        opportunityId: sql<string>`${schema.tasks.metadata}->>'opportunityId'`,
      })
      .from(schema.tasks)
      .where(and(
        sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
        notArchivedNegotiationTaskWhere(),
        inArray(sql`${schema.tasks.metadata}->>'opportunityId'`, opportunityIds),
      ));
    if (taskRows.length === 0) return new Map();

    const opportunityByTask = new Map(taskRows.map((task) => [task.id, task.opportunityId]));
    const messageRows = await db
      .select({
        taskId: schema.messages.taskId,
        senderId: schema.messages.senderId,
        parts: schema.messages.parts,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(inArray(schema.messages.taskId, taskRows.map((task) => task.id)))
      .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id));

    const records = new Map<string, NegotiationRecord>();
    for (const row of messageRows) {
      const opportunityId = row.taskId ? opportunityByTask.get(row.taskId) : undefined;
      if (!opportunityId) continue;
      const record = records.get(opportunityId)
        ?? { turns: [], lastTurn: null, lastSenderId: null, lastCreatedAt: null };
      const turn = turnFromParts(row.parts);
      if (turn) {
        record.turns.push({
          action: typeof turn.action === 'string' ? turn.action : 'unknown',
          reasoning: typeof turn.assessment?.reasoning === 'string' ? turn.assessment.reasoning : '',
          ...(typeof turn.message === 'string' && turn.message.trim() ? { message: turn.message } : {}),
        });
      }
      record.lastTurn = turn;
      record.lastSenderId = row.senderId;
      record.lastCreatedAt = row.createdAt;
      records.set(opportunityId, record);
    }
    return records;
  }

  private toParkedNegotiation(
    opportunityId: string,
    kind: ParkedNegotiation['kind'],
    record: NegotiationRecord,
  ): ParkedNegotiation {
    const askUser = record.lastTurn?.action === 'ask_user' ? record.lastTurn.askUser : undefined;
    const question = questionFrom(askUser?.question);
    return {
      opportunityId,
      kind,
      ...(typeof askUser?.reason === 'string' ? { reason: askUser.reason } : {}),
      ...(question ? { question } : {}),
      transcript: record.turns,
      parkedAt: record.lastCreatedAt ?? new Date(0),
    };
  }
}

export const parkedNegotiationReaderAdapter = new ParkedNegotiationReaderAdapter();
