/**
 * A non-price domain. The action vocabulary, which actions end things, and
 * the state each terminal action maps to are all replaced — the transport
 * and the loop don't change.
 *
 *   OPENROUTER_API_KEY=... bun run examples/02-custom-actions.ts
 */
import { Agent } from "../src/index.ts";
import { logOutcome, logTurn, MAX_TURNS, serve } from "./shared.ts";

type Action = "ask" | "offer" | "resolve" | "escalate";

const ACTIONS = [
  { action: "ask", description: "ask the other side for detail you don't have yet" },
  { action: "offer", description: "propose a specific remedy" },
  { action: "resolve", description: "agree the issue is settled; this closes the ticket" },
  { action: "escalate", description: "hand this to a human; this closes the ticket" },
] as const;

const isTerminal = (action: Action) => action === "resolve" || action === "escalate";

const support = new Agent<Action>({
  identity: { name: "Support", id: "did:example:support" },
  systemPrompt: "Close ticket #4471 (an order that shipped 14 days ago and never arrived) without a human getting involved. You may offer a replacement or store credit, but never a cash refund above $50 — escalate instead.",
  allowedActions: [...ACTIONS],
  isTerminal,
  terminalState: (action) => (action === "resolve" ? "completed" : "canceled"),
});

const { url, stop } = serve(support.handler());

const customer = new Agent<Action>({
  identity: { name: "Customer", id: "did:example:customer" },
  systemPrompt: "Get order #4471 replaced or refunded; it was ordered two weeks ago and never arrived",
  allowedActions: [...ACTIONS],
  isTerminal,
  onTurn: (turn) => logTurn(turn.speaker === "self" ? "Customer" : "Support", turn),
});

logOutcome(await customer.negotiate(url, { maxTurns: MAX_TURNS }));
stop();
