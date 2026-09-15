import type { ConversationMessage, IndexClient, MatchReference, NegotiationDetail, PrincipalMessage } from "@indexnetwork/client";

import { negotiate, wake } from "../src/index.ts";
import type { ConversationEntry, Decision, Intent, Model, NegotiateResult, Opportunity, Stall, WakeAction, WakeResult } from "../src/index.ts";

/** What every run needs beyond Index: a model, a clock, a way to be cancelled, and somewhere to report. */
export interface Runtime {
  model: Model;
  now?: () => Date;
  signal?: AbortSignal;
  log?: (line: string) => void;
  /** Open this negotiation now, as soon as its brief and decision are published. */
  onNegotiate?: (opportunityId: string) => void;
  /** Decide only this opportunity, and say nothing to the principal. */
  focus?: string;
}

const BRIEF = "Brief: ";
const DECISION = "Decision: ";
const STALL = "Stall: ";
const DECISIONS: readonly string[] = ["continue", "accept", "decline", "stop"];

function textOf(message: ConversationMessage): string {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .map((part) => (part as { kind?: string; text?: string }))
    .filter((part) => part.kind === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/**
 * Read the agent DM as the wake's conversation.
 *
 * Briefs, decisions and stalls live here as prefixed agent messages tagged with
 * their opportunity: that is the whole store, and the principal can read it too.
 *
 * @param messages - The agent DM slice for one signal, oldest first.
 * @returns The conversation as a wake takes it.
 */
export function readConversation(messages: ConversationMessage[]): ConversationEntry[] {
  return messages.map((message) => {
    const principal = (message as { metadata?: { principalMessage?: Partial<PrincipalMessage> } }).metadata?.principalMessage;
    const opportunity = principal?.matches?.[0]?.opportunityId;
    const counterpart = principal?.matches?.[0]?.counterparty.name ?? undefined;
    const text = textOf(message);

    if (message.role === "agent" && text.startsWith(BRIEF)) {
      return { kind: "brief", text: text.slice(BRIEF.length), ...(opportunity ? { opportunity } : {}), ...(counterpart ? { counterpart } : {}) };
    }
    if (message.role === "agent" && text.startsWith(DECISION)) {
      return { kind: "decision", text: text.slice(DECISION.length), ...(opportunity ? { opportunity } : {}), ...(counterpart ? { counterpart } : {}) };
    }
    if (message.role === "agent" && text.startsWith(STALL)) {
      return { kind: "stall", text: text.slice(STALL.length), ...(opportunity ? { opportunity } : {}), ...(counterpart ? { counterpart } : {}) };
    }

    const kind = principal?.kind ?? (message.role === "user" ? "user" : "message");
    return {
      kind,
      text,
      ...(principal?.scope ? { scope: principal.scope === "match" ? "opportunity" as const : "intent" as const } : {}),
      ...(principal?.questionId ? { questionId: principal.questionId } : {}),
      ...(principal?.options ? { options: principal.options } : {}),
      ...(opportunity ? { opportunity } : {}),
      ...(counterpart ? { counterpart } : {}),
    };
  });
}

/**
 * @param negotiation - One negotiation record as this seat sees it.
 * @param userId - The owner, to tell the two seats apart.
 * @returns The opportunity row a wake and a negotiator read.
 */
export function toOpportunity(negotiation: NegotiationDetail, userId: string): Opportunity {
  return {
    id: negotiation.opportunityId,
    counterpart: negotiation.counterparty.name ?? negotiation.counterparty.userId,
    status: negotiation.outcome ?? "negotiating",
    awaiting: negotiation.awaitingUserId === userId ? "you" : "them",
    turns: String(negotiation.turnCount),
    actions: negotiation.turns.length ? ["counter", "accept", "decline"] : ["propose", "decline"],
    intent: { statement: negotiation.counterparty.statement },
    ...(negotiation.turns.length ? { terms: negotiation.turns.at(-1)!.message } : {}),
  };
}

/**
 * What each opportunity carries into this run: its latest brief and decision,
 * and a stall still waiting to be answered.
 *
 * A stall stands only until the next decision for that opportunity, which is
 * the wake's answer to it.
 *
 * @param conversation - The signal's conversation, oldest first.
 * @returns The standing brief, decision and stall per opportunity.
 */
function standing(conversation: ConversationEntry[]): Map<string, { brief?: string; decision?: Decision; stall?: Stall }> {
  const perOpportunity = new Map<string, { brief?: string; decision?: Decision; stall?: Stall }>();
  for (const entry of conversation) {
    if (!entry.opportunity || (entry.kind !== "brief" && entry.kind !== "decision" && entry.kind !== "stall")) continue;
    const current = perOpportunity.get(entry.opportunity) ?? {};
    if (entry.kind === "brief") current.brief = entry.text;
    else if (entry.kind === "stall") current.stall = { reason: entry.text };
    else if (DECISIONS.includes(entry.text)) {
      current.decision = entry.text as Decision;
      delete current.stall;
    }
    perOpportunity.set(entry.opportunity, current);
  }
  return perOpportunity;
}

function entry(kind: "message" | "question", text: string, matches: MatchReference[] = []): PrincipalMessage {
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), kind, matches, text };
}

