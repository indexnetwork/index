import type { NegotiationDecision, NegotiationMessage } from "../../core/types.ts";
import type { A2AMessage } from "./types.ts";

/** Builds the outgoing message for a decision. `role` is "user" for the
 * side that calls `message/send` (the initiator of this particular turn),
 * "agent" for the side replying to it — matching who's acting as
 * client/server for this one HTTP round trip, not a fixed identity. */
export function decisionToMessage(
  decision: NegotiationDecision,
  role: A2AMessage["role"],
  refs: { taskId?: string; contextId?: string } = {},
): A2AMessage {
  return {
    messageId: crypto.randomUUID(),
    role,
    parts: [{ kind: "data", data: decision }],
    taskId: refs.taskId,
    contextId: refs.contextId,
  };
}

/** Recovers a NegotiationDecision from a message this package produced.
 * Returns null if the message has no recognizable decision data part
 * (e.g. it came from a counterparty implementation that only sends text). */
export function messageToDecision(message: A2AMessage): NegotiationDecision | null {
  for (const part of message.parts) {
    if (
      part.kind === "data" &&
      typeof part.data === "object" &&
      part.data !== null &&
      typeof (part.data as Record<string, unknown>).action === "string" &&
      typeof (part.data as Record<string, unknown>).message === "string"
    ) {
      return part.data as NegotiationDecision;
    }
  }
  return null;
}

/** Falls back to the first text part when there's no decision data part,
 * so counterparties that only send plain text still produce usable
 * history content. */
function messageContent(message: A2AMessage): string {
  const decision = messageToDecision(message);
  if (decision) return decision.message;
  return message.parts.find((part) => part.kind === "text")?.text ?? "";
}

/**
 * Converts an A2A message history into this side's NegotiationState
 * history. `viewpoint` says which role this side plays for this task:
 * "server" (this side's own past replies were sent with role "agent") or
 * "client" (this side's own past sends were made with role "user").
 */
export function historyFromMessages(
  messages: A2AMessage[],
  viewpoint: "server" | "client",
): NegotiationMessage[] {
  const ownRole = viewpoint === "server" ? "agent" : "user";
  return messages.map((message) => ({
    role: message.role === ownRole ? "outgoing" : "incoming",
    content: messageContent(message),
  }));
}
