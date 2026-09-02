/**
 * A domain with no price in it at all. The action vocabulary, which actions
 * end things, and the state each terminal action maps to are all replaced —
 * the transport and the loop don't change.
 *
 * Here two agents negotiate an *introduction*: whether one party's contact
 * is worth putting in front of the other, and on what basis. Nothing is
 * bought; the thing being agreed is access to a person.
 *
 *   OPENROUTER_API_KEY=... bun run examples/04-custom-actions.ts
 */
import { Agent } from "../src/index.ts";
import { logOutcome, logTurn, MAX_TURNS, serve } from "./shared.ts";

type Action = "ask" | "propose" | "introduce" | "refer" | "decline";

const ACTIONS = [
  { action: "ask", description: "ask for context you need before deciding" },
  { action: "propose", description: "suggest a basis for the introduction" },
  { action: "introduce", description: "agree to make the introduction; this settles it" },
  {
    action: "refer",
    description: "point them at someone better suited instead; this settles it",
  },
  { action: "decline", description: "decline to introduce; this settles it" },
] as const;

const isTerminal = (action: Action) =>
  action === "introduce" || action === "refer" || action === "decline";

// The person holding the relationship. Their agent is protecting someone
// else's time, which is what makes this a negotiation rather than a request.
const connector = new Agent<Action>({
  identity: { name: "Mara's Agent", id: "did:example:mara" },
  systemPrompt:
    "You act for Mara, who knows the VP of Engineering at a large European retailer well. She will make an introduction only when there is a concrete reason the VP would want it — a specific problem the other side has already solved, not a pitch. She will not pass on anyone still looking for a first customer. If they are early but credible, refer them to her colleague who runs the startup programme instead.",
  allowedActions: [...ACTIONS],
  isTerminal,
  terminalState: (action) => (action === "introduce" ? "completed" : "rejected"),
});

const { url, stop } = serve(connector.handler());

const seeker = new Agent<Action>({
  identity: { name: "Sami's Agent", id: "did:example:sami" },
  systemPrompt:
    "You act for Sami, who is looking for an introduction to procurement or engineering at a large European retailer. His company already runs in production at two mid-size retailers and cut their returns processing time by a third. Be specific about that rather than pitching, and do not overstate: they have no enterprise customers yet.",
  allowedActions: [...ACTIONS],
  isTerminal,
  onTurn: (turn) => logTurn(turn.speaker === "self" ? "Sami's Agent" : "Mara's Agent", turn),
});

logOutcome(await seeker.negotiate(url, { maxTurns: MAX_TURNS }));
stop();
