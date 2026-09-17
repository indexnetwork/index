import type { Counterparty, CounterpartyPick } from "@indexnetwork/client";

import { BRIEF_LIMIT, BRIEF_PROMPT, DECISIONS, principalFacts, principalOnly, recordBrief } from "./brief.ts";
import { run } from "./loop.ts";
import { tool, type Tool } from "./tool.ts";
import type { ConversationEntry, Decision, WakeAction, WakeInput, WakeResult } from "./types.ts";

/** How many turns a wake gets: room to decide a few things, speak, and search. */
const WAKE_STEPS = 8;

const WAKE_PROMPT = [
  "You think for your principal about one signal, because something just happened on it. Your job is to work out what that event actually changes, and to act only there.",
  "A wake is situational. You are not reviewing the signal: you do not owe every opportunity a decision, every open question an answer, or the principal a status report. Touching nothing is a normal outcome, and staying silent is better than manufacturing work.",
  BRIEF_PROMPT,
  "Do not re-decide an opportunity whose brief and decision still hold. A stall alone is not a reason to decide again — the stall is what the principal is asked about, and deciding on it would close the negotiation with the fact still missing.",
  "Do not re-ask what this conversation already answered, and do not ask again what already has an unanswered question. A question standing open is not a reason to expire it either: retire one only when the principal's own words have made its answer unable to change anything.",
  "Before you ask anything, write one note. The note is your voice to your principal, and it covers only what you did on this wake — the decisions you just made, why the question you are about to ask matters, why you searched or opened something. Not a summary of the signal, and never a negotiator's own moves.",
  "Do not invent facts. Do not contradict what your principal's conversation already settled. You never take a negotiation turn yourself.",
].join("\n\n");

/**
 * The questions still waiting on the principal, mirroring how the host reads
 * the same transcript: an answer or an expiry retires one, a later question
 * does not.
 *
 * @param conversation - The signal's conversation, oldest first.
 * @returns Each open question's text by id.
 */
function openQuestions(conversation: ConversationEntry[]): Map<string, string> {
  const open = new Map<string, string>();
  for (const entry of conversation) {
    if (!entry.questionId) continue;
    if (entry.kind === "question") open.set(entry.questionId, entry.text);
    else if (entry.kind === "answer" || entry.kind === "expire") open.delete(entry.questionId);
  }
  return open;
}

/**
 * One wake over one signal: a single reasoning pass that decides what this
 * event requires, in whatever mix of deciding, speaking and searching that
 * takes — or nothing.
 *
 * Every decision is reported through `onBrief` the moment it lands, so its
 * negotiator can start while the wake is still thinking.
 *
 * @param input - The signal, its conversation, its opportunities, the model, and Index.
 * @returns The actions for the host to persist and run. Empty means stay silent.
 */
