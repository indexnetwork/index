import type { ApiClient } from "./api.client";
import type { ParsedCommand } from "./args.parser";
import type { NegotiationTurnAction } from "./types";

/** Submit and inspect negotiations through the current HTTP contract. */
export async function handleNegotiation(client: ApiClient, subcommand: string | undefined, options: Pick<ParsedCommand, "targetId" | "intentId" | "state" | "action" | "message" | "expectedTurnCount" | "json">): Promise<void> {
  let result: unknown;
  if (subcommand === "list") {
    if (options.state !== undefined && options.state !== "open" && options.state !== "settled") throw new Error("--state must be open or settled");
    result = await client.listNegotiations({ intentId: options.intentId, state: options.state });
  } else if (subcommand === "show" || subcommand === "turn") {
    if (!options.targetId) throw new Error("An opportunity ID is required");
    if (subcommand === "show") {
      result = await client.getNegotiation(options.targetId);
    } else {
      if (!options.action || !["propose", "counter", "accept", "decline"].includes(options.action)) throw new Error("--action must be propose, counter, accept, or decline");
      if (!options.message?.trim()) throw new Error("--message is required");
      if (options.expectedTurnCount === undefined || !Number.isSafeInteger(options.expectedTurnCount) || options.expectedTurnCount < 0) throw new Error("--expected-turn-count must be the observed nonnegative integer turn count");
      result = await client.submitNegotiationTurn(options.targetId, {
        action: options.action as NegotiationTurnAction,
        message: options.message,
        expectedTurnCount: options.expectedTurnCount,
      });
    }
  } else {
    throw new Error("Usage: index negotiation list [--intent-id <id>] [--state open|settled], show <opportunity-id>, or turn <opportunity-id> --action <action> --message <text> --expected-turn-count <n>");
  }
  console.log(JSON.stringify(result, null, options.json ? undefined : 2));
}
