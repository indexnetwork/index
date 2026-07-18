import { describe, expect, it } from "bun:test";

import { CASES } from "../profile.cases.js";
import { runCase, type GeneratorLike } from "../profile.runner.js";

describe("profile runCase attempt evidence", () => {
  it("forwards AbortSignal and normalizes only successful terminal output", async () => {
    let receivedSignal: AbortSignal | undefined;
    const generator: GeneratorLike = {
      async invoke(_input, options) {
        receivedSignal = options?.signal;
        return {
          output: {
            identity: { name: "Ada", bio: "Engineer", location: "London" },
            narrative: { context: "Builds reliable systems" },
            attributes: { interests: ["research"], skills: ["engineering"] },
          },
        };
      },
    };

    const batch = await runCase(generator, CASES[0], 1, { attemptTimeoutMs: 100 });
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(batch.outputs[0]).toMatchObject({ name: "Ada", piiHits: [] });
    expect(batch.runs[0]).toMatchObject({ outcome: "success", recovered: false });
  });
});
