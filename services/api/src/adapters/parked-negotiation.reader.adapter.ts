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
 * `classifyParkedNegotiation` in the protocol package is the canonical
 * per-negotiation park predicate; this reader mirrors its semantics set-wise
 * (adapters may not import the protocol package). The two are held together
 * by the convergence contract test
 * `tests/parked-negotiation.classifier-convergence.spec.ts`, which runs
 * both over shared fixtures (mid-flight, post-stall, wrong-recipient,
 * terminal-stall-without-gap) and asserts they agree.
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
   * The checklist dimension this park is about, from the ask's
   * `askUser.dimension` (checklist plan §4). Carried through to the question
   * block as the step's label. Absent for parks whose ask named none — a
   * policy-inferred consultation, a post-stall gap, or anything authored
   * before the checklist protocol.
   */
  dimension?: string;
  /**
   * The dimension's checklist kind, recovered from the checklist the park turn
   * itself persisted (the turn record is the checklist's only store). Absent
   * when the ask named no dimension, or when the turn carried no checklist —
   * a pre-checklist turn or an external agent's.
   */
  dimensionKind?: 'mutual_want' | 'hard_constraint' | 'fit';
  /**
   * What the ask declared would score the dimension `ok` and what would score
   * it `conflict` (checklist plan §3). Absent for asks that declared none —
   * every pre-checklist ask, and the conclusion floor's own guaranteed ask,
   * which names a dimension but has no author behind it.
   */
  answerhood?: { ok_when: string; conflict_when: string };
  /**
   * The negotiator-authored question persisted at park time. Absent only when
   * the mid-flight safety gate stripped it from the turn — or when no author
   * was involved at all, which is the conclusion floor's guaranteed ask: the
   * graph fires it from a dimension the agent scored unknown, so the park
   * carries `dimension` and no `question`. The question-message author derives
   * a renderable question from the dimension in exactly that case
   * (`lib/question/dimension-question.ts`).
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
  askUser?: { reason?: unknown; question?: unknown; dimension?: unknown; answerhood?: unknown };
  checklist?: unknown;
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

/** The ask's answerhood map, or undefined when it declared none. */
function answerhoodFrom(value: unknown): { ok_when: string; conflict_when: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const map = value as Record<string, unknown>;
  if (typeof map.ok_when !== 'string' || typeof map.conflict_when !== 'string') return undefined;
  const ok = map.ok_when.trim();
  const conflict = map.conflict_when.trim();
  return ok && conflict ? { ok_when: ok, conflict_when: conflict } : undefined;
}

const CHECKLIST_KINDS = new Set(['mutual_want', 'hard_constraint', 'fit']);

/** Same normalization the protocol's `dimensionKey` uses; adapters may not import it. */
function dimensionKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The kind of the named dimension, read off the checklist the park turn itself
 * persisted. Matched by normalized name for the same reason the graph does:
 * the ask spells the dimension in its own words and the checklist holds the
 * authored one.
 */
function dimensionKindFrom(checklist: unknown, dimension: string): ParkedNegotiation['dimensionKind'] {
  if (!Array.isArray(checklist)) return undefined;
  const key = dimensionKey(dimension);
  for (const entry of checklist) {
    const item = entry as Record<string, unknown> | null;
    if (!item || typeof item.name !== 'string' || typeof item.kind !== 'string') continue;
    if (dimensionKey(item.name) === key && CHECKLIST_KINDS.has(item.kind)) {
      return item.kind as ParkedNegotiation['dimensionKind'];
    }
  }
  return undefined;
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
    const dimension = typeof askUser?.dimension === 'string' && askUser.dimension.trim().length > 0
      ? askUser.dimension.trim()
      : undefined;
    const dimensionKind = dimension ? dimensionKindFrom(record.lastTurn?.checklist, dimension) : undefined;
    const answerhood = answerhoodFrom(askUser?.answerhood);
    return {
      opportunityId,
      kind,
      ...(typeof askUser?.reason === 'string' ? { reason: askUser.reason } : {}),
      ...(dimension ? { dimension } : {}),
      ...(dimensionKind ? { dimensionKind } : {}),
      ...(answerhood ? { answerhood } : {}),
      ...(question ? { question } : {}),
      transcript: record.turns,
      parkedAt: record.lastCreatedAt ?? new Date(0),
    };
  }
}

export const parkedNegotiationReaderAdapter = new ParkedNegotiationReaderAdapter();