/** @param action - One thing a wake decided. @returns That decision as one readable line. */
function describe(action: WakeAction): string {
  switch (action.type) {
    case "brief": return `brief ${action.opportunityId}: ${action.brief}`;
    case "decision": return `decision ${action.opportunityId}: ${action.decision}`;
    case "ask": return `ask (${action.scope}${action.opportunityId ? ` ${action.opportunityId}` : ""}): ${action.question} [${action.options.join(" | ")}]`;
    case "note": return `note: ${action.text}`;
    case "expire": return `expire ${action.questionId}`;
  }
}

/**
 * One wake over one signal: read Index, decide, publish what the decision produced.
 *
 * @param client - Index for this owner.
 * @param intent - The signal to wake over.
 * @param runtime - Model, clock, cancellation, and the opportunity to focus on.
 * @returns The wake's actions, and the ones Index has nowhere to put.
 */
export async function wakeIntent(
  client: IndexClient,
  intent: Intent,
  runtime: Runtime,
): Promise<WakeResult & { unapplied: WakeAction[] }> {
  const { model, now, signal, log = () => {}, onNegotiate, focus } = runtime;
  const [user, open, inbox] = await Promise.all([
    client.me(),
    client.listNegotiations(),
    client.principalInbox(intent.id),
  ]);
  const details = await Promise.all(
    open.filter((negotiation) => negotiation.intentId === intent.id)
      .map((negotiation) => client.getNegotiation(negotiation.opportunityId)),
  );

  const principalConversation = readConversation(inbox.messages);
  const carried = standing(principalConversation);
  const opportunities = details.map((detail) => ({ ...toOpportunity(detail, user.id), ...carried.get(detail.opportunityId) }));
  const counterparts = new Map(details.map((detail) => [
    detail.opportunityId,
    { opportunityId: detail.opportunityId, counterparty: { id: detail.counterparty.userId, name: detail.counterparty.name } },
  ]));

  log(`  read ${opportunities.length} opportunities, ${principalConversation.length} conversation entries`);
  for (const opportunity of opportunities) {
    log(`    ${opportunity.id} ${opportunity.counterpart}: ${opportunity.status}, awaiting ${opportunity.awaiting}, ${opportunity.turns} turns${opportunity.brief ? ", briefed" : ""}${opportunity.decision ? `, ${opportunity.decision}` : ""}`);
  }

  const unapplied: WakeAction[] = [];

  /**
   * @param batch - What the wake decided, as one publishable group.
   * @returns Nothing; what Index cannot hold lands in `unapplied`.
   */
  const publish = async (batch: WakeAction[]): Promise<void> => {
    const entries: PrincipalMessage[] = [];
    for (const action of batch) {
      log(`  ${describe(action)}`);
      const match = "opportunityId" in action && action.opportunityId ? counterparts.get(action.opportunityId) : undefined;
      switch (action.type) {
        case "brief":
          entries.push(entry("message", `${BRIEF}${action.brief}`, match ? [match] : []));
          break;
        case "decision":
          entries.push(entry("message", `${DECISION}${action.decision}`, match ? [match] : []));
          break;
        case "note":
          entries.push(entry("message", action.text));
          break;
        case "ask": {
          const question = entry("question", action.question, match ? [match] : []);
          entries.push({
            ...question,
            questionId: question.id,
            scope: action.scope === "opportunity" ? "match" : "intent",
            options: action.options,
          });
          break;
        }
        // Index derives the displayed question from the transcript, so there is
        // nowhere to retire one. The caller sees it rather than losing it.
        case "expire":
          log("    dropped: Index has nowhere to retire a question");
          unapplied.push(action);
          break;
      }
    }
    if (entries.length) await client.sendPrincipal(intent.id, entries);
  };

  log("  deciding");
  const { actions } = await wake({
    user,
    intent,
    principalConversation,
    opportunities,
    model,
    now,
    signal,
    focus,
    // One opportunity's brief and decision, published and opened on their own,
    // so its negotiator runs while the rest are still being decided.
    onDecision: async (decided) => {
      await publish(decided);
      for (const action of decided) {
        if (action.type === "decision" && action.decision !== "stop") onNegotiate?.(action.opportunityId);
      }
    },
  });

  if (!actions.length) log("  silent");
  await publish(actions.filter((action) => action.type !== "brief" && action.type !== "decision"));

  return { actions, unapplied };
}

