/**
 * The default A2A negotiator: Index takes a seat's turn when nobody else does.
 *
 * It is not a session. It wakes on the two events that mean a turn is owed,
 * takes exactly one turn, and stops. Owner chat is not its business — an owner
 * who wants to talk to their agent binds an external negotiator.
 */
import { NEGOTIATION_GUIDANCE } from '@indexnetwork/protocol';

import type { Model, ModelMessage, ToolDefinition } from '@indexnetwork/agent';

import { AgentDatabaseAdapter } from '../../adapters/agent.database.adapter';
import { createRedisClient } from '../../adapters/cache.adapter';
import { IntentDatabaseAdapter } from '../../adapters/intent.database.adapter';
import { negotiationService, type NegotiationDetail, type NegotiationTurnAction } from '../../services/negotiation.service';
import { log } from '../log';
import { userEventChannel } from '../user-events';

const logger = log.agent.from('HostedNegotiator');

const SUBMIT_TURN: ToolDefinition = {
  type: 'function',
  function: {
    name: 'submit_turn',
    description: 'Submit this seat\'s single turn in the negotiation.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['propose', 'counter', 'accept', 'decline'] },
        message: { type: 'string', description: 'What crosses to the other seat.' },
      },
      required: ['action', 'message'],
      additionalProperties: false,
    },
  },
};

/** Takes one A2A turn per wake for owners who have not bound an external negotiator. */
export class HostedNegotiator {
  private readonly registry = new AgentDatabaseAdapter();
  private readonly intents = new IntentDatabaseAdapter();
  private readonly inFlight = new Set<string>();
  private subscriber?: ReturnType<typeof createRedisClient>;
  private running = false;

  constructor(private readonly model: Model) {}

  /**
   * Subscribe to every owner's event channel.
   *
   * @returns When the subscription is live.
   */
  async start(): Promise<void> {
    this.running = true;
    this.subscriber = createRedisClient();
    this.subscriber.on('pmessage', (_pattern, channel: string, raw: string) => {
      const userId = channel.slice(userEventChannel('').length);
      let frame: { type?: string; data?: { opportunityId?: string; intentId?: string } };
      try { frame = JSON.parse(raw); } catch { return; }
      if (frame.type === 'negotiation.turn' && frame.data?.opportunityId) {
        void this.take(userId, frame.data.opportunityId);
      } else if (frame.type === 'negotiation.opened' && frame.data?.intentId) {
        void this.takeForIntent(userId, frame.data.intentId);
      }
    });
    await this.subscriber.psubscribe(userEventChannel('*'));
  }

  /** Stop answering and drop the subscription. */
  async stop(): Promise<void> {
    this.running = false;
    await this.subscriber?.quit().catch(() => {});
    this.subscriber = undefined;
  }

  /** Discovery opened negotiations for this signal; take a turn on each one that owes us. */
  private async takeForIntent(userId: string, intentId: string): Promise<void> {
    const records = await negotiationService.scan(userId, intentId).catch(() => []);
    for (const record of records) {
      if (record.eligible) await this.take(userId, record.opportunityId);
    }
  }

  private async take(userId: string, opportunityId: string): Promise<void> {
    if (!this.running || this.inFlight.has(opportunityId)) return;
    if (await this.registry.getSelectedNegotiator(userId)) return;

    this.inFlight.add(opportunityId);
    try {
      const record = await negotiationService.read(opportunityId, userId);
      if (!record || record.settledAt || record.awaitingUserId !== userId) return;
      if (!record.protocol.availableActions.length) return;

      const turn = await this.decide(userId, record);
      if (!turn) return;

      const result = await negotiationService.submitTurn(opportunityId, userId, {
        ...turn,
        expectedTurnCount: record.turnCount,
      });
      if ('rejection' in result) {
        logger.warn('Hosted turn refused', { opportunityId, rejection: result.rejection });
      }
    } catch (error: unknown) {
      logger.error('Hosted turn failed', { opportunityId, error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.inFlight.delete(opportunityId);
    }
  }

  /** One model call against the record; no inbox, no follow-up, no questions to the owner. */
  private async decide(
    userId: string,
    record: NegotiationDetail,
  ): Promise<{ action: NegotiationTurnAction; message: string } | null> {
    const [principal] = (await this.intents.listAgentPrincipals(userId))
      .filter((row) => row.intentId === record.intentId);
    if (!principal) return null;

    const messages: ModelMessage[] = [
      { role: 'system', content: NEGOTIATION_GUIDANCE },
      {
        role: 'user',
        content: [
          `Your principal: ${principal.name ?? 'unnamed'}.`,
          principal.confirmedProfile
            ? `Confirmed profile: ${JSON.stringify(principal.confirmedProfile)}`
            : 'No confirmed profile is available. Do not invent facts about your principal.',
          `Your signal: ${principal.intent}`,
          `Their signal: ${record.counterparty.statement}`,
          record.turns.length
            ? `Log so far:\n${record.turns.map((turn) => `${turn.seatUserId === userId ? 'you' : 'them'} · ${turn.action}: ${turn.message}`).join('\n')}`
            : 'No turns yet; you open.',
          `Available actions: ${record.protocol.availableActions.join(', ')}.`,
          'You cannot reach your principal mid-negotiation, so never settle around a gap. When a decision-critical fact is missing, ask for it in the message: counter with the question, or raise it in your opening proposal. Accept or decline only once the log answers it.',
          `Keep the message under ${record.protocol.messageLimit} characters. Call submit_turn once.`,
        ].join('\n\n'),
      },
    ];

    const reply = await this.model.complete(messages, [SUBMIT_TURN]);
    const call = reply.tool_calls?.find((entry) => entry.function.name === 'submit_turn');
    if (!call) return null;

    let parsed: { action?: NegotiationTurnAction; message?: string };
    try { parsed = JSON.parse(call.function.arguments); } catch { return null; }
    const message = parsed.message?.trim();
    if (!message || !parsed.action || !record.protocol.availableActions.includes(parsed.action)) return null;
    return { action: parsed.action, message: message.slice(0, record.protocol.messageLimit) };
  }
}
