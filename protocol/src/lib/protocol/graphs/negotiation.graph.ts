/**
 * Negotiation Graph: Agent-to-Agent Negotiation Workflow
 * 
 * Architecture: Follows LangGraph patterns with Annotation-based state.
 * Flow: Init → Turn → ExtensionCheck → (Loop or Resolve) → Persist → END
 * 
 * Key Features:
 * - Adaptive turn limits (3-5 turns based on agent decisions)
 * - Bilateral negotiation between two agents
 * - Creates opportunity on successful agreement
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import type { Id } from '../../../types/common.types';
import {
  NegotiationGraphState,
  type PrincipalContext,
  type NegotiationProfileData,
  type NegotiationIntentData,
} from '../states/negotiation.state';
import type {
  NegotiationParticipant,
  NegotiationTurn,
  NegotiationResolution,
  NegotiationDecision,
  NegotiationOutcome,
  NegotiationAgentInput,
  NegotiationTrigger,
} from '../../../types/negotiation.types';
import type { OpportunityActor, OpportunityDetection, OpportunityInterpretation, OpportunityContext } from '../../../schemas/database.schema';
import { NegotiationAgent } from '../agents/negotiation.agent';
import { protocolLogger, withCallLogging } from '../support/protocol.logger';
import { timed } from '../../performance';

const logger = protocolLogger('NegotiationGraph');

/**
 * Database interface for negotiation graph.
 * Abstracts all database operations needed by the negotiation workflow.
 */
export interface NegotiationGraphDatabase {
  /** Get user profile data */
  getProfile(userId: string): Promise<{
    identity?: { name?: string; bio?: string; location?: string };
    narrative?: { context?: string };
    attributes?: { interests?: string[]; skills?: string[] };
  } | null>;
  /** Get active intents for a user */
  getActiveIntents(userId: string): Promise<Array<{
    id: string;
    payload: string;
    summary?: string;
  }>>;
  /** Get user display name */
  getUserName(userId: string): Promise<string | null>;
  /** Create a new negotiation record */
  createNegotiation(data: {
    status: string;
    participants: NegotiationParticipant[];
    trigger: NegotiationTrigger;
    turns: NegotiationTurn[];
    currentTurn: number;
    maxTurns: number;
  }): Promise<{ id: string }>;
  /** Update an existing negotiation */
  updateNegotiation(id: string, data: {
    status?: string;
    outcome?: NegotiationOutcome;
    turns?: NegotiationTurn[];
    currentTurn?: number;
    maxTurns?: number;
    resolution?: NegotiationResolution;
    opportunityId?: string;
  }): Promise<void>;
  /** Create an opportunity from a successful negotiation */
  createOpportunity(data: {
    detection: OpportunityDetection;
    actors: OpportunityActor[];
    interpretation: OpportunityInterpretation;
    context: OpportunityContext;
    confidence: string;
    status: string;
  }): Promise<{ id: string }>;
}

/**
 * Factory class to build and compile the Negotiation Graph.
 * 
 * Orchestrates agent-to-agent negotiation workflows with adaptive turn limits.
 * Uses dependency injection for database and agent to enable testing.
 * 
 * @remarks
 * The database adapter is required and must implement all NegotiationGraphDatabase methods.
 * For testing, inject a mock implementation.
 */
export class NegotiationGraphFactory {
  /**
   * Creates a new NegotiationGraphFactory.
   * @param database - Database adapter for persistence operations (required)
   * @param agent - Optional negotiation agent (defaults to new NegotiationAgent)
   */
  constructor(
    private database: NegotiationGraphDatabase,
    private agent?: NegotiationAgent
  ) {}

