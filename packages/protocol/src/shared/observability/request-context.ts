import type { Opportunity } from "../interfaces/database.interface.js";
import { AsyncLocalStorage } from "async_hooks";

/**
 * Callback for streaming trace / domain events from deep inside graph nodes
 * back to the caller (typically chat.agent's stream pipeline).
 *
 * Carries two flavors of event:
 * - Trace events (`graph_start | graph_end | agent_start | agent_end`) — used
 *   by the chat TRACE panel to visualize what the agent is doing.
 * - Domain events (`opportunity_draft_ready`) — emitted by the orchestrator
 *   branch of OpportunityGraph.negotiateNode so the frontend can render each
 *   accepted draft card progressively as its negotiation resolves.
 *
 * Kept as a single emitter rather than splitting into two to minimize plumbing
 * through AsyncLocalStorage; the chat.agent relay branches on event.type.
 */
export type TraceEmitter = (
  event:
    | {
        type: "graph_start" | "graph_end" | "agent_start" | "agent_end";
        name: string;
        durationMs?: number;
        summary?: string;
      }
    | {
        // Emitted by the ask_user_question tool: structured questions were
        // persisted and the turn is now blocked awaiting the user's answer.
        // Carries persisted question ids so the frontend can answer them
        // through the questions REST endpoints while the stream is live.
        type: "user_question";
        questions: Array<{ id: string }>;
      }
    | {
        // Lightweight keep-alive/status line. Used by long-blocking tools
        // (ask_user_question wait loop) so SSE transports do not idle out.
        type: "status";
        message: string;
      }
    | {
        type: "opportunity_draft_ready";
        opportunityId: string;
        opportunity: Opportunity;
        /** Viewer-centric summary derived from interpretation.reasoning. */
        personalizedSummary?: string;
        /**
         * Minimal counterparty data for rendering the inline card without a
         * second-round-trip user lookup. Populated from the negotiation
         * candidate's profile; avatar is intentionally omitted (the card
         * falls back to initials) since UserNegotiationContext doesn't
         * carry avatars.
         */
        counterparty: {
          userId: string;
          name?: string;
        };
      },
) => void;

interface RequestContext {
  originUrl?: string;
  traceEmitter?: TraceEmitter;
  /**
   * Signal for cooperative cancellation — propagates the caller's AbortSignal
   * into long-running graph nodes (e.g. orchestrator negotiation fan-out) so
   * they can stop emitting events when the chat session closes.
   *
   * The orchestrator branch checks this before persisting status flips or
   * pushing `opportunity_draft_ready` events. In-flight negotiations are not
   * forcibly cancelled — they finish or time out naturally via their park
   * window — but their results are suppressed once the signal trips.
   */
  abortSignal?: AbortSignal;
}

/**
 * AsyncLocalStorage for propagating request-scoped context through the protocol layer.
 * The host application is responsible for calling `requestContext.run()` to set the context.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();
