/**
 * Plays a negotiation seat whose agent lives on someone else's server.
 *
 * A seat is normally played by this host's own PersonalAgent. When the
 * principal has instead registered an external agent with an active `a2a`
 * transport, that agent decides the seat's turns and this module is the wire
 * between it and the negotiation graph.
 *
 * The graph is unchanged by this: `authorTurn` returns the same
 * `NegotiationAuthoredTurn` either way, and `apply` validates it against the
 * seat and the opening rule exactly as it validates a locally authored one.
 * An external agent gets no more trust than a local one.
 *
 * Only the wire is used from `@indexnetwork/a2a` — not `Negotiator`, and not
 * `A2ANegotiationClient`. Both would run a model, and the whole point of an
 * external seat is that the counterparty's judgment happens on their side.
 *
 * Deliberately absent: retries, fallback to the local agent, and an inbound
 * handler. A failed turn raises, the graph pauses the negotiation
 * `open_failed`, and that pause stays re-kickable — which is the honest
 * report. Silently substituting our agent for theirs would put words in the
 * principal's mouth.
 */
import { bearerCredentials, decisionToMessage, messageToDecision, sendA2AMessage } from '@indexnetwork/a2a';
import type { A2ATask } from '@indexnetwork/a2a';
import { turnsWithSenders } from '@indexnetwork/protocol';
import type { NegotiationAuthoredTurn, NegotiationTurnAuthor, NegotiationTurnAuthorInput } from '@indexnetwork/protocol';

import { conversationDatabaseAdapter } from '../../adapters/database.adapter';
import { log } from '../log';

const logger = log.job.from('A2ATurnAuthor');

/** The actions an external agent may answer a turn request with. */
const ALLOWED_ACTIONS = ['counter', 'question', 'ask', 'accept', 'reject'] as const;
type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

/** An `a2a` transport's config, as validated on the way in by agent.controller. */
export interface A2ATransportConfig {
  url: string;
  token?: string;
}

/** Where this seat's A2A task lives, once one exists. */
interface A2ARef {
  taskId: string;
  contextId: string;
}

function readA2ARef(metadata: Record<string, unknown>, userId: string): A2ARef | undefined {
  const byUser = (metadata as { a2a?: Record<string, unknown> }).a2a;
  const ref = byUser?.[userId] as Partial<A2ARef> | undefined;
  return ref?.taskId && ref.contextId ? { taskId: ref.taskId, contextId: ref.contextId } : undefined;
}

/**
 * What the external agent is being asked to answer.
 *
 * Its own principal's brief leads, then the counterparty's last message. The
 * brief is re-sent every turn rather than only on the first: the task lives on
 * their server, and we cannot know what they kept.
 */
function buildPrompt(brief: string | undefined, lastFromCounterparty: string | undefined): string {
  const parts: string[] = [];
  if (brief) parts.push(`Your principal's brief:\n${brief}`);
  parts.push(
    lastFromCounterparty
      ? `The other party's last message:\n${lastFromCounterparty}`
      : 'You are opening this negotiation. There is no message to respond to yet.',
  );
  parts.push(
    `Reply with one of these actions: ${ALLOWED_ACTIONS.join(', ')}. `
    + 'Use `ask` when you need something only your principal can tell you; '
    + 'use `accept` or `reject` when you believe the negotiation can be decided.',
  );
  return parts.join('\n\n');
}

/**
 * Translates the external agent's decision into this protocol's turn
 * vocabulary.
 *
 * The two vocabularies are not the same and the mapping is not symmetric:
 * `accept`/`reject` do NOT end the negotiation here. A seat that wants out
 * pauses `ready_for_verdict` and lets its own principal's IS-A act on the
 * recommendation — an external agent cannot conclude on a principal's behalf
 * any more than a local one can.
 */
