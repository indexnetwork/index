import {
  A2ANegotiationClient,
  fetchAgentCard,
  strategyWithTerms,
  verifyAgreement,
} from "../../a2a/index.ts";
import { bearerCredentials } from "../../a2a/client/auth.ts";
import type { NegotiationDecision } from "../../core/types.ts";
import { buildNegotiator, parseActions } from "../options.ts";
import { dim, green, printTurn, yellow } from "../ui.ts";

export interface ConnectOptions {
  url: string;
  name: string;
  objective: string;
  actions?: string;
  model?: string;
  token?: string;
  turns?: string;
  expect?: string;
  terms?: string;
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

  // ^C should stop the request in flight, not just the loop around it —
  // otherwise the first interrupt leaves an orphaned turn still running.
  const interrupt = new AbortController();
  const onSigint = () => interrupt.abort(new Error("interrupted"));
  process.once("SIGINT", onSigint);
  const signal = interrupt.signal;

  try {
    // Fetch the card first: it's the only identity signal available before
    // committing to a negotiation, and it surfaces what auth is expected.
    const card = await fetchAgentCard(options.url, credentials, { signal });
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
      ...(options.terms ? { strategy: strategyWithTerms<string>(options.terms) } : {}),
      // Print our own turn the moment it's decided rather than after the
      // round trip, so turns appear one at a time instead of in pairs.
      onDecision: (decision) => printTurn(options.name, 0, decision.action, decision.message),
    });

    const printReply = (task: { history: { parts: { data?: unknown }[] }[] }) => {
      const last = task.history.at(-1)?.parts[0]?.data as NegotiationDecision | undefined;
      if (last) printTurn(card.name, 1, last.action, last.message);
    };

    let { task, outcome } = await client.initiate(options.url, { signal });
    printReply(task);

    let turns = 1;
    while (outcome === "input-required" && turns < maxTurns) {
      ({ task, outcome } = await client.continue(options.url, task, { signal }));
      printReply(task);
      turns++;
    }

    // `outcome` is the server-stamped state, not our own last action — the
    // two can disagree when the counterparty closes in the same round trip.
    console.log(dim(`\ntask ${task.id} ended: ${outcome}`));

    const agreement = verifyAgreement(task);
    if (agreement.status === "agreed") {
      console.log(`${green("agreed")} ${JSON.stringify(agreement.terms)}`);
    } else if (agreement.status === "conflict") {
      console.log(yellow(`conflict: ${agreement.reason}`));
    } else {
      console.log(dim(`${agreement.status}${agreement.reason ? `: ${agreement.reason}` : ""}`));
    }
  } finally {
    process.off("SIGINT", onSigint);
  }
}
