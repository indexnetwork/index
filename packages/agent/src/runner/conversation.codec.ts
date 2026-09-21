import type { ConversationEntry, WakeAction } from "../agents/principal/principal.context.js";
import type { Decision, Opportunity, Stall } from "../agents/shared/agent.context.js";

import type { AgentHost, ConversationMessage, MatchReference, Negotiation, NegotiationDetail, PrincipalMessage } from "./agent.host.js";

const BRIEF = "Brief: ";
const DECISION = "Decision: ";
const STALL = "Stall: ";
const PROGRESS = "Progress: ";
const WITHDRAWN = "Withdrawn: ";

export interface PublicationContext {
  counterparts: Map<string, MatchReference>;
  questions: Map<string, string>;
}

export async function publishActions(host: AgentHost, log: ((line: string) => void) | undefined, intentId: string, actions: WakeAction[], context: PublicationContext): Promise<void> {
  const messages: PrincipalMessage[] = [];
  for (const action of actions) {
    log?.(`  ${describeAction(action)}`);
    const match = "opportunityId" in action && action.opportunityId ? context.counterparts.get(action.opportunityId) : undefined;
    switch (action.type) {
      case "brief": messages.push(createMessage("message", `${BRIEF}${action.brief}`, match ? [match] : [])); break;
      case "decision": messages.push(createMessage("message", `${DECISION}${action.decision}`, match ? [match] : [])); break;
      case "note": messages.push(createMessage("message", action.text)); break;
      case "progress": messages.push(createMessage("message", `${PROGRESS}${action.text}`)); break;
      case "ask": {
        const question = createMessage("question", action.question, match ? [match] : []);
        messages.push({ ...question, questionId: question.id, scope: action.scope === "opportunity" ? "match" : "intent", options: action.options });
        break;
      }
      case "expire":
        messages.push({ ...createMessage("expire", `${WITHDRAWN}${context.questions.get(action.questionId) ?? "a question that no longer matters."}`), questionId: action.questionId });
        break;
    }
  }
  if (messages.length) await host.appendMessages(intentId, messages);
}

export async function publishStall(host: AgentHost, negotiation: Negotiation, stall: Stall): Promise<void> {
  const text = stall.suggestedAsk ? `${stall.reason}\n\nTo ask: ${stall.suggestedAsk}` : stall.reason;
  await host.appendMessages(negotiation.intentId, [createMessage("message", `${STALL}${text}`, [toMatchReference(negotiation)])]);
}

export function createPublicationContext(conversation: ConversationEntry[], negotiations: Negotiation[]): PublicationContext {
  const questions = new Map<string, string>();
  for (const entry of conversation) {
    if (entry.kind === "question" && entry.questionId) questions.set(entry.questionId, entry.text);
  }
  return {
    counterparts: new Map(negotiations.map((negotiation) => [negotiation.opportunityId, toMatchReference(negotiation)])),
    questions,
  };
}

export function readConversation(messages: ConversationMessage[]): ConversationEntry[] {
  return messages.map((message) => {
    const principal = (message.metadata as { principalMessage?: Partial<PrincipalMessage> } | undefined)?.principalMessage;
    const opportunity = principal?.matches?.[0]?.opportunityId;
    const counterpart = principal?.matches?.[0]?.counterparty.name ?? undefined;
    const text = textOf(message);

    if (message.role === "agent" && text.startsWith(BRIEF)) return bookkeeping("brief", text.slice(BRIEF.length), opportunity, counterpart);
    if (message.role === "agent" && text.startsWith(DECISION)) return bookkeeping("decision", text.slice(DECISION.length), opportunity, counterpart);
    if (message.role === "agent" && text.startsWith(STALL)) return bookkeeping("stall", text.slice(STALL.length), opportunity, counterpart);
    if (message.role === "agent" && text.startsWith(PROGRESS)) return bookkeeping("progress", text.slice(PROGRESS.length), opportunity, counterpart);
    return {
      kind: principal?.kind ?? (message.role === "user" ? "user" : "message"), text,
      ...(principal?.scope ? { scope: principal.scope === "match" ? "opportunity" as const : "intent" as const } : {}),
      ...(principal?.questionId ? { questionId: principal.questionId } : {}),
      ...(principal?.options ? { options: principal.options } : {}),
      ...(opportunity ? { opportunity } : {}), ...(counterpart ? { counterpart } : {}),
    };
  });
}

export function readStandingContext(conversation: ConversationEntry[]) {
  const standing = new Map<string, Pick<Opportunity, "brief" | "decision" | "stall" | "answered">>();
  for (const entry of conversation) {
    if (entry.kind === "answer" || entry.kind === "user") {
      for (const [id, carried] of standing) if (!entry.opportunity || entry.opportunity === id) carried.answered = true;
      continue;
    }
    if (!entry.opportunity || (entry.kind !== "brief" && entry.kind !== "decision" && entry.kind !== "stall")) continue;
    const current = standing.get(entry.opportunity) ?? {};
    if (entry.kind === "brief") current.brief = entry.text;
    else if (entry.kind === "stall") current.stall = { reason: entry.text };
    else if (["continue", "accept", "decline", "stop"].includes(entry.text)) {
      current.decision = entry.text as Decision;
      delete current.stall;
      delete current.answered;
    }
    standing.set(entry.opportunity, current);
  }
  return standing;
}

export function toOpportunity(negotiation: NegotiationDetail, principalId: string): Opportunity {
  return {
    id: negotiation.opportunityId,
    counterpart: negotiation.counterparty.name ?? negotiation.counterparty.userId,
    status: negotiation.outcome ?? "negotiating",
    awaiting: negotiation.awaitingUserId === principalId ? "you" : "them",
    turns: negotiation.turns.map(({ seatUserId, action, message }) => ({
      speaker: seatUserId === principalId ? "our_agent" : "counterparty_agent", action, message,
    })),
    turnCount: negotiation.turnCount,
    maxTurns: negotiation.protocol.maxTurns,
    remainingTurns: Math.max(0, negotiation.protocol.maxTurns - negotiation.turnCount),
    actions: negotiation.protocol.availableActions,
    intent: { statement: negotiation.counterparty.statement },
  };
}

function bookkeeping(kind: "brief" | "decision" | "stall" | "progress", text: string, opportunity?: string, counterpart?: string): ConversationEntry {
  return { kind, text, ...(opportunity ? { opportunity } : {}), ...(counterpart ? { counterpart } : {}) };
}

function textOf(message: ConversationMessage): string {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts.map((part) => part as { kind?: string; text?: string }).filter((part) => part.kind === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

function createMessage(kind: PrincipalMessage["kind"], text: string, matches: MatchReference[] = []): PrincipalMessage {
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), kind, matches, text };
}

function toMatchReference(negotiation: Negotiation): MatchReference {
  return { opportunityId: negotiation.opportunityId, counterparty: { id: negotiation.counterparty.userId, name: negotiation.counterparty.name } };
}

function describeAction(action: WakeAction): string {
  switch (action.type) {
    case "brief": return `brief ${action.opportunityId}: ${action.brief}`;
    case "decision": return `decision ${action.opportunityId}: ${action.decision}`;
    case "note": return `note: ${action.text}`;
    case "progress": return `progress: ${action.text}`;
    case "ask": return `ask (${action.scope}${action.opportunityId ? ` ${action.opportunityId}` : ""}): ${action.question} [${action.options.join(" | ")}]`;
    case "expire": return `expire ${action.questionId}`;
  }
}
