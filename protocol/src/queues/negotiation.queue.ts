import { Job } from 'bullmq';
import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import type { Id } from '../types/common.types';
import type {
  NegotiationParticipant,
  NegotiationTrigger,
  NegotiationTurn,
  NegotiationResolution,
  NegotiationAgentInput,
  NegotiationDecision,
  NegotiationStatus,
  NegotiationOutcome,
} from '../types/negotiation.types';
import { NegotiationAgent } from '../lib/protocol/agents/negotiation.agent';

export const QUEUE_NAME = 'negotiation-queue';

/** Payload for initiating a new negotiation */
export interface InitiateNegotiationJobData {
  initiatorUserId: string;
  responderUserId: string;
  trigger: NegotiationTrigger;
  indexId?: string;
}

/** Payload for processing a negotiation turn */
export interface ProcessTurnJobData {
  negotiationId: string;
}

/** Union type for all negotiation job data */
export type NegotiationJobData = 
  | { type: 'initiate_negotiation'; data: InitiateNegotiationJobData }
  | { type: 'process_turn'; data: ProcessTurnJobData };

/** Profile data for negotiation */
interface ProfileData {
  name?: string;
  bio?: string;
  location?: string;
  interests?: string[];
  skills?: string[];
  context?: string;
}

/** Active intent data */
interface ActiveIntentData {
  intentId: Id<'intents'>;
  payload: string;
  summary?: string;
}

/**
 * NegotiationQueue handles agent-to-agent negotiation jobs via BullMQ.
 * 
 * Supports two job types:
 * - `initiate_negotiation`: Creates a new negotiation record and generates Turn 1
 * - `process_turn`: Processes the next turn in an existing negotiation
 * 
 * @remarks
 * Jobs use exponential backoff with 3 retries. Completed jobs are removed after 24h,
 * failed jobs after 7 days. The queue does NOT stream progress events - use the
 * synchronous runner (negotiation.runner.ts) for real-time UI updates.
 */