  /**
   * Creates and compiles the negotiation graph.
   * @returns Compiled LangGraph workflow
   */
  public createGraph() {
    const negotiationAgent = this.agent ?? new NegotiationAgent();
    const database = this.database;

    // ═══════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    const loadPrincipalContext = async (userId: string): Promise<PrincipalContext | null> => {
      try {
        let profile: NegotiationProfileData = {};
        let intents: NegotiationIntentData[] = [];

        const profileResult = await database.getProfile(userId);
        if (profileResult) {
          profile = {
            name: profileResult.identity?.name,
            bio: profileResult.identity?.bio,
            location: profileResult.identity?.location,
            interests: profileResult.attributes?.interests,
            skills: profileResult.attributes?.skills,
            context: profileResult.narrative?.context,
          };
        }
        if (!profile.name) {
          profile.name = await database.getUserName(userId) ?? undefined;
        }
        const intentsResult = await database.getActiveIntents(userId);
        intents = intentsResult.map(i => ({
          intentId: i.id as Id<'intents'>,
          payload: i.payload,
          summary: i.summary,
        }));

        return {
          userId: userId as Id<'users'>,
          profile,
          intents,
        };
      } catch (error) {
        logger.error('[LoadPrincipalContext] Error', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    };

    const isTerminalDecision = (decision: NegotiationDecision): boolean => {
      return decision === 'accept' || decision === 'decline' || decision === 'defer';
    };

    const decisionToOutcome = (decision: NegotiationDecision): NegotiationOutcome => {
      switch (decision) {
        case 'accept': return 'opportunity';
        case 'decline': return 'disengaged';
        case 'defer': return 'deferred';
        default: return 'disengaged';
      }
    };

    // ═══════════════════════════════════════════════════════════════
    // NODE DEFINITIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Node: Init
     * Load principal contexts and create negotiation record.
     */
    const initNode = async (state: typeof NegotiationGraphState.State) =>
      timed("NegotiationGraph.init", async () =>
        withCallLogging(logger, '[Graph:Init] initNode', {
          initiatorUserId: state.initiatorUserId,
          responderUserId: state.responderUserId,
        }, async () => {
          const [initiatorContext, responderContext] = await Promise.all([
            loadPrincipalContext(state.initiatorUserId),
            loadPrincipalContext(state.responderUserId),
          ]);

          if (!initiatorContext || !responderContext) {
            return {
              error: 'Failed to load principal contexts',
              trace: [{ node: 'init', detail: 'Missing principal context' }],
            };
          }

          const participants: NegotiationParticipant[] = [
            { userId: state.initiatorUserId, role: 'initiator' },
            { userId: state.responderUserId, role: 'responder' },
          ];

          // Create negotiation record via adapter
          const negotiation = await database.createNegotiation({
            status: 'initiated',
            participants,
            trigger: state.trigger,
            turns: [],
            currentTurn: 0,
            maxTurns: state.options.maxTurns ?? 3,
          });

          return {
            initiatorContext,
            responderContext,
            participants,
            createdNegotiationId: negotiation?.id ?? null,
            maxTurns: state.options.maxTurns ?? 3,
            currentTurn: 0,
            currentParticipantUserId: state.initiatorUserId,
            status: 'in_progress' as const,
            trace: [{
              node: 'init',
              detail: 'Loaded contexts and created negotiation',
              data: {
                negotiationId: negotiation?.id,
                initiatorIntents: initiatorContext.intents.length,
                responderIntents: responderContext.intents.length,
              },
            }],
          };
        })
      );

    /**
     * Node: Turn
     * Execute agent turn for current participant.
     */
    const turnNode = async (state: typeof NegotiationGraphState.State) =>
      timed("NegotiationGraph.turn", async () =>
        withCallLogging(logger, '[Graph:Turn] turnNode', {
          currentTurn: state.currentTurn,
          currentParticipant: state.currentParticipantUserId,
        }, async () => {
          if (!state.initiatorContext || !state.responderContext) {
            return { error: 'Missing principal contexts' };
          }

          const isInitiator = state.currentParticipantUserId === state.initiatorUserId;
          const principal = isInitiator ? state.initiatorContext : state.responderContext;
          const counterparty = isInitiator ? state.responderContext : state.initiatorContext;

          const agentInput: NegotiationAgentInput = {
            principal: {
              userId: principal.userId,
              profile: principal.profile,
              activeIntents: principal.intents,
            },
            counterparty: {
              userId: counterparty.userId,
              profile: counterparty.profile,
              activeIntents: counterparty.intents,
            },
            negotiationState: {
              turns: state.turns,
              currentTurn: state.currentTurn,
              trigger: state.trigger,
            },
            action: state.currentTurn === 0 ? 'generate_turn' : 'evaluate_response',
          };

          const agentOutput = await negotiationAgent.invoke(agentInput);

          const newTurn: NegotiationTurn = {
            turn: state.currentTurn + 1,
            participantUserId: state.currentParticipantUserId as Id<'users'>,
            message: agentOutput.message || { context: 'Turn message' },
            decision: agentOutput.decision,
            reasoning: agentOutput.reasoning,
            extendReason: agentOutput.extendReason,
            timestamp: new Date().toISOString(),
          };

          const updatedTurns = [...state.turns, newTurn];

          // Update negotiation record via adapter
          if (state.createdNegotiationId) {
            await database.updateNegotiation(state.createdNegotiationId, {
              turns: updatedTurns,
              currentTurn: state.currentTurn + 1,
              status: 'in_progress',
            });
          }

          return {
            turns: updatedTurns,
            currentTurn: state.currentTurn + 1,
            latestAgentOutput: agentOutput,
            trace: [{
              node: 'turn',
              detail: `Turn ${state.currentTurn + 1} complete`,
              data: {
                participant: state.currentParticipantUserId,
                decision: agentOutput.decision,
              },
            }],
          };
        })
      );

    /**
     * Node: Extension Check
     * Decide if negotiation should extend, continue, or resolve.
     */
    const extensionCheckNode = async (state: typeof NegotiationGraphState.State) =>
      timed("NegotiationGraph.extensionCheck", async () =>
        withCallLogging(logger, '[Graph:ExtensionCheck] extensionCheckNode', {
          currentTurn: state.currentTurn,
          maxTurns: state.maxTurns,
          decision: state.latestAgentOutput?.decision,
        }, async () => {
          const decision = state.latestAgentOutput?.decision;

          // Handle extension request
          if (decision === 'extend' && state.currentTurn < 5) {
            const newMaxTurns = Math.min(state.maxTurns + 1, 5);

            if (state.createdNegotiationId) {
              await database.updateNegotiation(state.createdNegotiationId, {
                maxTurns: newMaxTurns,
              });
            }

            return {
              maxTurns: newMaxTurns,
              trace: [{
                node: 'extensionCheck',
                detail: `Extended to ${newMaxTurns} turns`,
                data: { reason: state.latestAgentOutput?.extendReason },
              }],
            };
          }

          return {
            trace: [{
              node: 'extensionCheck',
              detail: 'No extension needed',
            }],
          };
        })
      );

    /**
     * Node: Resolution
     * Finalize negotiation outcome.
     */
    const resolutionNode = async (state: typeof NegotiationGraphState.State) =>
      timed("NegotiationGraph.resolution", async () =>
        withCallLogging(logger, '[Graph:Resolution] resolutionNode', {
          currentTurn: state.currentTurn,
          decision: state.latestAgentOutput?.decision,
        }, async () => {
          const decision = state.latestAgentOutput?.decision ?? 'decline';
          const outcome = decisionToOutcome(decision);

          const resolution: NegotiationResolution = {
            reasoning: state.latestAgentOutput?.reasoning ?? 'Negotiation concluded',
            outcome,
          };

          return {
            outcome,
            resolution,
            status: 'resolved' as const,
            trace: [{
              node: 'resolution',
              detail: `Resolved with outcome: ${outcome}`,
            }],
          };
        })
      );

    /**
     * Node: Persist
     * Save final state and create opportunity if accepted.
     */
    const persistNode = async (state: typeof NegotiationGraphState.State) =>
      timed("NegotiationGraph.persist", async () =>
        withCallLogging(logger, '[Graph:Persist] persistNode', {
          outcome: state.outcome,
          negotiationId: state.createdNegotiationId,
        }, async () => {
          let opportunityId: string | null = null;

          // Create opportunity if accepted
          if (state.outcome === 'opportunity' && state.createdNegotiationId) {
            const actors: OpportunityActor[] = state.participants.map(p => ({
              indexId: (state.trigger.indexId || '') as Id<'indexes'>,
              userId: p.userId,
              role: p.role === 'initiator' ? 'agent' : 'patient',
              intent: state.trigger.intentId,
            }));

            const lastTurn = state.turns[state.turns.length - 1];
            const interpretation: OpportunityInterpretation = {
              category: 'negotiated_connection',
              reasoning: lastTurn?.reasoning || 'Agents agreed this connection is worthwhile',
              confidence: 0.85,
            };

            const detection: OpportunityDetection = {
              source: 'negotiation',
              negotiationId: state.createdNegotiationId as Id<'negotiations'>,
              triggeredBy: state.trigger.intentId,
              timestamp: new Date().toISOString(),
            };

            const context: OpportunityContext = {
              indexId: state.trigger.indexId as Id<'indexes'> | undefined,
            };

            const opportunity = await database.createOpportunity({
              detection,
              actors,
              interpretation,
              context,
              confidence: '0.85',
              status: 'pending',
            });

            opportunityId = opportunity?.id ?? null;

            if (state.resolution && opportunityId) {
              state.resolution.opportunityId = opportunityId as Id<'opportunities'>;
            }
          }

          // Update negotiation record with final state via adapter
          if (state.createdNegotiationId) {
            await database.updateNegotiation(state.createdNegotiationId, {
              status: 'resolved',
              outcome: state.outcome,
              resolution: state.resolution,
              opportunityId: opportunityId ?? undefined,
            });
          }

          return {
            opportunityId,
            trace: [{
              node: 'persist',
              detail: opportunityId ? `Created opportunity ${opportunityId}` : 'Persisted without opportunity',
            }],
          };
        })
      );

    /**
     * Node: Switch Participant
     * Switch to the other participant for the next turn.
     */
    const switchParticipantNode = async (state: typeof NegotiationGraphState.State) =>
      timed("NegotiationGraph.switchParticipant", async () => {
        const nextParticipant = state.currentParticipantUserId === state.initiatorUserId
          ? state.responderUserId
          : state.initiatorUserId;

        return {
          currentParticipantUserId: nextParticipant,
          trace: [{
            node: 'switchParticipant',
            detail: `Switched to ${nextParticipant}`,
          }],
        };
      });

    // ═══════════════════════════════════════════════════════════════
    // CONDITIONAL ROUTING
    // ═══════════════════════════════════════════════════════════════

    /**
     * After turn: decide if we should resolve, extend, or continue.
     */
    const afterTurnCondition = (state: typeof NegotiationGraphState.State): string => {
      const decision = state.latestAgentOutput?.decision;

      // Terminal decisions end negotiation
      if (isTerminalDecision(decision as NegotiationDecision)) {
        logger.info('[Graph:Condition] Terminal decision, routing to resolution', { decision });
        return 'resolution';
      }

      // Max turns reached
      if (state.currentTurn >= state.maxTurns) {
        logger.info('[Graph:Condition] Max turns reached, routing to resolution', {
          currentTurn: state.currentTurn,
          maxTurns: state.maxTurns,
        });
        return 'resolution';
      }

      // Extension request
      if (decision === 'extend') {
        logger.info('[Graph:Condition] Extension requested, routing to extensionCheck');
        return 'extensionCheck';
      }

      // Continue negotiation
      logger.info('[Graph:Condition] Continuing to next turn');
      return 'switchParticipant';
    };

    /**
     * After extension check: continue or resolve.
     */
    const afterExtensionCondition = (state: typeof NegotiationGraphState.State): string => {
      // If we can still negotiate, switch participant
      if (state.currentTurn < state.maxTurns) {
        return 'switchParticipant';
      }
      // Otherwise resolve
      return 'resolution';
    };

    // ═══════════════════════════════════════════════════════════════
    // GRAPH ASSEMBLY
    // ═══════════════════════════════════════════════════════════════

    const workflow = new StateGraph(NegotiationGraphState)
      .addNode("init", initNode)
      .addNode("turn", turnNode)
      .addNode("extensionCheck", extensionCheckNode)
      .addNode("switchParticipant", switchParticipantNode)
      .addNode("resolution", resolutionNode)
      .addNode("persist", persistNode)

      // Entry point
      .addEdge(START, "init")
      .addEdge("init", "turn")

      // After turn: conditional routing
      .addConditionalEdges("turn", afterTurnCondition, {
        resolution: "resolution",
        extensionCheck: "extensionCheck",
        switchParticipant: "switchParticipant",
      })

      // After extension check
      .addConditionalEdges("extensionCheck", afterExtensionCondition, {
        switchParticipant: "switchParticipant",
        resolution: "resolution",
      })

      // Switch participant leads back to turn
      .addEdge("switchParticipant", "turn")

      // Resolution leads to persist
      .addEdge("resolution", "persist")

      // Persist ends the graph
      .addEdge("persist", END);

    return workflow.compile();
  }
}
