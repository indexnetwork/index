/**
 * Authoritative host records and operations for one principal's AgentRunner.
 * All calls use the same services as the HTTP API, scoped to that owner.
 */
import type { AgentHost, ConversationMessage, Counterparty, CounterpartyPick, Intent, IntentStatus, Negotiation, NegotiationAction, NegotiationDetail, PrincipalMessage, Profile } from '@indexnetwork/agent';

import { ConversationDatabaseAdapter } from '../../adapters/conversation.database.adapter';
import { UserDatabaseAdapter } from '../../adapters/user.database.adapter';
import { ConversationService } from '../../services/conversation.service';
import { intentService } from '../../services/intent.service';
import { negotiationService, type NegotiationDetail as StoredNegotiation, type NegotiationView } from '../../services/negotiation.service';

/** How many of the owner's signals one read covers, matching the HTTP default. */
const INTENT_LIMIT = 100;

/** Signals that a Redis event stream has no corresponding hosted principal. */
export class HostedOwnerNotFoundError extends Error {
  /** @param userId - The stream owner that no longer has a user profile. */
  constructor(userId: string) {
    super(`No user ${userId}.`);
  }
}

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
    protocol: negotiation.protocol,
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

/** Host for one principal, served by this process rather than over HTTP. */
export class HostedIndex implements AgentHost {
  private readonly users = new UserDatabaseAdapter();
  private readonly conversations = new ConversationDatabaseAdapter();
  private readonly h2a = new ConversationService();

  /** @param userId - The owner every call acts for. */
  constructor(private readonly userId: string) {}

  /** @returns The owner, with the profile facts an agent may state as theirs. @throws When the owner no longer exists. */
  async getProfile(): Promise<Profile> {
    const user = await this.users.findById(this.userId);
    if (!user) throw new HostedOwnerNotFoundError(this.userId);
    return {
      id: user.id,
      name: user.name,
      intro: user.intro,
      location: user.location,
      timezone: user.timezone,
      profileConfirmed: Boolean(
        user.onboarding?.profileConfirmedAt || user.onboarding?.completedAt,
      ),
    };
  }

  /** @param intentId - The owner's signal. @returns Its current statement and lifecycle. @throws When not owned. */
  async getIntent(intentId: string): Promise<Intent> {
    const intent = await intentService.getById(intentId, this.userId);
    if (!intent) throw new Error(`No intent ${intentId}.`);
    return {
      id: intent.id,
      statement: intent.payload,
      status: (intent.archivedAt ? 'ARCHIVED' : intent.status ?? 'ACTIVE') as IntentStatus,
    };
  }

  /**
   * @returns The owner's signals. `ARCHIVED` is derived from `archivedAt`, which is how removal is recorded.
   */
  async listIntents(): Promise<Intent[]> {
    const { intents } = await intentService.listIntents(this.userId, { limit: INTENT_LIMIT });
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
  async findCounterparties(intentId: string, query: string, limit: number): Promise<Counterparty[]> {
    const result = await intentService.discover(intentId, this.userId, { query, limit });
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
  async getConversation(intentId: string): Promise<{ conversationId: string; messages: ConversationMessage[] }> {
    const conversation = await this.conversations.getOrCreateAgentDm(this.userId);
    const messages = await this.conversations.getMessages(conversation.id, { intentId, userId: this.userId });
    return { conversationId: conversation.id, messages: messages.map(toConversationMessage) };
  }

  /** @param intentId - Signal. @param entries - `question` and `message` entries. @throws When the signal is not the owner's. */
  async appendMessages(intentId: string, entries: PrincipalMessage[]): Promise<void> {
    await this.h2a.publishH2A({ userId: this.userId, intentId, entries });
  }

}
