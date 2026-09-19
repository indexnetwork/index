/**
 * Index for one owner, answered from this process.
 *
 * `@indexnetwork/agentv2` is written against `Index` and knows nothing else:
 * an external runner reaches it over HTTP with an agent-bound key, and the
 * hosted seat reaches the same protocol through the services that key would
 * have called. The owner is fixed at construction, where the key's identity
 * would otherwise stand.
 */
import type { ConnectedEvent, ConversationMessage, Counterparty, CounterpartyPick, Index, IntentStatus, IntentSummary, Me, Negotiation, NegotiationAction, NegotiationDetail, PrincipalMessage, UserEvent } from '@indexnetwork/client';

import { ConversationDatabaseAdapter } from '../../adapters/conversation.database.adapter';
import { UserDatabaseAdapter } from '../../adapters/user.database.adapter';
import { ConversationService } from '../../services/conversation.service';
import { intentService } from '../../services/intent.service';
import { negotiationService, type NegotiationDetail as StoredNegotiation, type NegotiationView } from '../../services/negotiation.service';

/** How many of the owner's signals one read covers, matching the HTTP default. */
const INTENT_LIMIT = 100;

/** One agent DM row as the database holds it. */
type StoredMessage = Awaited<ReturnType<ConversationDatabaseAdapter['getMessages']>>[number];

/**
 * @param negotiation - One negotiation as the seat owner sees it.
 * @returns The same record with timestamps on the wire's ISO form.
 */
function toNegotiation(negotiation: NegotiationView): Negotiation {
  return {
    id: negotiation.id,
    opportunityId: negotiation.opportunityId,
    intentId: negotiation.intentId,
    awaitingUserId: negotiation.awaitingUserId,
    outcome: negotiation.outcome,
    settledAt: negotiation.settledAt?.toISOString() ?? null,
    turnCount: negotiation.turnCount,
    createdAt: negotiation.createdAt.toISOString(),
    updatedAt: negotiation.updatedAt.toISOString(),
    counterparty: negotiation.counterparty,
  };
}

/**
 * @param negotiation - One negotiation with its turn log.
 * @returns The detail record as the wire declares it.
 */
function toNegotiationDetail(negotiation: StoredNegotiation): NegotiationDetail {
  return {
    ...toNegotiation(negotiation),
    turns: negotiation.turns.map((turn) => ({
      turnIndex: turn.turnIndex,
      seatUserId: turn.seatUserId,
      action: turn.action,
      message: turn.message,
      createdAt: turn.createdAt.toISOString(),
    })),
  };
}

/**
 * Over HTTP these rows are serialized as JSON, which is the only reason their
 * timestamps are strings.
 *
 * @param message - One stored agent DM row.
 * @returns That row as the wire carries it.
 */
function toConversationMessage(message: StoredMessage): ConversationMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    role: message.role,
    parts: message.parts,
    createdAt: message.createdAt.toISOString(),
    metadata: message.metadata,
  };
}

/** Index for one owner, served by this process rather than over HTTP. */
export class HostedIndex implements Index {
  private readonly users = new UserDatabaseAdapter();
  private readonly conversations = new ConversationDatabaseAdapter();
  private readonly h2a = new ConversationService();
  private identity?: Me;

  /** @param userId - The owner every call acts for. */
  constructor(private readonly userId: string) {}

  /** @returns The owner, with the profile facts an agent may state as theirs. @throws When the owner no longer exists. */
  async me(): Promise<Me> {
    if (this.identity) return this.identity;
    const user = await this.users.findById(this.userId);
    if (!user) throw new Error(`No user ${this.userId}.`);
    this.identity = {
      id: user.id,
      name: user.name,
      intro: user.intro,
      location: user.location,
      timezone: user.timezone,
      profileConfirmed: Boolean(user.onboarding?.profileConfirmedAt),
    };
    return this.identity;
  }

