import { log } from '../lib/log';
import { IntentDatabaseAdapter, intentDatabaseAdapter } from '../adapters/database.adapter';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { createDefaultNegotiationGraph } from '../lib/protocol/graphs/negotiation.graph';
import type { UserNegotiationContext } from '../lib/protocol/states/negotiation.state';

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

    const graph = createDefaultNegotiationGraph();

    logger.info('Starting discovery negotiation', { sourceUserId, candidateUserId });

    const result = await graph.invoke({
      sourceUser: sourceCtx,
      candidateUser: candidateCtx,
      indexContext: { indexId: '', prompt: '' },
      seedAssessment: { score: 50, reasoning: 'Discovery negotiation', valencyRole: 'peer' },
      maxTurns: 4,
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
        skills: profile?.attributes?.skills,
        interests: profile?.attributes?.interests,
      },
    };
  }
}
