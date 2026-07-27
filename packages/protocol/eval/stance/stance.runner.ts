import { IndexNegotiator } from "../../src/negotiation/application/negotiation.agent.js";
import type { NegotiationTurn } from "../../src/negotiation/domain/negotiation.state.js";
import type { NegotiatorStance } from "../../src/negotiation/domain/negotiation.stance.contracts.js";
import type { StanceCase, StanceRunResult, NegotiationVerdict } from "./stance.types.js";

/** Actions that end a negotiation, across both v2 seats. */
const TERMINAL_ACTIONS = new Set(["accept", "decline", "reject", "withdraw"]);

/** Terminal actions that end it WITHOUT a connection. */
const DECLINE_ACTIONS = new Set(["decline", "reject", "withdraw"]);

/** Ambient default in `negotiation.graph.ts` for autonomous negotiations. */
export const DEFAULT_MAX_TURNS = 6;

export function verdictFor(terminalAction: string | null): NegotiationVerdict {
  if (terminalAction === "accept") return "accepted";
  if (terminalAction !== null && DECLINE_ACTIONS.has(terminalAction)) return "declined";
  return "stalled";
}

export function isTerminal(action: string): boolean {
  return TERMINAL_ACTIONS.has(action);
}

/**
 * Play one bilateral v2 negotiation to termination or the turn cap.
 *
 * Deliberately drives `IndexNegotiator` directly rather than the LangGraph
 * factory: the graph adds persistence, screening, dispatch, and timers, none of
 * which the stance touches, and all of which would need stubbing. What the
 * stance changes is the drafting prompt, and the outcome that follows from it —
 * this is the smallest harness that measures exactly that.
 *
 * Two behaviours of the real graph are mirrored on purpose:
 * - seats alternate, initiator first, capped at `maxTurns` with the last turn
 *   flagged `isFinalTurn`;
 * - a turn-0 `withdraw` STANDS. Before the IND-611 prerequisite the graph
 *   rewrote it to `outreach`, so this outcome was unreachable; the harness
 *   records it as `refusedAtTurnZero` and scores it as a decline.
 *
 * The stance is read from `process.env.NEGOTIATOR_STANCE` inside the agent, so
 * the caller sets it around the run — the same way it resolves in production.
 */
export async function runNegotiation(
  c: StanceCase,
  stance: NegotiatorStance,
  run: number,
  maxTurns: number = DEFAULT_MAX_TURNS,
  agent: Pick<IndexNegotiator, "invoke"> = new IndexNegotiator({ turnTimeoutMs: 60_000 }),
): Promise<StanceRunResult> {
  const history: NegotiationTurn[] = [];
  let terminalAction: string | null = null;
  let refusedAtTurnZero = false;

  try {
    for (let i = 0; i < maxTurns; i++) {
      const isSource = i % 2 === 0;
      const turn = await agent.invoke({
        ownUser: isSource ? c.source : c.candidate,
        otherUser: isSource ? c.candidate : c.source,
        indexContext: { networkId: "eval-net", prompt: c.networkPrompt },
        seedAssessment: c.seedAssessment,
        history: [...history],
        isFinalTurn: i === maxTurns - 1,
        isDiscoverer: isSource,
        seat: isSource ? "initiator" : "counterparty",
        protocolVersion: "v2",
        ...(isSource && c.discoveryQuery ? { discoveryQuery: c.discoveryQuery } : {}),
      });

      history.push(turn);

      if (i === 0 && turn.action === "withdraw") refusedAtTurnZero = true;
      if (isTerminal(turn.action)) {
        terminalAction = turn.action;
        break;
      }
    }
  } catch (error: unknown) {
    return {
      caseId: c.id,
      value: c.value,
      stance,
      run,
      verdict: "stalled",
      terminalAction: null,
      turns: history,
      refusedAtTurnZero,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    caseId: c.id,
    value: c.value,
    stance,
    run,
    verdict: verdictFor(terminalAction),
    terminalAction,
    turns: history,
    refusedAtTurnZero,
  };
}