export class NegotiationQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<NegotiationJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('NegotiationJob');
  private readonly queueLogger = log.queue.from('NegotiationQueue');
  private worker: ReturnType<typeof QueueFactory.createWorker<NegotiationJobData>> | null = null;

  /**
   * Add an initiate_negotiation job.
   */
  async addInitiateJob(
    data: InitiateNegotiationJobData,
    options?: { jobId?: string; priority?: number }
  ): Promise<Job<NegotiationJobData>> {
    const jobData: NegotiationJobData = { type: 'initiate_negotiation', data };
    return this.queue.add('initiate_negotiation', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
      jobId: options?.jobId,
      priority: options?.priority,
    });
  }

  /**
   * Add a process_turn job.
   */
  async addProcessTurnJob(
    data: ProcessTurnJobData,
    options?: { jobId?: string; priority?: number; delay?: number }
  ): Promise<Job<NegotiationJobData>> {
    const jobData: NegotiationJobData = { type: 'process_turn', data };
    return this.queue.add('process_turn', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
      jobId: options?.jobId,
      priority: options?.priority,
      delay: options?.delay,
    });
  }

  /**
   * Process a job by name.
   */
  async processJob(name: string, jobData: NegotiationJobData): Promise<void> {
    switch (jobData.type) {
      case 'initiate_negotiation':
        await this.handleInitiateNegotiation(jobData.data);
        break;
      case 'process_turn':
        await this.handleProcessTurn(jobData.data);
        break;
      default:
        this.queueLogger.warn(`[NegotiationProcessor] Unknown job type`);
    }
  }

  /**
   * Start the BullMQ worker.
   */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<NegotiationJobData>) => {
      this.queueLogger.info(`[NegotiationProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<NegotiationJobData>(QUEUE_NAME, processor);
  }

  /**
   * Handle initiate_negotiation job.
   * Creates a negotiation record and generates Turn 1.
   */
  private async handleInitiateNegotiation(data: InitiateNegotiationJobData): Promise<void> {
    const { initiatorUserId, responderUserId, trigger, indexId } = data;

    this.logger.info('[InitiateNegotiation] Starting', {
      initiatorUserId,
      responderUserId,
      triggerSource: trigger.source,
    });

    // Load principal contexts
    const [initiatorContext, responderContext] = await Promise.all([
      this.loadPrincipalContext(initiatorUserId),
      this.loadPrincipalContext(responderUserId),
    ]);

    if (!initiatorContext || !responderContext) {
      this.logger.warn('[InitiateNegotiation] Missing principal context, skipping', {
        hasInitiator: !!initiatorContext,
        hasResponder: !!responderContext,
      });
      return;
    }

    // Create negotiation record
    const participants: NegotiationParticipant[] = [
      { userId: initiatorUserId as Id<'users'>, role: 'initiator' },
      { userId: responderUserId as Id<'users'>, role: 'responder' },
    ];

    const [negotiation] = await db.insert(schema.negotiations)
      .values({
        status: 'initiated',
        participants,
        trigger,
        turns: [],
        currentTurn: 0,
        maxTurns: 3,
      })
      .returning();

    if (!negotiation) {
      this.logger.error('[InitiateNegotiation] Failed to create negotiation record');
      return;
    }

    // Run initiator agent to generate Turn 1
    const agent = new NegotiationAgent();
    const agentInput: NegotiationAgentInput = {
      principal: {
        userId: initiatorUserId as Id<'users'>,
        profile: initiatorContext.profile,
        activeIntents: initiatorContext.intents,
      },
      counterparty: {
        userId: responderUserId as Id<'users'>,
        profile: responderContext.profile,
        activeIntents: responderContext.intents,
      },
      negotiationState: {
        turns: [],
        currentTurn: 0,
        trigger,
      },
      action: 'generate_turn',
    };

    const agentOutput = await agent.invoke(agentInput);

    // Create Turn 1
    const turn1: NegotiationTurn = {
      turn: 1,
      participantUserId: initiatorUserId as Id<'users'>,
      message: agentOutput.message || { context: 'Opening negotiation' },
      decision: agentOutput.decision,
      reasoning: agentOutput.reasoning,
      extendReason: agentOutput.extendReason,
      timestamp: new Date().toISOString(),
    };

    // Update negotiation with Turn 1
    await db.update(schema.negotiations)
      .set({
        status: 'in_progress',
        turns: [turn1],
        currentTurn: 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.negotiations.id, negotiation.id));

    // Check if negotiation should continue or resolve
    if (this.isTerminalDecision(agentOutput.decision)) {
      await this.resolveNegotiation(negotiation.id, agentOutput.decision, agentOutput.reasoning);
    } else {
      // Enqueue next turn for responder
      await this.addProcessTurnJob(
        { negotiationId: negotiation.id },
        { delay: 100 } // Small delay between turns
      );
    }

    this.logger.info('[InitiateNegotiation] Complete', {
      negotiationId: negotiation.id,
      turn1Decision: agentOutput.decision,
    });
  }

  /**
   * Handle process_turn job.
   * Processes the next turn in an existing negotiation.
   */
  private async handleProcessTurn(data: ProcessTurnJobData): Promise<void> {
    const { negotiationId } = data;

    // Load negotiation
    const [negotiation] = await db.select()
      .from(schema.negotiations)
      .where(eq(schema.negotiations.id, negotiationId))
      .limit(1);

    if (!negotiation) {
      this.logger.warn('[ProcessTurn] Negotiation not found', { negotiationId });
      return;
    }

    if (negotiation.status === 'resolved' || negotiation.status === 'expired') {
      this.logger.info('[ProcessTurn] Negotiation already resolved', { negotiationId });
      return;
    }

    const turns = negotiation.turns as NegotiationTurn[];
    const participants = negotiation.participants as NegotiationParticipant[];
    const trigger = negotiation.trigger as NegotiationTrigger;
    const currentTurnNumber = negotiation.currentTurn;

    // Determine whose turn it is
    const lastTurn = turns[turns.length - 1];
    const currentParticipant = participants.find(p => p.userId !== lastTurn?.participantUserId);

    if (!currentParticipant) {
      this.logger.error('[ProcessTurn] Could not determine current participant', { negotiationId });
      return;
    }

    const otherParticipant = participants.find(p => p.userId !== currentParticipant.userId);
    if (!otherParticipant) {
      this.logger.error('[ProcessTurn] Could not determine other participant', { negotiationId });
      return;
    }

    // Load contexts
    const [currentContext, otherContext] = await Promise.all([
      this.loadPrincipalContext(currentParticipant.userId),
      this.loadPrincipalContext(otherParticipant.userId),
    ]);

    if (!currentContext || !otherContext) {
      this.logger.warn('[ProcessTurn] Missing principal context', { negotiationId });
      return;
    }

    // Run agent for current participant
    const agent = new NegotiationAgent();
    const agentInput: NegotiationAgentInput = {
      principal: {
        userId: currentParticipant.userId,
        profile: currentContext.profile,
        activeIntents: currentContext.intents,
      },
      counterparty: {
        userId: otherParticipant.userId,
        profile: otherContext.profile,
        activeIntents: otherContext.intents,
      },
      negotiationState: {
        turns,
        currentTurn: currentTurnNumber,
        trigger,
      },
      action: 'evaluate_response',
    };

    const agentOutput = await agent.invoke(agentInput);

    // Create new turn
    const newTurn: NegotiationTurn = {
      turn: currentTurnNumber + 1,
      participantUserId: currentParticipant.userId,
      message: agentOutput.message || { context: 'Responding' },
      decision: agentOutput.decision,
      reasoning: agentOutput.reasoning,
      extendReason: agentOutput.extendReason,
      timestamp: new Date().toISOString(),
    };

    const updatedTurns = [...turns, newTurn];

    // Handle extension request
    let newMaxTurns = negotiation.maxTurns;
    if (agentOutput.decision === 'extend' && currentTurnNumber < 5) {
      newMaxTurns = Math.min(negotiation.maxTurns + 1, 5);
      this.logger.info('[ProcessTurn] Extending negotiation', {
        negotiationId,
        newMaxTurns,
        reason: agentOutput.extendReason,
      });
    }

    // Update negotiation
    await db.update(schema.negotiations)
      .set({
        turns: updatedTurns,
        currentTurn: currentTurnNumber + 1,
        maxTurns: newMaxTurns,
        updatedAt: new Date(),
      })
      .where(eq(schema.negotiations.id, negotiationId));

    // Check if negotiation should resolve
    const shouldResolve = 
      this.isTerminalDecision(agentOutput.decision) ||
      currentTurnNumber + 1 >= newMaxTurns;

    if (shouldResolve) {
      const finalDecision = this.isTerminalDecision(agentOutput.decision)
        ? agentOutput.decision
        : this.determineFinalDecision(updatedTurns);
      await this.resolveNegotiation(negotiationId, finalDecision, agentOutput.reasoning);
    } else {
      // Continue negotiation
      await this.addProcessTurnJob(
        { negotiationId },
        { delay: 100 }
      );
    }

    this.logger.info('[ProcessTurn] Complete', {
      negotiationId,
      turn: currentTurnNumber + 1,
      decision: agentOutput.decision,
      resolved: shouldResolve,
    });
  }

  /**
   * Load principal context (profile + active intents) for a user.
   */
  private async loadPrincipalContext(userId: string): Promise<{
    profile: ProfileData;
    intents: ActiveIntentData[];
  } | null> {
    try {
      // Load profile
      const [profileResult] = await db.select()
        .from(schema.userProfiles)
        .where(eq(schema.userProfiles.userId, userId))
        .limit(1);

      const profile: ProfileData = profileResult ? {
        name: (profileResult.identity as { name?: string })?.name,
        bio: (profileResult.identity as { bio?: string })?.bio,
        location: (profileResult.identity as { location?: string })?.location,
        interests: (profileResult.attributes as { interests?: string[] })?.interests,
        skills: (profileResult.attributes as { skills?: string[] })?.skills,
        context: (profileResult.narrative as { context?: string })?.context,
      } : {};

      // Load user name if not in profile
      if (!profile.name) {
        const [user] = await db.select({ name: schema.users.name })
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .limit(1);
        if (user) profile.name = user.name;
      }

      // Load active intents
      const intentsResult = await db.select({
        id: schema.intents.id,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
      })
        .from(schema.intents)
        .where(
          and(
            eq(schema.intents.userId, userId),
            isNull(schema.intents.archivedAt)
          )
        )
        .orderBy(desc(schema.intents.createdAt))
        .limit(10); // Limit to recent intents

      const intents: ActiveIntentData[] = intentsResult.map(i => ({
        intentId: i.id as Id<'intents'>,
        payload: i.payload,
        summary: i.summary ?? undefined,
      }));

      return { profile, intents };
    } catch (error) {
      this.logger.error('[LoadPrincipalContext] Error', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Check if a decision is terminal (ends negotiation).
   */
  private isTerminalDecision(decision: NegotiationDecision): boolean {
    return decision === 'accept' || decision === 'decline' || decision === 'defer';
  }

  /**
   * Determine final decision when max turns reached.
   */
  private determineFinalDecision(turns: NegotiationTurn[]): NegotiationDecision {
    // If any turn had accept, use accept
    if (turns.some(t => t.decision === 'accept')) return 'accept';
    // If both sides continued/extended, default to defer (timing uncertainty)
    return 'defer';
  }

  /**
   * Resolve a negotiation with a final outcome.
   */
  private async resolveNegotiation(
    negotiationId: string,
    decision: NegotiationDecision,
    reasoning: string
  ): Promise<void> {
    const outcome = this.decisionToOutcome(decision);

    const resolution: NegotiationResolution = {
      reasoning,
      outcome,
    };

    // If accepted, create an opportunity
    let opportunityId: string | undefined;
    if (outcome === 'opportunity') {
      opportunityId = await this.createOpportunityFromNegotiation(negotiationId);
      if (opportunityId) {
        resolution.opportunityId = opportunityId as Id<'opportunities'>;
      }
    }

    await db.update(schema.negotiations)
      .set({
        status: 'resolved',
        outcome,
        resolution,
        opportunityId,
        updatedAt: new Date(),
      })
      .where(eq(schema.negotiations.id, negotiationId));

    this.logger.info('[ResolveNegotiation] Complete', {
      negotiationId,
      outcome,
      opportunityId,
    });
  }

  /**
   * Map decision to outcome.
   */
  private decisionToOutcome(decision: NegotiationDecision): NegotiationOutcome {
    switch (decision) {
      case 'accept': return 'opportunity';
      case 'decline': return 'disengaged';
      case 'defer': return 'deferred';
      default: return 'disengaged';
    }
  }

  /**
   * Create an opportunity from a successful negotiation.
   */
  private async createOpportunityFromNegotiation(negotiationId: string): Promise<string | null> {
    try {
      // Load negotiation
      const [negotiation] = await db.select()
        .from(schema.negotiations)
        .where(eq(schema.negotiations.id, negotiationId))
        .limit(1);

      if (!negotiation) return null;

      const participants = negotiation.participants as NegotiationParticipant[];
      const trigger = negotiation.trigger as NegotiationTrigger;
      const turns = negotiation.turns as NegotiationTurn[];

      // Build opportunity actors
      const actors: schema.OpportunityActor[] = participants.map(p => ({
        indexId: (trigger.indexId || '') as Id<'indexes'>,
        userId: p.userId,
        role: p.role === 'initiator' ? 'agent' : 'patient',
        intent: trigger.intentId,
      }));

      // Build interpretation from negotiation
      const lastTurn = turns[turns.length - 1];
      const interpretation: schema.OpportunityInterpretation = {
        category: 'negotiated_connection',
        reasoning: lastTurn?.reasoning || 'Agents agreed this connection is worthwhile',
        confidence: 0.85, // High confidence since both agents agreed
      };

      // Build detection
      const detection: schema.OpportunityDetection = {
        source: 'negotiation',
        negotiationId: negotiationId as Id<'negotiations'>,
        triggeredBy: trigger.intentId,
        timestamp: new Date().toISOString(),
      };

      // Build context
      const context: schema.OpportunityContext = {
        indexId: trigger.indexId as Id<'indexes'> | undefined,
      };

      // Create opportunity
      const [opportunity] = await db.insert(schema.opportunities)
        .values({
          detection,
          actors,
          interpretation,
          context,
          confidence: '0.85',
          status: 'pending',
        })
        .returning({ id: schema.opportunities.id });

      return opportunity?.id || null;
    } catch (error) {
      this.logger.error('[CreateOpportunityFromNegotiation] Error', {
        negotiationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

/** Singleton negotiation queue instance */
export const negotiationQueue = new NegotiationQueue();