export async function wake(input: WakeInput): Promise<WakeResult> {
  const { user, intent, opportunities, client } = input;
  const actions: WakeAction[] = [];
  const conversation = principalOnly(input.principalConversation);
  const open = openQuestions(input.principalConversation);
  const byId = new Map(opportunities.map((opportunity) => [opportunity.id, opportunity]));
  // A run may only create what its own searches returned, so the network a
  // pair sits in is the one Index reported rather than one the model names.
  const found = new Map<string, Counterparty>();
  let noted = false;
  /** The host's first failure to persist a decision, raised once the loop is done. */
  let unpersisted: unknown;

  const tools: Tool<never>[] = [
    tool({
      name: "set_brief",
      description:
        "Decide one opportunity and brief its negotiator. Its negotiator starts as soon as you call this. The brief text is required when that opportunity has none yet, and otherwise replaces the standing one.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          opportunityId: { type: "string" },
          decision: { type: "string", enum: DECISIONS },
          brief: { type: "string", minLength: 1, maxLength: BRIEF_LIMIT },
        },
        required: ["opportunityId", "decision"],
      },
      run: async ({ opportunityId, decision, brief }: { opportunityId: string; decision: Decision; brief?: string }) => {
        const opportunity = byId.get(opportunityId);
        if (!opportunity) {
          throw new Error(`No opportunity ${opportunityId}. Use one of: ${[...byId.keys()].join(", ") || "none"}.`);
        }
        const decided = recordBrief(opportunity, decision, brief);
        actions.push(...decided);
        // The standing brief moves with the decision, so a second call in this
        // same wake is judged against what was just written.
        if (brief) opportunity.brief = brief;
        opportunity.decision = decision;
        // Whether the host could persist this is not the model's business. A
        // failure told back as a tool result would have it reason about the
        // host's problem and write briefs about it, so it is kept for the
        // caller and raised once the loop ends.
        try {
          await input.onBrief?.(decided);
        } catch (cause) {
          unpersisted ??= cause;
        }
        return "Brief recorded, and its negotiator is starting.";
      },
    }),
    tool({
      name: "note_principal",
      description:
        "Tell your principal what you did on this wake: the decisions you just made, the reason for the question you are about to ask, why you searched or opened something. Required before any question. Do not write one when this wake did nothing worth their attention.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { text: { type: "string", minLength: 1 } },
        required: ["text"],
      },
      run: ({ text }: { text: string }) => {
        actions.push({ type: "note", text });
        noted = true;
        return "Note recorded. You may ask now.";
      },
    }),
    tool({
      name: "ask_principal",
      description:
        "Ask your principal one question, when a missing personal fact or an approval to commit them would change the next move. Use opportunity scope for one counterpart's terms or any approval, intent scope for a standing fact. Call note_principal first.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string", minLength: 1 },
          options: { type: "array", minItems: 2, maxItems: 4, uniqueItems: true, items: { type: "string", minLength: 1 } },
          scope: { type: "string", enum: ["intent", "opportunity"] },
          opportunityId: { type: "string", description: "Required when scope is opportunity." },
        },
        required: ["question", "options", "scope"],
      },
      run: (argument: { question: string; options: string[]; scope: "intent" | "opportunity"; opportunityId?: string }) => {
        if (!noted) {
          throw new Error("Write the note first with note_principal: your principal reads why you are asking before the question itself.");
        }
        if (argument.scope === "opportunity") {
          if (!argument.opportunityId) throw new Error("An opportunity-scoped question needs its opportunityId.");
          if (!byId.has(argument.opportunityId)) {
            throw new Error(`No opportunity ${argument.opportunityId}. Use one of: ${[...byId.keys()].join(", ") || "none"}.`);
          }
        }
        actions.push({
          type: "ask",
          scope: argument.scope,
          question: argument.question,
          options: argument.options,
          ...(argument.opportunityId ? { opportunityId: argument.opportunityId } : {}),
        });
        return "Question recorded.";
      },
    }),
    tool({
      name: "expire_question",
      description:
        "Retire a question already waiting on your principal, when their own words have made its answer unable to change anything. It leaves their queue unanswered.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { questionId: { type: "string" } },
        required: ["questionId"],
      },
      run: ({ questionId }: { questionId: string }) => {
        if (!open.has(questionId)) {
          throw new Error(`No question ${questionId} is waiting on your principal. Open questions: ${[...open.keys()].join(", ") || "none"}.`);
        }
        open.delete(questionId);
        actions.push({ type: "expire", questionId });
        return "Question retired.";
      },
    }),
    tool({
      name: "discover_counterparties",
      description:
        "Search this signal's communities for people it should reach. A query is the kind of person this signal needs, in your own words, not the signal restated. Returns counterparties with their own statement, strongest first. Anyone this signal is already working is left out, and nothing you search for is shown to anyone.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { query: { type: "string", minLength: 1 } },
        required: ["query"],
      },
      run: async ({ query }: { query: string }) => {
        const counterparties = await client.discover(intent.id, query);
        for (const counterparty of counterparties) found.set(counterparty.intentId, counterparty);
        return counterparties.length
          ? counterparties
          : "No counterparties matched that query. Try a different one, or stop.";
      },
    }),
    tool({
      name: "create_opportunities",
      description:
        "Open an opportunity for each counterparty worth your principal's time, naming only counterparties a search in this wake returned. Creating one commits them to working it, so create none when nothing pairs: a weak match costs more than an empty search.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          counterparties: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              properties: { intentId: { type: "string" } },
              required: ["intentId"],
            },
          },
        },
        required: ["counterparties"],
      },
      run: async ({ counterparties }: { counterparties: { intentId: string }[] }) => {
        const picks: CounterpartyPick[] = counterparties.map((pick) => {
          const counterparty = found.get(pick.intentId);
          if (!counterparty) {
            throw new Error(
              `No counterparty ${pick.intentId} in this wake's results. Search first, and name only what a search returned.`,
            );
          }
          return { intentId: counterparty.intentId, networkId: counterparty.networkId };
        });
        const created = await client.createOpportunities(intent.id, picks);
        return `Created ${created.length} of ${picks.length}. The rest were already opportunities or are no longer reachable.`;
      },
    }),
  ];

  await run({
    model: input.model,
    identity: { id: user.id, name: user.name ? `${user.name}'s personal agent` : user.id },
    intent,
    maxSteps: WAKE_STEPS,
    ...(input.now ? { now: input.now } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    instructions: WAKE_PROMPT,
    prompt:
      "Something happened on this signal. Work out what it changes, act only there, and stop.\n" +
      JSON.stringify({
        principal: principalFacts(user),
        conversation,
        opportunities,
        openQuestions: [...open].map(([questionId, question]) => ({ questionId, question })),
      }),
    tools,
  });

  if (unpersisted) throw unpersisted;
  return { actions };
}
