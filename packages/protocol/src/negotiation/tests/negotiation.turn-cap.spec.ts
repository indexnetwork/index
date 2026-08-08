import { describe, expect, it } from "bun:test";

import { isNegotiationTurnCapReached } from "../../index.js";

describe("isNegotiationTurnCapReached public domain capability", () => {
  it.each([
    ["absent below the legacy default", undefined, 5, false],
    ["absent at the legacy default", undefined, 6, true],
    ["null at the legacy default", null, 6, true],
    ["zero is uncapped", 0, 100, false],
    ["positive below its boundary", 3, 2, false],
    ["positive at its boundary", 3, 3, true],
    ["positive beyond its boundary", 3, 4, true],
  ] as const)("%s", (_label, maxTurns, turnCount, expected) => {
    expect(isNegotiationTurnCapReached(turnCount, maxTurns)).toBe(expected);
  });
});
