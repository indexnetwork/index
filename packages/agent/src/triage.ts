import type { Model } from "./model.ts";
import type { Stall } from "./types.ts";

/** Who holds what a stall is missing: the principal, the counterpart, or neither until the two talk. */
export type Territory = "principal" | "counterpart" | "deferrable";

const TERRITORIES: readonly Territory[] = ["principal", "counterpart", "deferrable"];

const TRIAGE_PROMPT = [
  "A negotiator acting for its principal stopped because it was missing one piece of information. Decide who can supply it. The negotiation only settles whether the principal and the counterpart should connect; nothing is being arranged yet.",
  "Answer deferrable when the information only matters for arranging things once they decide to connect: an exact time, a venue or address, a price, contract details. It does not bear on whether they should connect. For example, which Thursday slot works, or the office address to meet at.",
  "Otherwise answer counterpart when it concerns the counterpart: what they want, their terms, their situation, what their claim rests on. For example, they said they have a thesis but not what it is.",
  "Otherwise answer principal: it concerns the principal themselves (their stage, whether they are raising, what they bring, their materials or preferences), it needs their consent, or you are not sure.",
  "Give a one-sentence reason, then call classify_stall once.",
].join("\n\n");

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
          description: "Record who can supply what the stall is missing, with a one-sentence reason first.",
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
