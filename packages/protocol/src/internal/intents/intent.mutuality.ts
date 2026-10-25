import { z } from "zod";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { createStructuredModel } from "../shared/agent/model.config.js";

const AnswerSchema = z.object({ yes: z.boolean() });

/** One side of a mutual check. The other side's private intents never appear here. */
export interface MutualitySide {
  statement: string;
  privateIntents: string[];
  otherStatement: string;
}

const SYSTEM = [
  "You answer one yes-or-no question about two people's intents.",
  "Yes only when the other statement plainly satisfies this side's statement.",
  "This side's private intents are rules. If the other statement plainly breaks one, answer no.",
  "Answer no when it is unclear. Return only the boolean.",
].join(" ");

/**
 * Whether one side wants the other, given only that side's statement, its private intents, and the other statement.
 * @param side - The check input the host built. A future envelope replaces how the host builds it.
 * @returns True only on an explicit yes.
 */
export async function sideIsInterested(side: MutualitySide): Promise<boolean> {
  const model = createStructuredModel("intentMutuality", AnswerSchema, { name: "mutuality" });
  const rules = side.privateIntents.length
    ? side.privateIntents.map((text) => `- ${text}`).join("\n")
    : "(none)";
  const result = await model.invoke([
    new SystemMessage(SYSTEM),
    new HumanMessage(`This side wants:\n${side.statement}\n\nThis side's private intents:\n${rules}\n\nThe other side's statement:\n${side.otherStatement}\n\nDoes the other statement satisfy what this side wants?`),
  ]);
  return result.yes === true;
}
