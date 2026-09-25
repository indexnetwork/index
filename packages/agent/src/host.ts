import type { ConversationMessage, Index, MatchReference, Negotiation, NegotiationDetail, PrincipalMessage } from "@indexnetwork/client";

import { briefIfMissing } from "./brief.ts";
import type { Model } from "./model.ts";
import { negotiate } from "./negotiate.ts";
import { summarize } from "./summary.ts";
import type { ConversationEntry, Decision, Intent, NegotiateRun, NegotiationAction, Opportunity, StandingStall, WakeAction, WakeResult } from "./types.ts";
import { wake } from "./wake.ts";

/** What every run needs beyond Index: a model, a clock, a way to be cancelled, and somewhere to report. */
export interface Runtime {
  model: Model;
  now?: () => Date;
  signal?: AbortSignal;
  log?: (line: string) => void;
  /** Open this negotiation now, as soon as its brief and decision are published. */
  onNegotiate?: (opportunityId: string) => void;
}

const BRIEF = "Brief: ";
const DECISION = "Decision: ";
const STALL = "Stall: ";
const RESOLVED = "Resolved: ";
const TO_ASK = "\n\nTo ask: ";
const PROGRESS = "Progress: ";
const WITHDRAWN = "Withdrawn: ";
/** An opening turn still running after this is no longer held. The rest of the initiation can finish. */
const OPENING_MS = 60_000;
const DECISIONS: readonly string[] = ["continue", "accept", "decline", "stop"];

/**
 * What each standing decision lets a negotiator do, intersected with whatever
 * the seat may do at all. A decision stands until a wake writes another, so
 * `continue` is left unnarrowed: it means keep working this opportunity, not
 * never settle it, and the protocol already limits accept to a standing
 * proposal. `accept` keeps propose, because settling needs one to accept:
 * when the counterpart's last turn was a counter, carrying out an accept
 * means putting that offer on the table first.
 */
