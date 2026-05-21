import { StateGraph } from "@langchain/langgraph";

import { requestContext, type TraceEmitter } from "../shared/observability/request-context.js";
import type { NegotiationDatabase } from "../shared/interfaces/database.interface.js";
import type { NegotiationTimeoutQueue } from "../shared/interfaces/negotiation-events.interface.js";
import type { AgentDispatcher, NegotiationTurnPayload } from "../shared/interfaces/agent-dispatcher.interface.js";
import { NegotiationGraphState, type NegotiationTurn, type NegotiationOutcome, type UserNegotiationContext, type SeedAssessment, type NegotiationGraphLike } from "./negotiation.state.js";
import { IndexNegotiator } from "./negotiation.agent.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";

const logger = protocolLogger("NegotiationGraph");

/**
 * Factory for the bilateral negotiation LangGraph state machine.
 * @remarks Accepts an AgentDispatcher for per-turn agent resolution.
 */
export class NegotiationGraphFactory {
  constructor(
    private database: NegotiationDatabase,
    private dispatcher: AgentDispatcher,
    private timeoutQueue?: NegotiationTimeoutQueue,
  ) {}

  createGraph() {
    const { database, dispatcher, timeoutQueue } = this;
    const systemAgent = new IndexNegotiator();

    const initNode = async (state: typeof NegotiationGraphState.State) => {
      try {
        const conversation = await database.createConversation([
          { participantId: `agent:${state.sourceUser.id}`, participantType: "agent" },
          { participantId: `agent:${state.candidateUser.id}`, participantType: "agent" },
        ]);

        // Determine scenario-based maxTurns before creating the task
        const scope = { action: 'manage:negotiations', scopeType: 'network', scopeId: state.indexContext.networkId };
        const [sourceHasAgent, candidateHasAgent] = await Promise.all([
          dispatcher.hasPersonalAgent(state.sourceUser.id, scope),
          dispatcher.hasPersonalAgent(state.candidateUser.id, scope),
        ]);

        let maxTurns = state.maxTurns;
        if (maxTurns == null) {
          // No explicit override from caller — choose based on agent presence
          if (sourceHasAgent && candidateHasAgent) {
            maxTurns = 0; // unlimited — 24h timeout is the safety valve
          } else if (sourceHasAgent || candidateHasAgent) {
            maxTurns = 8;
          } else {
            maxTurns = 6; // both system agents: default cap
          }
        }

        const task = await database.createTask(conversation.id, {
          type: "negotiation",
          sourceUserId: state.sourceUser.id,
          candidateUserId: state.candidateUser.id,
          // Denormalized so MCP scope checks (negotiation tools, list/get/respond)
          // can filter by network without re-loading the parked turnContext or
          // joining through the opportunity.
          networkId: state.indexContext.networkId,
          ...(state.opportunityId && { opportunityId: state.opportunityId }),
          maxTurns,
        });

        if (state.opportunityId) {
          await database.updateOpportunityStatus(state.opportunityId, 'negotiating').catch((err) => {
            logger.error('[Graph:Init] Failed to set opportunity status to negotiating', { opportunityId: state.opportunityId, error: err });
          });
        }

        return {
          conversationId: conversation.id,
          taskId: task.id,
          currentSpeaker: "source" as const,
          turnCount: 0,
          maxTurns,
        };
      } catch (err) {
        return { error: `Init failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    };

    const turnNode = async (state: typeof NegotiationGraphState.State) => {
      const traceEmitter = requestContext.getStore()?.traceEmitter;
      // Local helper to emit events whose shape is wider than the declared
      // `TraceEmitter` union. The chat agent already casts at its relay sink;
      // here we localize the cast at the callsite so the rest of the body stays typed.
      const emitWide = (event: Record<string, unknown>) =>
        (traceEmitter as ((e: Record<string, unknown>) => void) | undefined)?.(event);
      const agentName = "Index negotiator";
      const agentStart = Date.now();
      traceEmitter?.({ type: "agent_start", name: agentName });

      try {
        const history: NegotiationTurn[] = state.messages.map((m) => {
          const dataPart = (m.parts as Array<{ kind?: string; data?: unknown }>).find((p) => p.kind === "data");
          return dataPart?.data as NegotiationTurn;
        }).filter(Boolean);

        const isSource = state.currentSpeaker === "source";
        const ownUser = isSource ? state.sourceUser : state.candidateUser;
        const otherUser = isSource ? state.candidateUser : state.sourceUser;

        // Determine if this is the system agent's final allowed turn
        const maxTurns = state.maxTurns ?? 0;
        const isFinalTurn = maxTurns > 0 && (state.turnCount + 1) >= maxTurns;

        const payload: NegotiationTurnPayload = {
          negotiationId: state.taskId,
          ownUser,
          otherUser,
          indexContext: state.indexContext,
          seedAssessment: state.seedAssessment,
          history,
          isFinalTurn,
          isDiscoverer: isSource,
          ...(state.discoveryQuery && isSource && { discoveryQuery: state.discoveryQuery }),
        };

        const scope = { action: 'manage:negotiations', scopeType: 'network', scopeId: state.indexContext.networkId };

        const dispatchResult = await dispatcher.dispatch(ownUser.id, scope, payload, { timeoutMs: state.timeoutMs });

        let turn: NegotiationTurn;

        if (dispatchResult.handled) {
          // Personal agent responded
          turn = dispatchResult.turn;
        } else if (dispatchResult.reason === 'waiting') {
          // Long timeout — graph suspends. Persist the full turn context so the
          // polling agent (and MCP consumers via get_negotiation) reconstruct
          // the same view the in-process system agent would see. The view is
          // stored in absolute source/candidate terms; perspective is projected
          // at pickup time using the claiming user's id.
          traceEmitter?.({ type: "agent_end", name: agentName, durationMs: Date.now() - agentStart, summary: "waiting_for_agent" });
          await database.setTaskTurnContext(state.taskId, {
            sourceUser: state.sourceUser,
            candidateUser: state.candidateUser,
            indexContext: state.indexContext,
            seedAssessment: state.seedAssessment,
            // Keep discoveryQuery speaker-scoped: include it only when the
            // parked turn belongs to the discoverer (source). Persisting it on
            // candidate-side turns would make the pickup prompt frame the
            // search as "your user searched for X" for the wrong user.
            ...(isSource && state.discoveryQuery && { discoveryQuery: state.discoveryQuery }),
          });
          await database.updateTaskState(state.taskId, "waiting_for_agent");
          return { status: 'waiting_for_agent' as const };
        } else {
          // No personal agent or timeout — run system agent
          turn = await systemAgent.invoke({
            ownUser,
            otherUser,
            indexContext: state.indexContext,
            seedAssessment: state.seedAssessment,
            history,
            isFinalTurn,
            isDiscoverer: isSource,
            ...(state.discoveryQuery && isSource && { discoveryQuery: state.discoveryQuery }),
          });
        }

        traceEmitter?.({ type: "agent_end", name: agentName, durationMs: Date.now() - agentStart, summary: `${turn.action}` });

        // First turn must be "propose"
        if (state.turnCount === 0 && turn.action !== "propose") {
          logger.warn("[Graph:Turn] Agent returned unexpected action on turn 0, forcing to propose", { action: turn.action });
          turn.action = "propose";
        }

        const parts = [{ kind: "data" as const, data: turn }];
        const message = await database.createMessage({
          conversationId: state.conversationId,
          senderId: `agent:${ownUser.id}`,
          role: "agent",
          parts,
          taskId: state.taskId,
        });

        await database.updateTaskState(state.taskId, "working");

        if (state.opportunityId) {
          emitWide({
            type: "negotiation_turn",
            opportunityId: state.opportunityId,
            negotiationConversationId: state.conversationId,
            turnIndex: state.turnCount,
            actor: isSource ? "source" : "candidate",
            action: turn.action,
            ...(turn.assessment?.reasoning && { reasoning: turn.assessment.reasoning }),
            ...(turn.message && { message: turn.message }),
            ...(turn.assessment?.suggestedRoles && { suggestedRoles: turn.assessment.suggestedRoles }),
            durationMs: Date.now() - agentStart,
          });
        }

        return {
          messages: [{
            id: message.id,
            senderId: message.senderId,
            role: "agent" as const,
            parts: message.parts,
            createdAt: message.createdAt,
          }],
          turnCount: state.turnCount + 1,
          currentSpeaker: (isSource ? "candidate" : "source") as "source" | "candidate",
          lastTurn: turn,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error("[Graph:Turn] Agent invocation failed", { error: errMsg, stack: err instanceof Error ? err.stack : undefined, turnCount: state.turnCount });
        traceEmitter?.({ type: "agent_end", name: agentName, durationMs: Date.now() - agentStart, summary: `error: ${errMsg}` });
        return {
          lastTurn: {
            action: "reject" as const,
            assessment: { reasoning: `Agent error: ${errMsg}`, suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } },
          },
          turnCount: state.turnCount + 1,
          error: `Turn failed: ${errMsg}`,
        };
      }
    };

    const evaluateNode = (state: typeof NegotiationGraphState.State): string => {
      if (state.status === 'waiting_for_agent') return "finalize";
      if (state.error) return "finalize";
      if (!state.lastTurn) return "finalize";
      if (state.lastTurn.action === "accept") return "finalize";
      if (state.lastTurn.action === "reject") return "finalize";
      // question routes same as counter — next turn
      if ((state.maxTurns ?? 0) > 0 && state.turnCount >= state.maxTurns!) return "finalize";
      return "turn";
    };

    const finalizeNode = async (state: typeof NegotiationGraphState.State) => {
      const traceEmitter = requestContext.getStore()?.traceEmitter;
      const emitWide = (event: Record<string, unknown>) =>
        (traceEmitter as ((e: Record<string, unknown>) => void) | undefined)?.(event);

      if (state.status === 'waiting_for_agent') {
        if (state.opportunityId) {
          emitWide({
            type: "negotiation_outcome",
            opportunityId: state.opportunityId,
            outcome: "waiting_for_agent",
            turnCount: state.turnCount,
          });
        }
        return {};
      }

      const history: NegotiationTurn[] = state.messages.map((m) => {
        const dataPart = (m.parts as Array<{ kind?: string; data?: unknown }>).find((p) => p.kind === "data");
        return dataPart?.data as NegotiationTurn;
      }).filter(Boolean);

      const lastTurn = state.lastTurn;
      const hasOpportunity = lastTurn?.action === "accept";
      const atCap = (state.maxTurns ?? 0) > 0 && state.turnCount >= state.maxTurns! && lastTurn?.action !== "accept" && lastTurn?.action !== "reject";

      let agreedRoles: NegotiationOutcome["agreedRoles"] = [];
      if (hasOpportunity && history.length >= 2) {
        const acceptTurn = history[history.length - 1];
        const precedingTurn = history[history.length - 2];
        const accepterIsSource = state.currentSpeaker === "candidate";
        const [sourceRole, candidateRole] = accepterIsSource
          ? [acceptTurn.assessment.suggestedRoles.ownUser, precedingTurn.assessment.suggestedRoles.ownUser]
          : [precedingTurn.assessment.suggestedRoles.ownUser, acceptTurn.assessment.suggestedRoles.ownUser];
        agreedRoles = [
          { userId: state.sourceUser.id, role: sourceRole },
          { userId: state.candidateUser.id, role: candidateRole },
        ];
      }

      const outcome: NegotiationOutcome = {
        hasOpportunity,
        agreedRoles,
        reasoning: lastTurn?.assessment.reasoning ?? "",
        turnCount: state.turnCount,
        ...(atCap && { reason: "turn_cap" as const }),
      };

      try {
        await database.updateTaskState(state.taskId, "completed");
        await database.createArtifact({
          taskId: state.taskId,
          name: "negotiation-outcome",
          parts: [{ kind: "data", data: outcome }],
          metadata: { hasOpportunity, turnCount: state.turnCount },
        });

        if (state.opportunityId) {
          const nextStatus = lastTurn?.action === 'accept'
            ? 'pending'
            : lastTurn?.action === 'reject'
              ? 'rejected'
              : 'stalled';
          await database.updateOpportunityStatus(state.opportunityId, nextStatus).catch((err) => {
            logger.error("[Graph:Finalize] Failed to update opportunity status", { opportunityId: state.opportunityId, nextStatus, error: err });
          });
        }
      } catch (err) {
        logger.error("[Graph:Finalize] Failed to persist outcome", { error: err });
      }

      if (state.opportunityId) {
        const emittedOutcome: "accepted" | "rejected_stalled" | "turn_cap" | "timed_out" =
          hasOpportunity
            ? "accepted"
            : atCap
            ? "turn_cap"
            : state.error && /timeout/i.test(state.error)
            ? "timed_out"
            : lastTurn?.action === "reject"
            ? "rejected_stalled"
            : "rejected_stalled";

        emitWide({
          type: "negotiation_outcome",
          opportunityId: state.opportunityId,
          outcome: emittedOutcome,
          turnCount: state.turnCount,
          ...(outcome.reasoning && { reasoning: outcome.reasoning }),
          ...(hasOpportunity && agreedRoles.length >= 2 && {
            agreedRoles: {
              ownUser: agreedRoles[0]?.role,
              otherUser: agreedRoles[1]?.role,
            },
          }),
        });
      }

      return { outcome, status: 'completed' as const };
    };

    const workflow = new StateGraph(NegotiationGraphState)
      .addNode("init", initNode)
      .addNode("turn", turnNode)
      .addNode("finalize", finalizeNode)
      .addConditionalEdges("turn", evaluateNode, {
        turn: "turn",
        finalize: "finalize",
      })
      .addConditionalEdges("init", (state: typeof NegotiationGraphState.State) => {
        return state.error ? "finalize" : "turn";
      }, { turn: "turn", finalize: "finalize" })
      .addEdge("__start__", "init")
      .addEdge("finalize", "__end__");

    return workflow.compile();
  }
}

export interface NegotiationCandidate {
  userId: string;
  reasoning: string;
  valencyRole: string;
  networkId?: string;
  candidateUser: UserNegotiationContext;
  /** The explicit search query that triggered discovery (if any). */
  discoveryQuery?: string;
  /**
   * ID of the opportunity this negotiation is for. When set, the negotiation
   * graph's finalize node updates the opportunity's status based on the outcome
   * (`accept` → 'pending', `reject` → 'rejected', otherwise → 'stalled').
   */
  opportunityId?: string;
}

export interface NegotiationResult {
  userId: string;
  agreedRoles: NegotiationOutcome["agreedRoles"];
  reasoning: string;
  turnCount: number;
}

/**
 * Per-candidate resolution hook — fires as each negotiation settles, before
 * Promise.all aggregates. Used by the orchestrator branch to progressively
 * stream `opportunity_draft_ready` events as each candidate resolves, rather
 * than emitting all at once after the full fan-out completes. Awaited so the
 * caller can run async work (DB update, event emit) before the next settle.
 *
 * `turns` and `outcome` are passed through from the underlying negotiation
 * graph so consumers can build per-candidate decision-question inputs without
 * re-walking trace events or DB artifacts. Both are present on every
 * resolution (accepted, rejected, stalled, error); error paths receive a
 * synthesized `outcome` with `hasOpportunity: false`.
 */
export type OnNegotiationResolved = (entry: {
  candidate: NegotiationCandidate;
  accepted: NegotiationResult | null;
  turns: NegotiationTurn[];
  outcome: NegotiationOutcome;
}) => Promise<void>;

/**
 * Runs bilateral negotiation for each candidate in parallel.
 * @returns Only candidates that produced an opportunity
 */
export async function negotiateCandidates(
  negotiationGraph: NegotiationGraphLike,
  sourceUser: UserNegotiationContext,
  candidates: NegotiationCandidate[],
  indexContext: { networkId: string; prompt: string },
  opts?: {
    maxTurns?: number;
    traceEmitter?: TraceEmitter;
    indexContextOverrides?: Map<string, string>;
    timeoutMs?: number;
    onCandidateResolved?: OnNegotiationResolved;
    trigger?: "orchestrator" | "ambient";
  },
): Promise<NegotiationResult[]> {
  const { maxTurns, traceEmitter, indexContextOverrides, timeoutMs, onCandidateResolved, trigger } = opts ?? {};

  // Local helper to emit events whose shape is wider than the declared
  // `TraceEmitter` union (mirrors the cast used in chat.agent at the relay sink
  // and inside turn/finalize nodes above).
  const emitWide = (event: Record<string, unknown>) =>
    (traceEmitter as ((e: Record<string, unknown>) => void) | undefined)?.(event);

  const results = await Promise.all(
    candidates.map(async (candidate) => {
      const start = Date.now();
      if (candidate.opportunityId) {
        const candidateName = candidate.candidateUser?.profile?.name;
        emitWide({
          type: "negotiation_session_start",
          opportunityId: candidate.opportunityId,
          negotiationConversationId: "", // filled in on session_end
          sourceUserId: sourceUser.id,
          candidateUserId: candidate.userId,
          ...(candidateName && { candidateName }),
          trigger: trigger ?? "ambient",
          startedAt: start,
        });
      }
      traceEmitter?.({ type: "agent_start", name: "Negotiating candidate" });

      try {
        const candidateIndexContext = candidate.networkId
          ? { networkId: candidate.networkId, prompt: indexContextOverrides?.get(candidate.networkId) ?? '' }
          : indexContext;

        const result = await negotiationGraph.invoke({
          sourceUser,
          candidateUser: candidate.candidateUser,
          indexContext: candidateIndexContext,
          seedAssessment: {
            reasoning: candidate.reasoning,
            valencyRole: candidate.valencyRole,
          },
          ...(candidate.discoveryQuery && { discoveryQuery: candidate.discoveryQuery }),
          ...(candidate.opportunityId && { opportunityId: candidate.opportunityId }),
          ...(maxTurns !== undefined && { maxTurns }),
          ...(timeoutMs !== undefined && { timeoutMs }),
        });

        const durationMs = Date.now() - start;
        const outcome = result.outcome;
        const hasOpportunity = outcome?.hasOpportunity === true;

        const turnFlow = (result.messages ?? [])
          .map((m) => {
            const dataPart = (m.parts as Array<{ kind?: string; data?: Record<string, unknown> }>)?.find((p) => p.kind === "data");
            if (!dataPart?.data) return null;
            const turn = dataPart.data as { action?: string };
            return turn.action ?? "unknown";
          })
          .filter(Boolean)
          .join(" → ");

        const statusTag = hasOpportunity ? "✓ opportunity" : "✗ rejected";
        traceEmitter?.({ type: "agent_end", name: "Negotiating candidate", durationMs, summary: `${candidate.userId}: ${turnFlow} ${statusTag}` });

        if (candidate.opportunityId) {
          emitWide({
            type: "negotiation_session_end",
            opportunityId: candidate.opportunityId,
            negotiationConversationId: (result as { conversationId?: string }).conversationId ?? "",
            durationMs: Date.now() - start,
          });
        }

        const accepted: NegotiationResult | null = hasOpportunity && outcome
          ? {
              userId: candidate.userId,
              agreedRoles: outcome.agreedRoles,
              reasoning: outcome.reasoning,
              turnCount: outcome.turnCount,
            }
          : null;

        if (onCandidateResolved) {
          const turnHistory: NegotiationTurn[] = (result.messages ?? [])
            .map((m) => {
              const dataPart = (m.parts as Array<{ kind?: string; data?: unknown }>)?.find(
                (p) => p.kind === "data",
              );
              return dataPart?.data as NegotiationTurn | undefined;
            })
            .filter((t): t is NegotiationTurn => !!t);
          const resolvedOutcome: NegotiationOutcome = result.outcome ?? {
            hasOpportunity: false,
            agreedRoles: [],
            reasoning: "no outcome returned by negotiation graph",
            turnCount: turnHistory.length,
          };
          try {
            await onCandidateResolved({
              candidate,
              accepted,
              turns: turnHistory,
              outcome: resolvedOutcome,
            });
          } catch (hookErr) {
            // Hook failures must not sink the candidate result — the aggregate
            // return is still useful, and the orchestrator branch logs its own
            // failures inline.
            logger.error("[negotiateCandidates] onCandidateResolved hook threw", {
              candidateUserId: candidate.userId,
              error: hookErr,
            });
          }
        }

        return accepted;
      } catch (err) {
        const durationMs = Date.now() - start;
        traceEmitter?.({ type: "agent_end", name: "Negotiating candidate", durationMs, summary: `${candidate.userId}: error` });
        if (candidate.opportunityId) {
          emitWide({
            type: "negotiation_session_end",
            opportunityId: candidate.opportunityId,
            negotiationConversationId: "",
            durationMs: Date.now() - start,
          });
        }
        logger.error("[negotiateCandidates] Negotiation failed", { candidateUserId: candidate.userId, error: err });
        if (onCandidateResolved) {
          try {
            await onCandidateResolved({
              candidate,
              accepted: null,
              turns: [],
              outcome: {
                hasOpportunity: false,
                agreedRoles: [],
                reasoning: err instanceof Error ? err.message : String(err),
                turnCount: 0,
              },
            });
          } catch {
            // ignore hook failure on error path
          }
        }
        return null;
      }
    }),
  );

  return results.filter((r): r is NegotiationResult => r !== null);
}

/**
 * Creates a negotiation graph with the provided dependencies.
 */
export function createDefaultNegotiationGraph(deps: {
  database: NegotiationDatabase;
  dispatcher: AgentDispatcher;
  timeoutQueue?: NegotiationTimeoutQueue;
}) {
  const factory = new NegotiationGraphFactory(deps.database, deps.dispatcher, deps.timeoutQueue);
  return factory.createGraph();
}
