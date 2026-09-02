/**
 * Minimal wire types for the Agent2Agent (A2A) protocol subset this package
 * implements: discovery via an AgentCard, and JSON-RPC `message/send` over
 * HTTP. Streaming (SSE) and push-notification webhooks aren't implemented
 * yet — every turn is a synchronous request/response round trip.
 */

export type A2ATaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled"
  | "rejected";

/** The states A2A treats as final. A task in one of these has finished:
 * it accepts no further `message/send` calls, and whatever it settled on
 * is the record. Anything else (`submitted`, `working`, `input-required`)
 * is still in flight. */
const TERMINAL_TASK_STATES = new Set<A2ATaskState>([
  "completed",
  "failed",
  "canceled",
  "rejected",
]);

/** Whether a task has finished and can no longer be continued. Exported so
 * a caller can check before sending rather than discovering it from the
 * error — and so nobody has to re-derive which states are final. */
export function isTerminalTaskState(state: A2ATaskState): boolean {
  return TERMINAL_TASK_STATES.has(state);
}

export interface A2APart {
  kind: "text" | "data";
  text?: string;
  data?: unknown;
}

export interface A2AMessage {
  messageId: string;
  role: "user" | "agent";
  parts: A2APart[];
  taskId?: string;
  contextId?: string;
}

export interface A2AArtifact {
  artifactId: string;
  name?: string;
  parts: A2APart[];
}

export interface A2ATask {
  id: string;
  contextId: string;
  status: { state: A2ATaskState; timestamp: string };
  history: A2AMessage[];
  /** Structured findings attached to this task, separate from the
   * negotiation messages themselves — e.g. an evaluation score or
   * extracted terms produced by an `evaluate` hook. Not sent to the
   * counterparty as part of the negotiation; visible to whoever can read
   * this Task (this agent, or a caller like Index Network). */
  artifacts: A2AArtifact[];
}

export interface AgentCardSkill {
  id: string;
  name: string;
  description?: string;
}

/** Declares one way to authenticate to this agent, mirroring the
 * OpenAPI-style scheme shapes the A2A spec reuses for `securitySchemes`.
 * Purely descriptive — declaring a scheme here doesn't enforce it; pair
 * with `authenticate` on `createA2AHandler()` to actually require it. */
export interface AgentCardSecurityScheme {
  type: "apiKey" | "http" | "oauth2" | "openIdConnect";
  /** For `type: "http"`: `"bearer"` or `"basic"`. */
  scheme?: string;
  /** For `type: "apiKey"`: where the key travels. */
  in?: "header" | "query" | "cookie";
  /** For `type: "apiKey"`: the header/query/cookie name. */
  name?: string;
  /** For `type: "openIdConnect"`. */
  openIdConnectUrl?: string;
  description?: string;
}

export interface AgentCard {
  name: string;
  description?: string;
  url: string;
  version: string;
  capabilities: { pushNotifications?: boolean; streaming?: boolean };
  skills: AgentCardSkill[];
  /** Named security scheme declarations a caller can use to figure out how
   * to authenticate, keyed by scheme name (e.g. `{ apiKeyAuth: { type:
   * "apiKey", in: "header", name: "x-api-key" } }`). */
  securitySchemes?: Record<string, AgentCardSecurityScheme>;
  /** Which of `securitySchemes` (by name) this agent requires, and which
   * scopes each grants — e.g. `[{ apiKeyAuth: [] }]`. An empty array or
   * missing field means no authentication is required. */
  security?: Record<string, string[]>[];
}

/** The caller identity `authenticate()` resolves an incoming request to.
 * `subject` is whatever stable identifier your auth scheme provides (a
 * token's owner, a JWT's `sub` claim, an API key's registered name);
 * `claims` carries anything else worth passing through (scopes, issuer). */
export interface A2AIdentity {
  subject: string;
  claims?: Record<string, unknown>;
}
