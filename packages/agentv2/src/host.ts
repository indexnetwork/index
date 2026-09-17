import type { ConversationMessage, Index, MatchReference, NegotiationDetail, PrincipalMessage } from "@indexnetwork/client";

import { briefIfMissing } from "./brief.ts";
import type { Model } from "./model.ts";
import { negotiate } from "./negotiate.ts";
import type { ConversationEntry, Decision, Intent, NegotiateResult, Opportunity, Stall, WakeAction, WakeResult } from "./types.ts";
import { wake } from "./wake.ts";

/** What every run needs beyond Index: a model, a clock, a way to be cancelled, and somewhere to report. */
export interface Runtime {
  model: Model;
  now?: () => Date;
  signal?: AbortSignal;
  log?: (line: string) => void;
  /** Open this negotiation now, as soon as its brief and decision are published. */
  onNegotiate?: (opportunityId: string, decision?: Decision) => void;
}

const BRIEF = "Brief: ";
const DECISION = "Decision: ";
const STALL = "Stall: ";
const WITHDRAWN = "Withdrawn: ";
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
 * Read the agent DM as a run's conversation.
 *
 * Briefs, decisions and stalls live here as prefixed agent messages tagged with
 * their opportunity: that is the whole store, and the principal can read it too.
 *
 * @param messages - The agent DM slice for one signal, oldest first.
 * @returns The conversation as a run takes it.
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
 * a stall still waiting to be answered, and whether the principal has spoken
 * to it since that decision.
 *
 * A stall and an answer stand only until the next decision for that
 * opportunity, which is the reply to both.
 *
 * @param conversation - The signal's conversation, oldest first.
 * @returns The standing brief, decision, stall and answer per opportunity.
 */
export function latestBriefs(conversation: ConversationEntry[]): Map<string, { brief?: string; decision?: Decision; stall?: Stall; answered?: boolean }> {
  const perOpportunity = new Map<string, { brief?: string; decision?: Decision; stall?: Stall; answered?: boolean }>();
  for (const entry of conversation) {
    // An answer names one negotiation; anything else the principal writes
    // speaks to every negotiation this signal is running.
    if (entry.kind === "answer" || entry.kind === "user") {
      for (const [id, carried] of perOpportunity) {
        if (!entry.opportunity || entry.opportunity === id) carried.answered = true;
      }
      continue;
    }
    if (!entry.opportunity || (entry.kind !== "brief" && entry.kind !== "decision" && entry.kind !== "stall")) continue;
    const current = perOpportunity.get(entry.opportunity) ?? {};
    if (entry.kind === "brief") current.brief = entry.text;
    else if (entry.kind === "stall") current.stall = { reason: entry.text };
    else if (DECISIONS.includes(entry.text)) {
      current.decision = entry.text as Decision;
      delete current.stall;
      delete current.answered;
    }
    perOpportunity.set(entry.opportunity, current);
  }
  return perOpportunity;
}

/**
 * Every question this signal has ever asked, by id, so a retirement can name
 * the question it withdrew. Whether one is still open is the wake's judgement,
 * not the host's.
 *
 * @param conversation - The signal's conversation, oldest first.
 * @returns Each question's text by id.
 */
function questionsAsked(conversation: ConversationEntry[]): Map<string, string> {
  const asked = new Map<string, string>();
  for (const entry of conversation) {
    if (entry.kind === "question" && entry.questionId) asked.set(entry.questionId, entry.text);
  }
  return asked;
}

function entry(kind: PrincipalMessage["kind"], text: string, matches: MatchReference[] = []): PrincipalMessage {
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), kind, matches, text };
}

/** @param action - One thing a run decided. @returns That decision as one readable line. */
function describe(action: WakeAction): string {
  switch (action.type) {
    case "brief": return `brief ${action.opportunityId}: ${action.brief}`;
    case "decision": return `decision ${action.opportunityId}: ${action.decision}`;
    case "ask": return `ask (${action.scope}${action.opportunityId ? ` ${action.opportunityId}` : ""}): ${action.question} [${action.options.join(" | ")}]`;
    case "note": return `note: ${action.text}`;
    case "expire": return `expire ${action.questionId}`;
  }
}

/** Everything the host needs to turn actions into agent DM entries. */
interface PublishContext {
  /** The counterpart to tag each opportunity-scoped entry with. */
  counterparts: Map<string, MatchReference>;
  /** Questions by id, so a retirement reads as the question it withdrew. */
  questions?: Map<string, string>;
  log?: (line: string) => void;
}

/**
 * Write what a run decided onto the owner's agent DM.
 *
 * @param client - Index for this owner.
 * @param intentId - The signal these entries belong to.
 * @param actions - What the run produced.
 * @param context - Counterpart tags, open questions, and where to report.
 */
export async function publishActions(
  client: Index,
  intentId: string,
  actions: WakeAction[],
  context: PublishContext,
): Promise<void> {
  const { counterparts, questions, log = () => {} } = context;
  const entries: PrincipalMessage[] = [];
  for (const action of actions) {
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
      // Not an answer: the owner never replied, so the entry says the agent
      // withdrew it. Index drops the question from their queue on this kind.
      case "expire":
        entries.push({
          ...entry("expire", `${WITHDRAWN}${questions?.get(action.questionId) ?? "a question that no longer matters."}`),
          questionId: action.questionId,
        });
        break;
    }
  }
  if (entries.length) await client.sendPrincipal(intentId, entries);
}