export function toAuthoredTurn(
  action: AllowedAction,
  message: string,
  reasoning: string,
): NegotiationAuthoredTurn {
  switch (action) {
    case 'counter':
    case 'question':
      return { verb: action, message, reasoning };
    case 'ask':
      return { verb: 'pause', reason: 'needs_principal', payload: { question: message } };
    case 'accept':
      return { verb: 'pause', reason: 'ready_for_verdict', payload: { recommendation: 'pending', reasoning } };
    case 'reject':
      return { verb: 'pause', reason: 'ready_for_verdict', payload: { recommendation: 'reject', reasoning } };
  }
}

/** The last thing the OTHER seat said, if it said anything sayable. */
function lastCounterpartyMessage(
  messages: Array<{ senderId: string; parts: unknown[] }>,
  userId: string,
): string | undefined {
  const turns = turnsWithSenders(messages);
  for (let i = turns.length - 1; i >= 0; i--) {
    const entry = turns[i];
    if (!entry || entry.senderId === userId) continue;
    if (entry.turn.verb === 'pause') continue;
    return entry.turn.message;
  }
  return undefined;
}

/** The negotiation reads and the one write this author needs. */
export interface A2ATurnAuthorDatabase {
  getNegotiationTask(taskId: string): Promise<{ briefs: Record<string, string>; metadata: unknown } | null>;
  getNegotiationMessages(taskId: string): Promise<Array<{ senderId: string; parts: unknown[] }>>;
  setNegotiationA2ARef(taskId: string, userId: string, ref: A2ARef): Promise<void>;
}

/**
 * Builds a turn author that asks an external agent over A2A.
 *
 * @param transport - The seat's active `a2a` transport config.
 * @param database - Negotiation persistence; defaults to the host adapter.
 * @returns An author the negotiation graph can call for this seat.
 */
export function createA2ATurnAuthor(
  transport: A2ATransportConfig,
  database: A2ATurnAuthorDatabase = conversationDatabaseAdapter,
): NegotiationTurnAuthor {
  return {
    async authorTurn({ negotiationId, userId }: NegotiationTurnAuthorInput): Promise<NegotiationAuthoredTurn> {
      const task = await database.getNegotiationTask(negotiationId);
      if (!task) throw new Error(`A2A seat: negotiation ${negotiationId} not found`);

      const messages = await database.getNegotiationMessages(negotiationId);
      const prompt = buildPrompt(task.briefs[userId], lastCounterpartyMessage(messages, userId));
      const ref = readA2ARef(task.metadata as unknown as Record<string, unknown>, userId);

      // `role: "user"` — we are the party asking; their agent answers.
      const outbound = decisionToMessage(
        { action: 'turn_request', message: prompt },
        'user',
        ref ? { taskId: ref.taskId, contextId: ref.contextId } : undefined,
      );

      const credentials = transport.token ? bearerCredentials(transport.token) : undefined;
      const answered: A2ATask = await sendA2AMessage(transport.url, outbound, credentials);

      // The task is the record: its id and context are what continue this
      // exchange, and they are only ours to keep once the far side has
      // minted them.
      if (!ref || ref.taskId !== answered.id) {
        await database.setNegotiationA2ARef(negotiationId, userId, {
          taskId: answered.id,
          contextId: answered.contextId,
        });
      }

      const reply = [...answered.history].reverse().find((entry) => entry.role === 'agent');
      const decision = reply ? messageToDecision(reply) : null;
      if (!decision) {
        throw new Error(`A2A seat: ${transport.url} returned no decision for negotiation ${negotiationId}`);
      }

      const action = decision.action as AllowedAction;
      if (!ALLOWED_ACTIONS.includes(action)) {
        throw new Error(
          `A2A seat: ${transport.url} answered with unsupported action "${decision.action}" `
          + `(expected one of ${ALLOWED_ACTIONS.join(', ')})`,
        );
      }

      const message = decision.message?.trim();
      if (!message) {
        throw new Error(`A2A seat: ${transport.url} answered "${action}" with no message`);
      }

      logger.info('External seat authored a turn over A2A', {
        negotiationId,
        userId,
        url: transport.url,
        action,
        a2aTaskId: answered.id,
        a2aState: answered.status.state,
      });

      return toAuthoredTurn(action, message, `Authored by the external agent at ${transport.url}.`);
    },
  };
}
