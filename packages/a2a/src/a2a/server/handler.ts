import type { Negotiator } from "../../core/negotiator.ts";
import type { ActionSpec } from "../../core/negotiator.ts";
import type { NegotiationParty } from "../../core/types.ts";
import { verifyAgreement } from "../wire/agreement.ts";
import { decisionToMessage, historyFromMessages } from "../wire/history.ts";
import type { JsonRpcRequest, JsonRpcResponse } from "../wire/jsonrpc.ts";
import { defaultStrategy, type DecisionStrategy, type EvaluateHook } from "../wire/strategy.ts";
import { isTerminalTaskState } from "../wire/types.ts";
import type { A2AArtifact, A2AIdentity, A2AMessage, A2ATask, AgentCard } from "../wire/types.ts";
import { TaskStore } from "./task-store.ts";

const AGENT_CARD_PATH = "/.well-known/agent-card.json";

/** Stable id of the artifact recording what a task settled on. Namespaced so
 * it can't collide with a caller's own `evaluate()` artifact ids, and fixed
 * so consumers can look the outcome up rather than filtering on `name`. */
export const OUTCOME_ARTIFACT_ID = "negotiator:negotiation-outcome";

const DEFAULT_TERMINAL_ACTIONS = new Set([
  "accept",
  "reject",
  "decline",
  "withdraw",
]);

export interface A2AHandlerOptions<A extends string> {
  negotiator: Negotiator;
  party: NegotiationParty;
  allowedActions: ActionSpec<A>[];
  agentCard: AgentCard;
  taskStore?: TaskStore;
  /** Which actions end the negotiation. Defaults to accept/reject/decline/withdraw. */
  isTerminal?: (action: A) => boolean;
  /** Maps a terminal action to the Task's final state. Defaults to
   * accept -> completed, withdraw -> canceled, anything else -> rejected —
   * override this for a custom action vocabulary where those defaults
   * don't apply (e.g. "commit"/"pass"/"defer" instead of "accept"/"reject"). */
  terminalState?: (action: A) => "completed" | "rejected" | "canceled";
  /** Customize how a turn is decided. Defaults to a plain `negotiator.decide()` call. */
  strategy?: DecisionStrategy<A>;
  /** Runs after each turn's decision; return an Artifact to attach to the Task. */
  evaluate?: EvaluateHook<A>;
  /** Gates `message/send` calls: return the caller's identity to admit the
   * request, or `null`/`undefined` to reject it with a 401. Doesn't gate
   * the public AgentCard GET, matching the A2A spec's public-card model.
   * Bring your own verification (bearer token, JWT/JWKS against an issuer,
   * mTLS via a reverse proxy, whatever your deployment needs) — this
   * library only enforces the hook's verdict, it doesn't implement any
   * particular scheme. See `bearerTokenAuth()` for a minimal example. */
  authenticate?: (request: Request) => A2AIdentity | null | undefined | Promise<A2AIdentity | null | undefined>;
}

function defaultTerminalState(action: string): "completed" | "rejected" | "canceled" {
  if (action === "accept") return "completed";
  if (action === "withdraw") return "canceled";
  return "rejected"; // reject, decline
}

