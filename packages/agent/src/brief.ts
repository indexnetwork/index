import { run } from "./loop.ts";
import { tool, type Tool } from "./tool.ts";
import type { BriefInput, ConversationEntry, Decision, Opportunity, User, WakeAction } from "./types.ts";

/** How long a brief may be. Enough to authorise a negotiator, not to retell the signal. */
export const BRIEF_LIMIT = 400;

export const DECISIONS: Decision[] = ["continue", "accept", "decline", "stop"];

/** What `set_brief` is for, in both runtimes that offer it. */
export const BRIEF_PROMPT = [
  "A decision is what a negotiator carries out: continue takes the next turn from the brief; accept, decline or stop end the negotiation. Deciding is not taking a turn.",
  "A negotiator acts on its brief and nothing else — it cannot see your principal's conversation, the other opportunities, or ask anything. Whatever it needs must be in the brief.",
  "A negotiation is a first contact between two people who have not met, and it settles only whether there is a reason for them to connect. Times, places, prices and project specifics are theirs to settle once they are talking, so a brief never carries them, and never carries terms to hold out for.",
  "Read the signal as requirements, not a theme. Every explicit qualifier — role, domain, location, stage, timing, budget, or anything else that narrows who fits — must hold. Contrary evidence means decline. Missing evidence means continue so the negotiator can ask the counterpart; it is never permission to assume a fit. Accept only when every requirement that could change whether they should meet is supported by the opportunity or the negotiation.",
  "The negotiator is already told who it acts for, what the intent says, and what this counterpart is asking. Never spend the brief repeating those. A decline needs one sentence of reason. A continue needs the reason this pair is worth a first conversation, and any fact about your principal the negotiator would need to make that case — what they work on, what they want out of it. Nothing else.",
  "Decide autonomously where you have the fact and the authority; an A2A accept is not your principal's consent. Do not invent facts, and do not contradict what their conversation already settled.",
].join("\n\n");

const BRIEF_ONLY_PROMPT = [
  "You give one new opportunity the brief and decision it does not have yet, so its negotiator can run at all.",
  BRIEF_PROMPT,
  "Call set_brief exactly once, for this opportunity only. That call is this run's whole product: nothing you say outside it is kept. You cannot speak to your principal here — if a fact is missing, decide from what you have and leave asking to a wake.",
].join("\n\n");

/**
 * @param user - The principal as the host read them.
 * @returns What may be stated about them as fact, or null when they confirmed nothing.
 */
export function principalFacts(user: User): Pick<User, "name" | "intro" | "location" | "timezone"> | null {
  if (!user.profileConfirmed) return null;
  return { name: user.name, intro: user.intro ?? null, location: user.location ?? null, timezone: user.timezone ?? null };
}

/**
 * Briefs, decisions, stalls and resolutions are carried on the opportunities themselves, so
 * the conversation a run reads is only what passed between the principal and
 * their counterparts.
 *
 * @param conversation - The signal's conversation as the host read it.
 * @returns The same conversation without the run's own bookkeeping.
 */
export function principalOnly(conversation: ConversationEntry[]): ConversationEntry[] {
  return conversation.filter(
    (entry) => entry.kind !== "brief" && entry.kind !== "decision" && entry.kind !== "stall" && entry.kind !== "resolution",
  );
}

/** The `set_brief` parameter shape for one opportunity, requiring brief text only when it has none. */
export function briefParameters(opportunity: Opportunity) {
  return {
    type: "object" as const,
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
  };
}

/**
 * @param opportunity - The opportunity being decided, for its standing brief.
 * @param decision - What the negotiator must carry out.
 * @param brief - New brief text, when this call replaces or first writes it.
 * @returns The actions the host persists, brief before decision.
 * @throws When the opportunity has no brief and this call gives none.
 */
export function recordBrief(opportunity: Opportunity, decision: Decision, brief?: string): WakeAction[] {
  if (!brief && !opportunity.brief) {
    throw new Error(
      "This opportunity has no brief yet, so this decision needs one: the negotiator carries it out from the brief alone.",
    );
  }
  const recorded: WakeAction[] = [];
  if (brief) recorded.push({ type: "brief", opportunityId: opportunity.id, brief });
  recorded.push({ type: "decision", opportunityId: opportunity.id, decision });
  return recorded;
}

/**
 * Give one opportunity a brief and decision when it has neither, so a
 * negotiator can run without waiting for a wake.
 *
 * This is the whole reason briefing is no longer a wake phase: a counterpart
 * can open or move a negotiation at any time, and that alone should not pull
 * the principal's whole signal into a think pass.
 *
 * @param input - The opportunity, the conversation behind it, and the model.
 * @returns The brief and decision to persist, or nothing when both already stand.
 */
export async function briefIfMissing(input: BriefInput): Promise<WakeAction[]> {
  const { user, intent, opportunity } = input;
  if (opportunity.brief && opportunity.decision) return [];

  const recorded: WakeAction[] = [];
  const tools: Tool<never>[] = [
    tool({
      name: "set_brief",
      description:
        "Decide this opportunity and brief its negotiator. The brief is the only thing the negotiator carries into its turn.",
      parameters: briefParameters(opportunity),
      run: ({ decision, brief }: { decision: Decision; brief?: string }) => {
        recorded.push(...recordBrief(opportunity, decision, brief));
        return "Brief recorded.";
      },
    }),
  ];

  await run({
    model: input.model,
    identity: { id: user.id, name: user.name ? `${user.name}'s personal agent` : user.id },
    intent,
    maxSteps: 1,
    ...(input.now ? { now: input.now } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    instructions: BRIEF_ONLY_PROMPT,
    prompt:
      "Brief this one opportunity now.\n" +
      JSON.stringify({
        principal: principalFacts(user),
        conversation: principalOnly(input.principalConversation),
        opportunity,
      }),
    tools,
  });

  return recorded;
}
