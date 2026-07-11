import { log } from '../lib/log';
import { IntentDatabaseAdapter, intentDatabaseAdapter } from '../adapters/database.adapter';
import { ChatDatabaseAdapter, conversationDatabaseAdapter } from '../adapters/database.adapter';
import { NegotiationGraphFactory } from '@indexnetwork/protocol';
import type { UserNegotiationContext, AgentDispatcher } from '@indexnetwork/protocol';
import { questionerEnqueueIfEnabled } from '../queues/questioner.queue';
import { reflectEnqueueIfEnabled } from '../queues/negotiations/reflect.queue';

const logger = log.service.from('NegotiationService');

/**
 * Orchestrates on-demand "discovery" negotiations between two users.
 * @remarks Builds user contexts from DB and invokes the negotiation graph.
 */
export class NegotiationService {
  constructor(
    private intentDb: IntentDatabaseAdapter = intentDatabaseAdapter,
    private chatDb: ChatDatabaseAdapter = new ChatDatabaseAdapter(),
  ) {}

  /**
   * Triggers a discovery negotiation between two users.
   * @param sourceUserId - The user initiating the negotiation
   * @param candidateUserId - The target user
   * @returns The negotiation outcome from the graph
   */
  async triggerDiscoveryNegotiation(sourceUserId: string, candidateUserId: string) {
    const [sourceCtx, candidateCtx] = await Promise.all([
      this.buildUserContext(sourceUserId),
      this.buildUserContext(candidateUserId),
    ]);

    // No-op dispatcher: NegotiationService triggers synchronous discovery negotiations
    // without routing turns to external poller agents.
    const noOpDispatcher: AgentDispatcher = {
      dispatch: async () => ({ handled: false, reason: 'no_agent' as const }),
      hasExternalAgent: async () => false,
    };
    const graph = new NegotiationGraphFactory(
      conversationDatabaseAdapter as ConstructorParameters<typeof NegotiationGraphFactory>[0],
      noOpDispatcher,
      undefined,
      // Stalled negotiations enqueue follow-up questions for the source user.
      questionerEnqueueIfEnabled(),
      // Finished negotiations enqueue memory distillation (P5.2, flag-gated).
      reflectEnqueueIfEnabled(),
    ).createGraph();

    logger.info('Starting discovery negotiation', { sourceUserId, candidateUserId });

    const result = await graph.invoke({
      sourceUser: sourceCtx,
      candidateUser: candidateCtx,
      indexContext: { networkId: '', prompt: '' },
      seedAssessment: { reasoning: 'Discovery negotiation', valencyRole: 'peer' },
      maxTurns: 4,
      // v2 initiator stamp: explicit user-triggered negotiation — the viewer
      // who requested it holds the initiating seat. This path has no
      // opportunityId, so the stamp must ride the invoke input directly.
      initiatorUserId: sourceUserId,
    });

    logger.info('Discovery negotiation completed', {
      sourceUserId,
      candidateUserId,
      hasOpportunity: result.outcome?.hasOpportunity,
      turnCount: result.outcome?.turnCount,
    });

    return result;
  }

  private async buildUserContext(userId: string): Promise<UserNegotiationContext> {
    const [profile, activeIntents] = await Promise.all([
      this.chatDb.getProfile(userId),
      this.intentDb.getActiveIntents(userId),
    ]);

    return {
      id: userId,
      intents: activeIntents.map((i) => ({
        id: i.id,
        title: i.summary ?? '',
        description: i.payload,
        confidence: 1,
      })),
      profile: {
        name: profile?.identity?.name,
        bio: profile?.identity?.bio,
        location: profile?.identity?.location,
      },
    };
  }
}
