import { A2ANegotiationClient, fetchAgentCard } from "../../a2a/index.ts";
import { bearerCredentials } from "../../a2a/client/auth.ts";
import type { NegotiationDecision } from "../../core/types.ts";
import { buildNegotiator, parseActions } from "../options.ts";
import { dim, printTurn, yellow } from "../ui.ts";

export interface ConnectOptions {
  url: string;
  name: string;
  objective: string;
  actions?: string;
  model?: string;
  token?: string;
  turns?: string;
  expect?: string;
}

/**
 * Negotiates against another agent's A2A endpoint — the client half of
 * `negotiator serve`, or of any other A2A agent that speaks `message/send`.
 */
export async function connect(options: ConnectOptions): Promise<void> {
  const allowedActions = parseActions(options.actions);
  const maxTurns = Number(options.turns ?? "8");
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new Error("--turns must be a positive integer");
  }

  const credentials = options.token ? bearerCredentials(options.token) : undefined;

  // Fetch the card first: it's the only identity signal available before
  // committing to a negotiation, and it surfaces what auth is expected.
  const card = await fetchAgentCard(options.url, credentials);
  console.log(dim(`connected to ${card.name}${card.description ? ` — ${card.description}` : ""}`));
  if (card.security?.length && !options.token) {
    console.log(yellow("warning: this agent declares a security requirement but no --token was given"));
  }
  if (options.expect && card.name !== options.expect) {
    throw new Error(`expected agent "${options.expect}" at this URL, but found "${card.name}"`);
  }
  console.log(dim(`actions: ${allowedActions.join(", ")} · max turns: ${maxTurns}\n`));

  const client = new A2ANegotiationClient({
    negotiator: buildNegotiator(options.model),
    party: { name: options.name, objective: options.objective },
    allowedActions,
    ...(credentials ? { credentials } : {}),
    // Print our own turn the moment it's decided rather than after the
    // round trip, so turns appear one at a time instead of in pairs.
    onDecision: (decision) => printTurn(options.name, 0, decision.action, decision.message),
  });

  const printReply = (task: { history: { parts: { data?: unknown }[] }[] }) => {
    const last = task.history.at(-1)?.parts[0]?.data as NegotiationDecision | undefined;
    if (last) printTurn(card.name, 1, last.action, last.message);
  };

  let { task } = await client.initiate(options.url);
  printReply(task);

  let turns = 1;
  while (task.status.state === "input-required" && turns < maxTurns) {
    ({ task } = await client.continue(options.url, task));
    printReply(task);
    turns++;
  }

  console.log(dim(`\ntask ${task.id} ended: ${task.status.state}`));
}