function jsonRpcResult<R>(id: string, result: R): JsonRpcResponse<R> {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Builds a framework-agnostic request handler for one personal agent's A2A
 * surface: serves its AgentCard and handles incoming `message/send` calls
 * by running `negotiator.decide()` and replying with the updated Task.
 * Mount the returned function in any HTTP server, e.g. `Bun.serve({ fetch: handler })`.
 */
export function createA2AHandler<A extends string>(
  options: A2AHandlerOptions<A>,
): (request: Request) => Promise<Response> {
  const taskStore = options.taskStore ?? new TaskStore();
  const isTerminal = options.isTerminal ?? ((action: A) => DEFAULT_TERMINAL_ACTIONS.has(action));
  const terminalState = options.terminalState ?? defaultTerminalState;
  const strategy = options.strategy ?? (defaultStrategy as unknown as DecisionStrategy<A>);

  return async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === AGENT_CARD_PATH) {
      return Response.json(options.agentCard);
    }

    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const identity = options.authenticate ? await options.authenticate(request) : undefined;
    if (options.authenticate && !identity) {
      return Response.json(jsonRpcError(null, -32003, "Unauthorized"), { status: 401 });
    }

    let rpcRequest: JsonRpcRequest<{ message: A2AMessage }>;
    try {
      rpcRequest = (await request.json()) as JsonRpcRequest<{ message: A2AMessage }>;
    } catch {
      return Response.json(jsonRpcError(null, -32700, "Parse error"), { status: 400 });
    }

    if (rpcRequest.method !== "message/send") {
      return Response.json(
        jsonRpcError(rpcRequest.id ?? null, -32601, `Unknown method "${rpcRequest.method}"`),
        { status: 400 },
      );
    }

    const incoming = rpcRequest.params.message;

    let task: A2ATask;
    if (incoming.taskId) {
      const existing = taskStore.get(incoming.taskId);
      if (!existing) {
        return Response.json(
          jsonRpcError(rpcRequest.id, -32001, `Unknown task "${incoming.taskId}"`),
          { status: 404 },
        );
      }
      // A finished task is the record of what was settled. Answering a
      // message on one would append a turn, re-stamp the state from the new
      // decision, and erase the agreement the task had already certified —
      // leaving both parties looking at an open negotiation and, quite
      // correctly given what they can see, renegotiating settled terms.
      // The server owns the task, so refusing here is the only place this
      // can be stopped: a well-behaved counterparty can't protect us.
      if (isTerminalTaskState(existing.status.state)) {
        return Response.json(
          jsonRpcError(
            rpcRequest.id,
            -32002,
            `Task "${incoming.taskId}" is ${existing.status.state} and cannot accept further messages. Start a new task to negotiate again.`,
          ),
          { status: 409 },
        );
      }
      task = existing;
    } else {
      const id = crypto.randomUUID();
      task = {
        id,
        contextId: incoming.contextId ?? crypto.randomUUID(),
        status: { state: "working", timestamp: new Date().toISOString() },
        history: [],
        artifacts: [],
      };
    }

    task.history.push(incoming);

    const history = historyFromMessages(task.history, "server");
    // The incoming request's signal is the right deadline for our own
    // model call: if the caller has already hung up, finishing the turn
    // buys nothing and the reply has nowhere to go.
    const decision = await strategy(
      options.negotiator,
      { party: options.party, history },
      options.allowedActions,
      { signal: request.signal },
    );

    const reply = decisionToMessage(decision, "agent", {
      taskId: task.id,
      contextId: task.contextId,
    });
    task.history.push(reply);
    task.status = {
      state: isTerminal(decision.action) ? terminalState(decision.action) : "input-required",
      timestamp: new Date().toISOString(),
    };

    // The spec puts task results in Artifacts, not in messages: on a
    // terminal action, record what the task actually settled on so a reader
    // of the Task doesn't have to parse anyone's prose to find out.
    //
    // The id is stable rather than random so consumers can look it up
    // directly instead of sniffing `name`, and so re-closing a task replaces
    // the entry rather than appending a second, contradictory one.
    if (isTerminal(decision.action)) {
      const agreement = verifyAgreement(task);
      const outcomeArtifact: A2AArtifact = {
        artifactId: OUTCOME_ARTIFACT_ID,
        name: "negotiation-outcome",
        parts: [
          {
            kind: "data",
            data: {
              state: task.status.state,
              status: agreement.status,
              basis: agreement.basis,
              ...(agreement.terms ? { terms: agreement.terms } : {}),
              ...(agreement.reason ? { reason: agreement.reason } : {}),
            },
          },
        ],
      };
      const existing = task.artifacts.findIndex(
        (artifact) => artifact.artifactId === OUTCOME_ARTIFACT_ID,
      );
      if (existing === -1) task.artifacts.push(outcomeArtifact);
      else task.artifacts[existing] = outcomeArtifact;
    }

    const artifact = await options.evaluate?.(task, decision);
    if (artifact) task.artifacts.push(artifact);

    taskStore.save(task);

    return Response.json(jsonRpcResult(rpcRequest.id, task));
  };
}
