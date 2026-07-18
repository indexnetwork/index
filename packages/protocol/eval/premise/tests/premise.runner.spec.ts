import { describe, expect, it } from "bun:test";

import { CASES } from "../premise.cases.js";
import { runCase, type PremiseDeps } from "../premise.runner.js";

const decomposeCase = CASES.find((entry) => entry.component === "decompose");
if (!decomposeCase) throw new Error("premise corpus needs a decompose case");

describe("premise runCase attempt evidence", () => {
  it("forwards AbortSignal to the selected premise agent", async () => {
    let receivedSignal: AbortSignal | undefined;
    const deps: PremiseDeps = {
      decomposer: {
        async invoke(_input, _existing, _bio, options) {
          receivedSignal = options?.signal;
          return {
            reasoning: "fixture",
            premises: [{ text: "I build systems", tier: "assertive", validityDays: null }],
            retractedPremiseIds: [],
            revisedBio: null,
          };
        },
      },
      analyzer: {
        async invoke() {
          throw new Error("wrong agent");
        },
      },
    };

    const batch = await runCase(deps, decomposeCase, 1, { attemptTimeoutMs: 100 });
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(batch.outputs[0]).toMatchObject({ component: "decompose", reasoning: "fixture" });
    expect(batch.runs[0].attempts[0].outcome).toBe("success");
  });
});