const PERMITTED: Record<Exclude<Decision, "stop">, NegotiationAction[]> = {
  continue: ["propose", "counter", "accept", "decline"],
  accept: ["accept", "propose"],
  decline: ["decline"],
};

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
  return messages.filter((message) => !principalOf(message)?.summary).map((message): ConversationEntry => {
    const principal = (message as { metadata?: { principalMessage?: Partial<PrincipalMessage> } }).metadata?.principalMessage;
    const opportunity = principal?.matches?.[0]?.opportunityId;
    const counterpart = principal?.matches?.[0]?.counterparty.name ?? undefined;
    const text = textOf(message);
    const stalls = principal?.stalls?.length ? { stalls: principal.stalls } : {};

    if (principal?.reply) return { kind: "reply", text };
    if (message.role === "agent" && text.startsWith(BRIEF)) {
      return { kind: "brief", text: text.slice(BRIEF.length), ...(opportunity ? { opportunity } : {}), ...(counterpart ? { counterpart } : {}) };
    }
    if (message.role === "agent" && text.startsWith(DECISION)) {
      return { kind: "decision", text: text.slice(DECISION.length), ...(opportunity ? { opportunity } : {}), ...(counterpart ? { counterpart } : {}) };
    }
    if (message.role === "agent" && text.startsWith(STALL)) {
      return {
        kind: "stall", id: message.id, text: text.slice(STALL.length),
        ...(principal?.stall ? { turnCount: principal.stall.turnCount } : {}),
        ...(opportunity ? { opportunity } : {}), ...(counterpart ? { counterpart } : {}),
      };
    }
    if (message.role === "agent" && text.startsWith(RESOLVED)) {
      return { kind: "resolution", text: text.slice(RESOLVED.length), ...stalls, ...(opportunity ? { opportunity } : {}), ...(counterpart ? { counterpart } : {}) };
    }
    if (message.role === "agent" && text.startsWith(PROGRESS)) {
      return { kind: "progress", text: text.slice(PROGRESS.length) };
    }

    const kind = principal?.kind ?? (message.role === "user" ? "user" : "message");
    return {
      kind,
      text,
      ...(principal?.scope ? { scope: principal.scope === "match" ? "opportunity" as const : "intent" as const } : {}),
      ...(principal?.questionId ? { questionId: principal.questionId } : {}),
      ...(principal?.options ? { options: principal.options } : {}),
      ...stalls,
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
    turnCount: negotiation.turnCount,
    turns: negotiation.turns.map((turn) => ({
      turnIndex: turn.turnIndex,
      actor: turn.seatUserId === userId ? "you" : "counterpart",
      action: turn.action,
      message: turn.message,
      createdAt: turn.createdAt,
    })),
    maxTurns: negotiation.protocol.maxTurns,
    remainingTurns: Math.max(0, negotiation.protocol.maxTurns - negotiation.turnCount),
    actions: negotiation.protocol.availableActions,
    intent: { statement: negotiation.counterparty.statement },
  };
}

/** What one opportunity carries into a run from the conversation. */
export interface Carried {
  brief?: string;
  decision?: Decision;
  stall?: StandingStall;
  answered?: boolean;
}

/**
 * What each opportunity carries into this run: its latest brief and decision,
 * the stall it still owes, and whether the principal answered a question
 * about it since that decision.
 *
 * A stall is an obligation, not a note: a decision does not erase it, and
 * neither does the principal saying something unrelated. Only these do:
 * the answer to the question linked to it, followed by the decision that
 * carries that answer; a resolution naming it; a decline or stop. A turn or
 * a settlement discharges it too, but that is the negotiation's record, not
 * the conversation's — see {@link standing}. A stall written without its turn
 * count predates obligations and is not one.
 *
 * @param conversation - The signal's conversation, oldest first.
 * @returns The standing brief, decision, stall and answer per opportunity.
 */
export function latestBriefs(conversation: ConversationEntry[]): Map<string, Carried> {
  const perOpportunity = new Map<string, Carried>();
  /** The stall ids each question asked about. */
  const asked = new Map<string, string[]>();
  /** The turn count of each opportunity's last stall a wake resolved without asking. */
  const resolvedAt = new Map<string, number>();
  const of = (opportunityId: string): Carried => {
    const current = perOpportunity.get(opportunityId) ?? {};
    perOpportunity.set(opportunityId, current);
    return current;
  };
  const linked = (stallIds: string[] | undefined) =>
    [...perOpportunity].filter(([, carried]) => carried.stall && stallIds?.includes(carried.stall.id));

  for (const entry of conversation) {
    switch (entry.kind) {
      case "brief":
        if (entry.opportunity) of(entry.opportunity).brief = entry.text;
        break;
      case "stall": {
        if (!entry.opportunity || !entry.id || entry.turnCount === undefined) break;
        const current = of(entry.opportunity);
        // Two runs stalling on the same turn are one obligation, already linked.
        if (current.stall && !current.stall.answered && current.stall.turnCount === entry.turnCount) break;
        const [reason = entry.text, suggestedAsk] = entry.text.split(TO_ASK);
        current.stall = {
          id: entry.id,
          reason,
          ...(suggestedAsk ? { suggestedAsk } : {}),
          turnCount: entry.turnCount,
          ...(resolvedAt.get(entry.opportunity) === entry.turnCount ? { retried: true } : {}),
        };
        break;
      }
      case "question":
        if (!entry.questionId || !entry.stalls) break;
        asked.set(entry.questionId, entry.stalls);
        for (const [, carried] of linked(entry.stalls)) carried.stall!.questionId ??= entry.questionId;
        break;
      // A withdrawn question leaves its stall owed and unasked.
      case "expire":
        for (const [, carried] of linked(asked.get(entry.questionId ?? ""))) {
          if (carried.stall!.questionId === entry.questionId && !carried.stall!.answered) delete carried.stall!.questionId;
        }
        break;
      // An answer speaks to the stalls its question asked about and to the
      // opportunity it names, nothing else. A direct message speaks to none.
      case "answer": {
        const stalled = linked(asked.get(entry.questionId ?? ""));
        for (const [, carried] of stalled) {
          carried.stall!.answered = true;
          carried.answered = true;
        }
        if (entry.opportunity && perOpportunity.has(entry.opportunity)) of(entry.opportunity).answered = true;
        break;
      }
      case "resolution":
        for (const [opportunityId, carried] of linked(entry.stalls)) {
          resolvedAt.set(opportunityId, carried.stall!.turnCount);
          delete carried.stall;
        }
        break;
      case "decision": {
        if (!entry.opportunity || !DECISIONS.includes(entry.text)) break;
        const current = of(entry.opportunity);
        current.decision = entry.text as Decision;
        // Continue and accept still need the fact; an answered stall, a
        // decline and a stop do not.
        if (current.stall && (current.stall.answered || current.decision === "decline" || current.decision === "stop")) {
          delete current.stall;
        }
        delete current.answered;
        break;
      }
      default:
        break;
    }
  }
  return perOpportunity;
}

/**
 * @param carried - What the conversation carries for one opportunity.
 * @param negotiation - Its record, which a turn or a settlement has moved past a stall.
 * @returns The same state without a stall the negotiation already discharged.
 */
export function standing(carried: Carried | undefined, negotiation: Negotiation): Carried {
  const { stall, ...rest } = carried ?? {};
  if (!stall || negotiation.settledAt || negotiation.turnCount > stall.turnCount) return rest;
  return { ...rest, stall };
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
    case "ask": return `ask (${action.scope}${action.opportunityId ? ` ${action.opportunityId}` : ""}): ${action.question} [${action.options.join(" | ")}]${action.stalls ? ` for ${action.stalls.join(", ")}` : ""}`;
    case "resolve": return `resolve ${action.opportunityId} ${action.stallId}: ${action.reason}`;
    case "note": return `note: ${action.text}`;
    case "reply": return `reply: ${action.text}`;
    case "progress": return `progress: ${action.text}`;
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
      case "reply":
        entries.push({ ...entry("message", action.text), reply: true });
        break;
      case "progress":
        entries.push(entry("message", `${PROGRESS}${action.text}`));
        break;
      case "resolve":
        entries.push({ ...entry("message", `${RESOLVED}${action.reason}`, match ? [match] : []), stalls: [action.stallId] });
        break;
      case "ask": {
        const question = entry("question", action.question, match ? [match] : []);
        entries.push({
          ...question,
          questionId: question.id,
          scope: action.scope === "opportunity" ? "match" : "intent",
          options: action.options,
          ...(action.stalls ? { stalls: action.stalls } : {}),
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
  const [user, negotiations, inbox] = await Promise.all([
    client.me(),
    client.listIntentNegotiations(intent.id),
    client.principalInbox(intent.id),
  ]);
  const details = await Promise.all(
    negotiations.map((negotiation) => client.getNegotiation(negotiation.opportunityId)),
  );

  const principalConversation = readConversation(inbox.messages);
  const carried = latestBriefs(principalConversation);
  const opportunities = details.map((detail) => ({ ...toOpportunity(detail, user.id), ...standing(carried.get(detail.opportunityId), detail) }));
  const context: PublishContext = {
    counterparts: counterpartsOf(details),
    questions: questionsAsked(principalConversation),
    log,
  };

  log(`  read ${opportunities.length} opportunities, ${principalConversation.length} conversation entries`);
  for (const opportunity of opportunities) {
    log(`    ${opportunity.id} ${opportunity.counterpart}: ${opportunity.status}, awaiting ${opportunity.awaiting}, ${opportunity.turnCount} turns${opportunity.brief ? ", briefed" : ""}${opportunity.decision ? `, ${opportunity.decision}` : ""}`);
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
        if (action.type === "decision" && action.decision !== "stop") onNegotiate?.(action.opportunityId);
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
    onProgress: (text) => publishActions(client, intent.id, [{ type: "progress", text }], context),
  });

  if (!result.actions.length) log("  silent");
  await publishActions(
    client,
    intent.id,
    result.actions.filter((action) => action.type !== "brief" && action.type !== "decision" && action.type !== "resolve" && action.type !== "progress"),
    context,
  );
  // What the wake did is kept; what it left owed fails it, so the host retries.
  if (result.unresolved.length) throw new Error(`Wake left stalls unresolved on ${result.unresolved.join(", ")}.`);

  return result;
}

/**
 * @param message - One agent DM row.
 * @returns The principal entry stored on it, when this row is one.
 */
function principalOf(message: ConversationMessage): { summary?: boolean; kind?: string; matches?: { opportunityId?: string }[] } | undefined {
  const metadata = message.metadata as { principalMessage?: { summary?: boolean; kind?: string; matches?: { opportunityId?: string }[] } } | undefined;
  return metadata?.principalMessage;
}

/**
 * @param messages - The signal's agent DM, oldest first.
 * @returns When the last negotiation summary was written, or null when there has not been one.
 */
function lastSummaryAt(messages: ConversationMessage[]): Date | null {
  let latest: Date | null = null;
  for (const message of messages) {
    if (!principalOf(message)?.summary) continue;
    const at = new Date(message.createdAt);
    if (!latest || at > latest) latest = at;
  }
  return latest;
}

/**
 * @param messages - The signal's agent DM.
 * @returns Opportunities with a stall still in the transcript.
 */
function stalledOpportunities(messages: ConversationMessage[]): Set<string> {
  const stalled = new Set<string>();
  for (const entry of readConversation(messages)) {
    if (entry.kind === "stall" && entry.opportunity) stalled.add(entry.opportunity);
  }
  return stalled;
}

/**
 * @param negotiation - One negotiation on this signal.
 * @param userId - The seat owner.
 * @returns Whether this seat opened it: the first turn is theirs, or nobody has spoken and it is their turn.
 */
function initiatedBy(negotiation: NegotiationDetail, userId: string): boolean {
  const first = negotiation.turns[0];
  if (first) return first.seatUserId === userId;
  return negotiation.turnCount === 0 && negotiation.awaitingUserId === userId;
}

/**
 * @param negotiation - One negotiation this seat opened.
 * @param userId - The seat owner.
 * @param stalled - Opportunities already waiting on the principal.
 * @param now - Clock for the opening timeout.
 * @returns Whether its opening turn is still running, so this initiation is not finished.
 */
function stillOpening(negotiation: Negotiation, userId: string, stalled: Set<string>, now: Date): boolean {
  if (negotiation.settledAt || negotiation.turnCount > 0 || negotiation.awaitingUserId !== userId) return false;
  if (stalled.has(negotiation.opportunityId)) return false;
  return now.getTime() - new Date(negotiation.createdAt).getTime() < OPENING_MS;
}

/**
 * One initiation, read from the negotiations this seat opened since the last summary.
 *
 * While any of them is still on its opening turn, nothing is sent. When none are,
 * the summary of that set is written and the caller wakes once, so the decision
 * sees the whole initiation.
 *
 * @param client - Index for this owner.
 * @param intent - The signal.
 * @param runtime - Model, clock, and cancellation.
 * @returns `pending` while an opening turn is still running, `idle` when there is nothing to close, `done` when the summary note was sent.
 */
export async function closeInitiation(client: Index, intent: Intent, runtime: Runtime): Promise<"pending" | "idle" | "done"> {
  const { model, now: clock, signal, log = () => {} } = runtime;
  const now = clock?.() ?? new Date();
  const [user, inbox, rows] = await Promise.all([
    client.me(),
    client.principalInbox(intent.id),
    client.listIntentNegotiations(intent.id),
  ]);
  const since = lastSummaryAt(inbox.messages);
  const stalled = stalledOpportunities(inbox.messages);
  const batch = rows.filter((negotiation) =>
    negotiation.intentId === intent.id && (!since || new Date(negotiation.createdAt) > since));
  if (batch.some((negotiation) => stillOpening(negotiation, user.id, stalled, now))) return "pending";

  const details = (await Promise.all(
    batch.map((negotiation) => client.getNegotiation(negotiation.opportunityId).catch(() => null)),
  )).filter((detail): detail is NegotiationDetail => detail !== null && initiatedBy(detail, user.id));
  if (!details.length) return "idle";

  const opportunities = details
    .map((detail) => toOpportunity(detail, user.id))
    .filter((opportunity) => (opportunity.turns?.length ?? 0) > 0);
  if (!opportunities.length) return "idle";

  log(`  summarizing ${opportunities.length} negotiations`);
  const text = await summarize({ user, intent, opportunities, model, now: clock, signal });
  if (!text) {
    log("  no summary");
    return "idle";
  }
  const note: PrincipalMessage = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    kind: "message",
    matches: [],
    text,
    summary: true,
  };
  await client.sendPrincipal(intent.id, [note]);
  log(`  note: ${text}`);
  return "done";
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
 * A stall still standing holds the negotiator here, whatever woke it: its
 * fact is still missing, so running it would only stall again.
 *
 * @param client - Index for this owner.
 * @param opportunityId - The negotiation to work.
 * @param intent - The signal it belongs to.
 * @param runtime - Model, clock, and cancellation.
 * @returns The submitted turn, the stall it wrote, or why this run took none.
 */
export async function runNegotiate(
  client: Index,
  opportunityId: string,
  intent: Intent,
  runtime: Runtime,
): Promise<NegotiateRun> {
  const { model, now, signal, log = () => {} } = runtime;
  const [user, detail, inbox] = await Promise.all([
    client.me(),
    client.getNegotiation(opportunityId),
    client.principalInbox(intent.id),
  ]);
  if (detail.intentId !== intent.id) return { stall: { reason: `Opportunity ${opportunityId} belongs to another signal.` } };
  if (detail.awaitingUserId !== user.id) return { stall: { reason: "It is not this seat's turn." } };

  const principalConversation = readConversation(inbox.messages);
  const carried = standing(latestBriefs(principalConversation).get(opportunityId), detail);
  if (carried.stall) {
    return { held: carried.stall.answered ? "Its stall was answered and waits for a new decision." : "Its stall is still waiting on the principal." };
  }
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

  const { brief, decision } = opportunity;
  if (!brief) return { stall: { reason: "No brief for this opportunity yet." } };
  if (!decision || decision === "stop") return { stall: { reason: "This negotiation was stopped." } };

  opportunity.actions = (opportunity.actions ?? []).filter((action) => PERMITTED[decision].includes(action));
  if (!opportunity.actions.length) {
    return { stall: { reason: `Nothing this seat may do now carries out the standing decision to ${decision}.` } };
  }

  log(`  negotiating ${opportunityId} with ${opportunity.counterpart} at turn ${detail.turnCount}`);
  const result = await negotiate({ user, intent, brief, opportunity, model, now, signal });
  if ("turn" in result) {
    await client.submitTurn(opportunityId, { ...result.turn, expectedTurnCount: detail.turnCount });
    return result;
  }

  // The stall is this run's whole product, so it goes on the conversation: a
  // wake can then ask the principal for what the brief was missing.
  const text = result.stall.suggestedAsk
    ? `${result.stall.reason}${TO_ASK}${result.stall.suggestedAsk}`
    : result.stall.reason;
  await client.sendPrincipal(intent.id, [{
    ...entry("message", `${STALL}${text}`, [context.counterparts.get(opportunityId)!]),
    stall: { turnCount: detail.turnCount },
  }]);
  return result;
}

/**
 * What one signal still owes, read from Index alone, so a restarted host or a
 * failed wake loses nothing: a wake when a stall has no question yet or its
 * answer has not been decided on, and every negotiation whose turn is this
 * seat's with nothing holding it. A turn is fenced by its expected count, so
 * running one that another run already took cannot take it twice.
 *
 * @param client - Index for this owner.
 * @param intent - The signal.
 * @returns Whether to wake, and the negotiations to run.
 */
export async function owedWork(client: Index, intent: Intent): Promise<{ wake: boolean; negotiate: string[] }> {
  const [user, negotiations, inbox] = await Promise.all([
    client.me(),
    client.listIntentNegotiations(intent.id),
    client.principalInbox(intent.id),
  ]);
  const carried = latestBriefs(readConversation(inbox.messages));
  let wake = false;
  const negotiate: string[] = [];
  for (const negotiation of negotiations) {
    if (negotiation.settledAt) continue;
    const { stall, decision } = standing(carried.get(negotiation.opportunityId), negotiation);
    if (stall) {
      if (!stall.questionId || stall.answered) wake = true;
    } else if (negotiation.awaitingUserId === user.id && decision !== "stop") {
      negotiate.push(negotiation.opportunityId);
    }
  }
  return { wake, negotiate };
}