/** @param details - Every negotiation on this signal. @returns The match tag per opportunity. */
function counterpartsOf(details: NegotiationDetail[]): Map<string, MatchReference> {
  return new Map(details.map((detail) => [
    detail.opportunityId,
    { opportunityId: detail.opportunityId, counterparty: { id: detail.counterparty.userId, name: detail.counterparty.name } },
  ]));
}

/**
 * One wake over one signal: read Index, think, publish what the wake produced.
 *
 * @param client - Index for this owner.
 * @param intent - The signal to wake over.
 * @param runtime - Model, clock, cancellation, and where to open negotiations.
 * @returns The wake's actions.
 */
export async function runWake(client: Index, intent: Intent, runtime: Runtime): Promise<WakeResult> {
  const { model, now, signal, log = () => {}, onNegotiate } = runtime;
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
  const carried = latestBriefs(principalConversation);
  const opportunities = details.map((detail) => ({ ...toOpportunity(detail, user.id), ...carried.get(detail.opportunityId) }));
  const context: PublishContext = {
    counterparts: counterpartsOf(details),
    questions: questionsAsked(principalConversation),
    log,
  };

  log(`  read ${opportunities.length} opportunities, ${principalConversation.length} conversation entries`);
  for (const opportunity of opportunities) {
    log(`    ${opportunity.id} ${opportunity.counterpart}: ${opportunity.status}, awaiting ${opportunity.awaiting}, ${opportunity.turns} turns${opportunity.brief ? ", briefed" : ""}${opportunity.decision ? `, ${opportunity.decision}` : ""}`);
  }

  log("  thinking");
  const result = await wake({
    user,
    intent,
    principalConversation,
    opportunities,
    model,
    client,
    now,
    signal,
    // One opportunity's brief and decision, published and opened on their own,
    // so its negotiator runs while the wake is still thinking.
    onBrief: async (decided) => {
      await publishActions(client, intent.id, decided, context);
      for (const action of decided) {
        if (action.type === "decision" && action.decision !== "stop") onNegotiate?.(action.opportunityId, action.decision);
      }
    },
    // A newly opened opportunity is this seat's turn at turn zero with no
    // brief, so nothing else will ever move it. Each one starts here and is
    // briefed by its own run rather than by this wake, whose step budget a
    // batch of them would exhaust.
    onOpened: (opportunityIds) => {
      log(`  opened ${opportunityIds.length}`);
      for (const opportunityId of opportunityIds) onNegotiate?.(opportunityId);
    },
  });

  if (!result.actions.length) log("  silent");
  await publishActions(
    client,
    intent.id,
    result.actions.filter((action) => action.type !== "brief" && action.type !== "decision"),
    context,
  );

  return result;
}

/**
 * One negotiator run over one opportunity, submitted when it produced a turn.
 *
 * An opportunity with no standing brief and decision gets them here first:
 * that is a one-opportunity run, not a wake, so a counterpart opening or
 * moving a negotiation never pulls the whole signal into a think pass.
 *
 * @param client - Index for this owner.
 * @param opportunityId - The negotiation to work.
 * @param intent - The signal it belongs to.
 * @param runtime - Model, clock, and cancellation.
 * @returns The submitted turn, or why this run took none.
 */
export async function runNegotiate(
  client: Index,
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

  const principalConversation = readConversation(inbox.messages);
  const carried = latestBriefs(principalConversation).get(opportunityId) ?? {};
  const opportunity: Opportunity = { ...toOpportunity(detail, user.id), ...carried };
  const context: PublishContext = { counterparts: counterpartsOf([detail]), log };

  if (!opportunity.brief || !opportunity.decision) {
    log(`  briefing ${opportunityId} with ${opportunity.counterpart}`);
    const decided = await briefIfMissing({ user, intent, principalConversation, opportunity, model, now, signal });
    if (!decided.length) return { stall: { reason: "This opportunity could not be briefed." } };
    await publishActions(client, intent.id, decided, context);
    for (const action of decided) {
      if (action.type === "brief") opportunity.brief = action.brief;
      if (action.type === "decision") opportunity.decision = action.decision;
    }
  }

  if (!opportunity.brief) return { stall: { reason: "No brief for this opportunity yet." } };
  if (opportunity.decision === "stop") return { stall: { reason: "This negotiation was stopped." } };

  log(`  negotiating ${opportunityId} with ${opportunity.counterpart} at turn ${detail.turnCount}`);
  const result = await negotiate({ user, intent, brief: opportunity.brief, opportunity, model, now, signal });
  if ("turn" in result) {
    await client.submitTurn(opportunityId, { ...result.turn, expectedTurnCount: detail.turnCount });
    return result;
  }

  // The stall is this run's whole product, so it goes on the conversation: a
  // wake can then ask the principal for what the brief was missing.
  const text = result.stall.suggestedAsk
    ? `${result.stall.reason}\n\nTo ask: ${result.stall.suggestedAsk}`
    : result.stall.reason;
  await client.sendPrincipal(intent.id, [entry("message", `${STALL}${text}`, [context.counterparts.get(opportunityId)!])]);
  return result;
}
