import type { Agent } from "../src/core/agent.ts";
import type { AgentTurn, Negotiation } from "../src/core/types.ts";

/**
 * Local dev/test harness: stands one agent up on an ephemeral port and
 * points the other at it, so both sides of a negotiation run in a single
 * process.
 *
 * Real usage doesn't look like this — the point of the A2A layer is that
 * the two agents belong to different owners on different machines. This
 * exists for local iteration, and isn't published (see `files` in
 * package.json).
 */
export interface LocalRunOptions {
  maxTurns?: number;
  /** Called as each turn lands, with the name of the party that produced
   * it. Turns arrive in conversation order, both sides included. */
  onTurn?: (speaker: string, turn: AgentTurn) => void;
}

/**
 * Runs `initiator` against `responder` over real HTTP on localhost, and
 * returns the negotiation as the initiator saw it. Both agents make real
 * decisions — build them on scripted negotiators if you want determinism,
 * or on real ones if you want to watch two live models argue.
 */
export async function runLocally(
  initiator: Agent,
  responder: Agent,
  options: LocalRunOptions = {},
): Promise<Negotiation> {
  const server = Bun.serve({ port: 0, fetch: responder.handler() });

  try {
    const negotiation = await initiator.negotiate(server.url.toString(), {
      maxTurns: options.maxTurns,
    });

    for (const turn of negotiation.transcript) {
      const speaker = turn.speaker === "self" ? initiator.identity.name : responder.identity.name;
      options.onTurn?.(speaker, turn);
    }

    return negotiation;
  } finally {
    server.stop(true);
  }
}