/**
 * One negotiator run over one opportunity, submitted when it produced a turn.
 *
 * @param client - Index for this owner.
 * @param opportunityId - The negotiation to work.
 * @param intent - The signal it belongs to.
 * @param runtime - Model, clock, and cancellation.
 * @returns The submitted turn, or why this run took none.
 */
export async function negotiateOpportunity(
  client: IndexClient,
  opportunityId: string,
  intent: Intent,
  runtime: Runtime,
): Promise<NegotiateResult> {
  const { model, now, signal, log = () => {} } = runtime;
  const [user, detail, inbox] = await Promise.all([
    client.me(),
    client.getNegotiation(opportunityId),
    client.principalInbox(intent.id),
  ]);
  if (detail.intentId !== intent.id) return { stall: { reason: `Opportunity ${opportunityId} belongs to another signal.` } };
  if (detail.awaitingUserId !== user.id) return { stall: { reason: "It is not this seat's turn." } };

  const carried = standing(readConversation(inbox.messages)).get(opportunityId);
  if (!carried?.brief) {
    return { stall: { reason: "No brief for this opportunity yet.", suggestedAsk: "Set a brief for this negotiation." } };
  }
  if (carried.decision === "stop") return { stall: { reason: "The last wake stopped this negotiation." } };

  const opportunity = { ...toOpportunity(detail, user.id), ...carried };
  log(`  negotiating ${opportunityId} with ${opportunity.counterpart} at turn ${detail.turnCount}`);
  const result = await negotiate({ user, intent, brief: carried.brief, opportunity, model, now, signal });
  if ("turn" in result) {
    await client.submitTurn(opportunityId, { ...result.turn, expectedTurnCount: detail.turnCount });
    return result;
  }

  // The stall is this run's whole product, so it goes on the conversation: the
  // next wake owes this opportunity a decision, and the principal can be asked.
  const match = { opportunityId, counterparty: { id: detail.counterparty.userId, name: detail.counterparty.name } };
  const text = result.stall.suggestedAsk
    ? `${result.stall.reason}\n\nTo ask: ${result.stall.suggestedAsk}`
    : result.stall.reason;
  await client.sendPrincipal(intent.id, [entry("message", `${STALL}${text}`, [match])]);
  return result;
}
