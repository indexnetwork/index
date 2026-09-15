import { run } from "./loop.ts";
import { tool, type Tool } from "./tool.ts";
import type { Decision, Opportunity, User, WakeAction, WakeInput, WakeResult } from "./types.ts";

/** How long a brief may be. Enough to authorise a negotiator, not to retell the signal. */
const BRIEF_LIMIT = 400;

const DECIDE_PROMPT = [
  "You decide one opportunity for your principal, autonomously when you have the fact and the authority; an A2A accept is not their consent.",
  "You decide; you never take a negotiation turn yourself. A negotiator acts on the brief you give it and nothing else — it cannot see your principal's conversation, the other opportunities, or ask anything. Whatever it needs must be in its brief.",
  "The negotiator is already told who it acts for, what the intent says, and what this counterpart is asking. Never spend the brief repeating those. A decline needs one sentence of reason. A continue needs what to propose, any personal fact the negotiator does not have — where your principal is, what they build — and what it must not concede. Nothing else.",
  "Call decide exactly once, for this opportunity only. That call is this run's whole product: nothing you say outside it is kept.",
  "Do not invent facts. Do not contradict what your principal's conversation already settled.",
].join("\n\n");

const ATTEND_PROMPT = [
  "You speak to your principal about this signal. Ask a question when a missing personal fact or an approval to commit them would change the next move. Write a note when an outcome or obstacle is worth their attention. Retire a question whose answer can no longer change anything.",
  "Routine progress is not worth a note, and a negotiator's own decisions are not yours to report. Stay silent when nothing needs them.",
  "Do not invent facts. Do not re-ask what this conversation already answered.",
].join("\n\n");

const DECISIONS: Decision[] = ["continue", "accept", "decline", "stop"];

/**
 * @param user - The principal as the host read them.
 * @returns What may be stated about them as fact, or null when they confirmed nothing.
 */
function principalFacts(user: User): Pick<User, "name" | "intro" | "location" | "timezone"> | null {
  if (!user.profileConfirmed) return null;
  return { name: user.name, intro: user.intro ?? null, location: user.location ?? null, timezone: user.timezone ?? null };
}

/**
 * The opportunities this wake owes a decision: this seat's move, with nothing
 * standing that already carries it.
 *
 * @param opportunities - Every opportunity on this signal.
 * @param focus - The only opportunity to work, when this wake has one.
 * @returns Those a decide run must work, in snapshot order.
 */
function pending(opportunities: Opportunity[], focus?: string): Opportunity[] {
  return opportunities.filter(
    (opportunity) =>
      (!focus || opportunity.id === focus) &&
      opportunity.status === "negotiating" &&
      opportunity.awaiting !== "them" &&
      (!opportunity.brief || !opportunity.decision || opportunity.stall),
  );
}

/**
 * One wake over a signal: decide every opportunity that is this seat's move,
 * all at once and each reported through `onDecision` as it lands, then speak
 * to the principal.
 *
 * Speaking is the run's own judgement, not the host's: every unfocused wake
 * reaches the model for it, and staying silent is one of its outcomes.
 *
 * A focused wake is the passive case: it decides that one opportunity and
 * stays silent toward the principal, so a counterpart's turn cannot pull the
 * whole signal into work nobody asked for.
 *
 * @param input - The signal, its conversation, its opportunities, and the model.
 * @returns The actions for the host to persist and run. Empty means stay silent.
 */
export async function wake(input: WakeInput): Promise<WakeResult> {
  const { user, intent, principalConversation, opportunities } = input;
  const actions: WakeAction[] = [];
  const identity = { id: user.id, name: user.name ? `${user.name}'s personal agent` : user.id };
  const principal = principalFacts(user);
  // Briefs, decisions and stalls are already carried on the opportunities
  // themselves, so the conversation a run reads is only what passed between the
  // principal and their counterparts.
  const conversation = principalConversation.filter(
    (entry) => entry.kind !== "brief" && entry.kind !== "decision" && entry.kind !== "stall",
  );
  const runtime = {
    model: input.model,
    identity,
    intent,
    maxSteps: 1,
    ...(input.now ? { now: input.now } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };

  /** @param opportunity - The opportunity this run decides. */
  const decide = async (opportunity: Opportunity): Promise<void> => {
    const decided: WakeAction[] = [];
    const tools: Tool<never>[] = [
      tool({
        name: "decide",
        description:
          "Decide this opportunity and brief its negotiator: continue takes the next turn from the brief; accept, decline or stop end it. This is not a turn. The brief is the only thing the negotiator carries into it.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            decision: { type: "string", enum: DECISIONS },
            brief: {
              type: "string",
              minLength: 1,
              maxLength: BRIEF_LIMIT,
              description: opportunity.brief
                ? "A replacement brief. Omit it to leave the standing brief in place."
                : "This opportunity's brief. Required: it has none yet.",
            },
          },
          required: opportunity.brief ? ["decision"] : ["decision", "brief"],
        },
        run: ({ decision, brief }: { decision: Decision; brief?: string }) => {
          if (!brief && !opportunity.brief) {
            throw new Error("This opportunity has no brief yet, so this decision needs one: the negotiator carries it out from the brief alone.");
          }
          if (brief) decided.push({ type: "brief", opportunityId: opportunity.id, brief });
          decided.push({ type: "decision", opportunityId: opportunity.id, decision });
          return "Decision recorded.";
        },
      }),
    ];

    await run({
      ...runtime,
      instructions: DECIDE_PROMPT,
      prompt: "Decide this one opportunity now.\n" + JSON.stringify({ principal, conversation, opportunity }),
      tools,
    });

    if (!decided.length) return;
    actions.push(...decided);
    await input.onDecision?.(decided);
  };

  const attend = (): Promise<void> => {
    const known = new Set(opportunities.map((opportunity) => opportunity.id));
    const tools: Tool<never>[] = [
      tool({
        name: "ask",
        description:
          "Ask the principal one question, when a missing personal fact or an approval to commit them would change the next move. Use opportunity scope for one counterpart's terms or any approval, intent scope for a standing fact.",
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
          if (argument.scope === "opportunity") {
            if (!argument.opportunityId) throw new Error("An opportunity-scoped question needs its opportunityId.");
            if (!known.has(argument.opportunityId)) {
              throw new Error(`No opportunity ${argument.opportunityId}. Use one of: ${[...known].join(", ") || "none"}.`);
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
        name: "note",
        description:
          "Write one note into the conversation, when an outcome or obstacle is worth the principal's attention. Routine progress is not.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { text: { type: "string", minLength: 1 } },
          required: ["text"],
        },
        run: ({ text }: { text: string }) => {
          actions.push({ type: "note", text });
          return "Note recorded.";
        },
      }),
      tool({
        name: "expire_question",
        description: "Retire a question already put to the principal, when its answer can no longer change anything.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { questionId: { type: "string" } },
          required: ["questionId"],
        },
        run: ({ questionId }: { questionId: string }) => {
          actions.push({ type: "expire", questionId });
          return "Question expired.";
        },
      }),
    ];

    return run({
      ...runtime,
      instructions: ATTEND_PROMPT,
      prompt:
        "Say what your principal needs to hear about this signal now, or nothing.\n" +
        JSON.stringify({ principal, conversation, opportunities }),
      tools,
    });
  };

  // One failed decide costs that opportunity and nothing else: it stays
  // unbriefed, so the next wake owes it again.
  await Promise.allSettled(pending(opportunities, input.focus).map(decide));

  if (!input.focus) await attend();

  return { actions };
}
