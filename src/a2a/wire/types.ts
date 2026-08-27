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

export interface A2ATask {
  id: string;
  contextId: string;
  status: { state: A2ATaskState; timestamp: string };
  history: A2AMessage[];
}

export interface AgentCardSkill {
  id: string;
  name: string;
  description?: string;
}

export interface AgentCard {
  name: string;
  description?: string;
  url: string;
  version: string;
  capabilities: { pushNotifications?: boolean; streaming?: boolean };
  skills: AgentCardSkill[];
}
