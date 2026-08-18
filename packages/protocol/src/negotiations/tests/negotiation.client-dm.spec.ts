import { describe, it, expect } from "bun:test";

import { retrieveClientDm, type NegotiationGraphDeps } from "../negotiation.graph.shared.js";
import type { NegotiatorClientDmMessage, NegotiatorClientDmQuery, NegotiatorClientDmRetrieveFn } from "../negotiation.client-dm.js";

/**
 * A2H client-DM read seam — the graph-side guard.
 *
 * The port itself is types only; what is behavioral here is the wrapper's
 * promise that a missing, failing, or absent DM never reaches a node as
 * anything but `[]`. The negotiation runs unchanged in all three cases, which
 * is the whole reason this is a guarded seam rather than a direct call.
 *
 * Also pins the shape of the query: (userId, intentId) with no counterparty
 * field, so the counterparty's DM is unreachable by construction rather than
 * by a check that could be forgotten.
 */

/** Only `clientDmRetrieve` is read by the wrapper; the rest never loads. */
function depsWith(clientDmRetrieve?: NegotiatorClientDmRetrieveFn): NegotiationGraphDeps {
  return { clientDmRetrieve } as unknown as NegotiationGraphDeps;
}

const excerpt: NegotiatorClientDmMessage[] = [
  { role: "client", content: "I already told you: no equity-only deals." },
  { role: "agent", content: "Understood — cash or nothing on this signal." },
];

describe("retrieveClientDm", () => {
  it("returns [] when no dep is injected", async () => {
    expect(await retrieveClientDm(depsWith(undefined), "user-1", "intent-1")).toEqual([]);
  });

  it("returns [] when the retrieval function throws", async () => {
    const deps = depsWith(async () => { throw new Error("db down"); });
    expect(await retrieveClientDm(deps, "user-1", "intent-1")).toEqual([]);
  });

  it("returns [] when the retrieval function rejects with a non-Error", async () => {
    const deps = depsWith(async () => { throw "socket hangup"; });
    expect(await retrieveClientDm(deps, "user-1", "intent-1")).toEqual([]);
  });

  it("passes [] through unchanged when the user has no DM for this signal", async () => {
    expect(await retrieveClientDm(depsWith(async () => []), "user-1", "intent-1")).toEqual([]);
  });

  it("passes a real excerpt through in the order the adapter returned it", async () => {
    const got = await retrieveClientDm(depsWith(async () => excerpt), "user-1", "intent-1");
    expect(got).toEqual(excerpt);
    // Most recent last: the wrapper must not re-sort or reverse.
    expect(got[got.length - 1].content).toBe("Understood — cash or nothing on this signal.");
  });

  it("asks only for the acting user's own DM, scoped to this signal", async () => {
    const seen: NegotiatorClientDmQuery[] = [];
    const deps = depsWith(async (query) => { seen.push(query); return excerpt; });
    await retrieveClientDm(deps, "acting-user", "signal-42");
    expect(seen).toEqual([{ userId: "acting-user", intentId: "signal-42" }]);
    // No counterparty field exists to be filled in, correctly or otherwise.
    expect(Object.keys(seen[0]).sort()).toEqual(["intentId", "userId"]);
  });
});
