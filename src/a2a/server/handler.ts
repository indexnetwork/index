import type { Negotiator } from "../../core/negotiator.ts";
import type { ActionSpec } from "../../core/negotiator.ts";
import type { NegotiationParty } from "../../core/types.ts";
import { decisionToMessage, historyFromMessages } from "../wire/history.ts";
import type { JsonRpcRequest, JsonRpcResponse } from "../wire/jsonrpc.ts";
import { defaultStrategy, type DecisionStrategy, type EvaluateHook } from "../wire/strategy.ts";
import type { A2AIdentity, A2AMessage, A2ATask, AgentCard } from "../wire/types.ts";
import { TaskStore } from "./task-store.ts";

const AGENT_CARD_PATH = "/.well-known/agent-card.json";

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
   * don't apply (e.g. "resolve"/"escalate" instead of "accept"/"reject"). */
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
    const decision = await strategy(
      options.negotiator,
      { party: options.party, history },
      options.allowedActions,
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

    const artifact = await options.evaluate?.(task, decision);
    if (artifact) task.artifacts.push(artifact);

    taskStore.save(task);

    return Response.json(jsonRpcResult(rpcRequest.id, task));
  };
}