  /**
   * @param limit - How many signals to read.
   * @returns The owner's signals. `ARCHIVED` is derived from `archivedAt`, which is how removal is recorded.
   */
  async listIntents(limit = INTENT_LIMIT): Promise<IntentSummary[]> {
    const { intents } = await intentService.listIntents(this.userId, { limit });
    return intents.map((intent) => ({
      id: intent.id,
      statement: intent.payload,
      status: (intent.archivedAt ? 'ARCHIVED' : intent.status ?? 'ACTIVE') as IntentStatus,
    }));
  }

  /**
   * @param intentId - The signal to search from.
   * @param query - What to look for, in the caller's own words.
   * @param limit - How many counterparties to return.
   * @returns Counterparties, strongest first.
   * @throws When the signal is not the owner's, or is no longer active.
   */
  async discover(intentId: string, query: string, limit?: number): Promise<Counterparty[]> {
    const result = await intentService.discover(intentId, this.userId, { query, ...(limit === undefined ? {} : { limit }) });
    if (result.kind !== 'ok') throw new Error(`Signal ${intentId} is ${result.kind}.`);
    return result.counterparties;
  }

  /**
   * @param intentId - The signal the opportunities belong to.
   * @param counterparties - Counterparty signals and the community each pair sits in.
   * @returns The opportunities that now exist.
   * @throws When the signal is not the owner's, or is no longer active.
   */
  async createOpportunities(intentId: string, counterparties: CounterpartyPick[]): Promise<{ opportunityId: string }[]> {
    const result = await intentService.createOpportunities(intentId, this.userId, counterparties);
    if (result.kind !== 'ok') throw new Error(`Signal ${intentId} is ${result.kind}.`);
    return result.opportunities;
  }

  /** @returns Open negotiations for this seat. */
  async listNegotiations(): Promise<Negotiation[]> {
    const negotiations = await negotiationService.list(this.userId, { open: true });
    return negotiations.map(toNegotiation);
  }

  /** @param id - Opportunity id. @returns The negotiation as this seat sees it. @throws When this seat cannot read it. */
  async getNegotiation(id: string): Promise<NegotiationDetail> {
    const record = await negotiationService.read(id, this.userId);
    if (!record) throw new Error(`No negotiation on opportunity ${id}.`);
    return toNegotiationDetail(record);
  }

  /**
   * @param id - Opportunity id.
   * @param turn - Action, message, and the log length it was decided against.
   * @returns The negotiation after the turn.
   * @throws When Index refuses the turn.
   */
  async submitTurn(
    id: string,
    turn: { action: NegotiationAction; message: string; expectedTurnCount: number },
  ): Promise<NegotiationDetail> {
    const result = await negotiationService.submitTurn(id, this.userId, turn);
    if ('rejection' in result) throw new Error(result.rejection);
    return toNegotiationDetail(result);
  }

  /** @param intentId - Signal whose principal conversation to read. @returns The agent DM slice for that signal. */
  async principalInbox(intentId: string): Promise<{ conversationId: string; messages: ConversationMessage[] }> {
    const conversation = await this.conversations.getOrCreateAgentDm(this.userId);
    const messages = await this.conversations.getMessages(conversation.id, { intentId, userId: this.userId });
    return { conversationId: conversation.id, messages: messages.map(toConversationMessage) };
  }

  /** @param intentId - Signal. @param entries - `question` and `message` entries. @throws When the signal is not the owner's. */
  async sendPrincipal(intentId: string, entries: PrincipalMessage[]): Promise<void> {
    await this.h2a.publishH2A({ userId: this.userId, intentId, entries });
  }

  /**
   * The hosted seat is woken by the event stream directly, so nothing in this
   * process subscribes through Index.
   *
   * @throws Always.
   */
  events(_onEvent: (event: UserEvent | ConnectedEvent) => void): () => void {
    throw new Error('The hosted agent reads user events directly, not through Index.');
  }
}
