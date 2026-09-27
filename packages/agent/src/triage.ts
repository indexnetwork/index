import type { Model } from "./model.ts";
import type { Stall } from "./types.ts";

/** Who holds what a stall is missing: the principal, the counterpart, or neither until the two talk. */
export type Territory = "principal" | "counterpart" | "deferrable";

const TERRITORIES: readonly Territory[] = ["principal", "counterpart", "deferrable"];

const TRIAGE_PROMPT = `
You classify one stall. A negotiator acting for its principal stopped because it was missing a piece of information. Decide whose territory that information is in.

Always reason before classifying. Output reasoning first.

═══════════════════════════════════════════════════
DEFINITIONS
═══════════════════════════════════════════════════

Territory of information (Kamio, 1997): information belongs to a person's territory when it concerns them — their circumstances, plans, resources, experience or expertise.

Epistemic status (Heritage, 2012): the party who is K+ on a proposition, the one with knowledge of it, is the one who can answer for it.

The principal is the person the negotiator acts for. The counterpart is the other person in the negotiation. This negotiation only settles whether the two of them should connect; nothing is being arranged yet.

═══════════════════════════════════════════════════
TERRITORY
═══════════════════════════════════════════════════

Work through this decision tree in order. Stop at the first matching branch.

IF the information only matters for arranging things once the two decide to connect — exact dates or times beyond rough availability, venues or addresses finer than a required city, prices, contract or project specifics, meeting logistics — and it does not bear on whether they should connect. This applies whoever holds it:
  → deferrable

  deferrable positive examples:
  · "The counterpart asked which Thursday afternoon slot works for a call" → deferrable (exact time)
  · "They want the office address to meet at" → deferrable (venue finer than a city)
  · "They asked what day rate the principal would charge for the contract" → deferrable (price)

  deferrable negative examples (do NOT classify these as deferrable):
  · "The counterpart asked whether the principal is currently raising a seed round" → principal (their stage decides whether to connect)
  · "The signal requires someone in Berlin and we do not know if the counterpart is based there" → counterpart (a required city bears on the fit)

ELSE IF the information concerns the counterpart — what they want out of this, their terms, their situation, their reasons, what their claim rests on:
  → counterpart

  counterpart positive examples:
  · "The counterpart never said what they want from the principal" → counterpart (their outcome)
  · "Their proposal claims prior fintech experience without saying what it was" → counterpart (what their claim rests on)
  · "Unclear whether the counterpart is hiring full-time or looking for a contractor" → counterpart (their terms)

  counterpart negative examples (do NOT classify these as counterpart):
  · "The counterpart asked whether the principal would relocate" → principal (the principal's own plans)
  · "The counterpart asked where exactly to meet" → deferrable (logistics)

Otherwise — the information concerns the principal themselves (who they are, their stage, whether they are raising, what they would bring, materials such as a deck, their preferences), it needs their consent to commit them, or it is unclear whose it is:
  → principal

  principal positive examples:
  · "The counterpart asked what stage the principal's company is at" → principal (stage)
  · "They asked for the principal's pitch deck" → principal (materials)
  · "Accepting would commit the principal to an unpaid pilot the brief does not authorize" → principal (consent)

  principal negative examples (do NOT classify these as principal):
  · "The counterpart asked if the principal is free next Tuesday at 3pm" → deferrable (exact availability, unless rough availability is decisive)
  · "We do not know what the counterpart wants out of the introduction" → counterpart

Call classify_stall exactly once.
`.trim();

/** Everything triage sees: the stall and the counterpart's last word, nothing else. */
export interface TriageInput {
  model: Model;
  stall: Stall;
  /** The counterpart's last turn message, or null when they have not spoken. */
  counterpartMessage: string | null;
  signal?: AbortSignal;
}

/**
 * Classify one stall by who holds the missing information.
 *
 * One isolated model call that never throws: a failed call, no tool call or an
 * invalid territory all read as `principal`, the stall's path before triage.
 *
 * @param input - The model, the stall, and the counterpart's last message.
 * @returns Whose territory the missing information is in.
 */
export async function triageStall(input: TriageInput): Promise<Territory> {
  try {
    const reply = await input.model.complete(
      [
        { role: "system", content: TRIAGE_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            reason: input.stall.reason,
            suggestedAsk: input.stall.suggestedAsk ?? null,
            counterpartMessage: input.counterpartMessage,
          }),
        },
      ],
      [{
        type: "function",
        function: {
          name: "classify_stall",
          description: "Record whose territory the stall's missing information is in, reasoning first.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              reasoning: { type: "string" },
              territory: { type: "string", enum: TERRITORIES },
            },
            required: ["reasoning", "territory"],
          },
        },
      }],
      input.signal,
    );
    const { territory } = JSON.parse(reply.tool_calls?.[0]?.function.arguments ?? "{}") as { territory?: Territory };
    return territory && TERRITORIES.includes(territory) ? territory : "principal";
  } catch {
    return "principal";
  }
}
