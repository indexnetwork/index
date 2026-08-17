import { describe, expect, it } from "bun:test";

import { SignalIntakePackGenerator, type IntakePack } from "../intake/intake.pack.generator.js";

function stubModel(pack: IntakePack, capture?: { prompt?: string }) {
  return {
    invoke: async (messages: Array<{ content: unknown }>) => {
      if (capture) capture.prompt = String(messages[messages.length - 1]?.content ?? "");
      return pack;
    },
  } as never;
}

const validPack: IntakePack = {
  brief: "Ada builds developer tools and is looking for design partners.",
  question: {
    title: "Question 1",
    prompt: "Who do you want to meet right now?",
    options: [
      { label: "A design partner", description: "Someone to test your tooling" },
      { label: "A technical co-founder", description: "Someone to build with" },
      { label: "An early customer", description: "Someone with the problem you solve" },
    ],
    multiSelect: false,
  },
};

describe("SignalIntakePackGenerator", () => {
  it("returns the generated brief and question", async () => {
    const generator = new SignalIntakePackGenerator(stubModel(validPack));

    const result = await generator.generate({
      premises: [{ text: "Ada builds developer tools." }],
      networkTitles: ["Builders"],
      globalContext: "Ada is a developer-tools founder.",
    });

    expect(result.brief).toBe(validPack.brief);
    expect(result.question.prompt).toBe("Who do you want to meet right now?");
    expect(result.question.options).toHaveLength(3);
  });

  it("grounds the prompt in premises, networks, and global context", async () => {
    const capture: { prompt?: string } = {};
    const generator = new SignalIntakePackGenerator(stubModel(validPack, capture));

    await generator.generate({
      premises: [{ text: "Ada builds developer tools." }],
      networkTitles: ["Builders"],
      globalContext: "Ada is a developer-tools founder.",
    });

    expect(capture.prompt).toContain("Ada builds developer tools.");
    expect(capture.prompt).toContain("Builders");
    expect(capture.prompt).toContain("Ada is a developer-tools founder.");
  });

  it("clamps to at most 4 options and forces a non-empty title", async () => {
    const noisy: IntakePack = {
      brief: "b",
      question: {
        title: "",
        prompt: "Who?",
        options: [
          { label: "a", description: "1" },
          { label: "b", description: "2" },
          { label: "c", description: "3" },
          { label: "d", description: "4" },
          { label: "e", description: "5" },
        ],
        multiSelect: false,
      },
    };
    const generator = new SignalIntakePackGenerator(stubModel(noisy));

    const result = await generator.generate({ premises: [{ text: "x" }], networkTitles: [], globalContext: null });

    expect(result.question.options).toHaveLength(4);
    expect(result.question.title).toBe("Question 1");
  });

  it("rejects a pack with fewer than two options", async () => {
    const thin: IntakePack = {
      brief: "b",
      question: { title: "t", prompt: "Who?", options: [{ label: "only", description: "d" }], multiSelect: false },
    };
    const generator = new SignalIntakePackGenerator(stubModel(thin));

    await expect(
      generator.generate({ premises: [{ text: "x" }], networkTitles: [], globalContext: null }),
    ).rejects.toThrow("at least 2 options");
  });
});
