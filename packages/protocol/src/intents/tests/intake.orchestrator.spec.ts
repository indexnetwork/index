import { describe, expect, it } from "bun:test";

import { toJsonSchema } from "@langchain/core/utils/json_schema";

import { answerLabel, FALLBACK_BRING_QUESTION, FALLBACK_WHO_QUESTION, followUpPlanSchema, SignalIntakeOrchestrator } from "../intake/intake.orchestrator.js";

interface Capture {
  prompt?: string;
  messages?: string[];
}

function stub<T>(value: T, capture?: Capture) {
  return {
    invoke: async (messages: Array<{ content: unknown }>) => {
      if (capture) {
        capture.prompt = String(messages[messages.length - 1]?.content ?? "");
        capture.messages = messages.map((message) => String(message.content ?? ""));
      }
      return value;
    },
  } as never;
}

function plannerModels<T>(plan: T, capture?: Capture) {
  return { planner: stub(plan, capture) };
}

const question = {
  missingAxis: "exchange" as const,
  title: "Question 2",
  prompt: "What would you bring to that connection?",
  answerGroundedOptions: [
    { label: "Distribution", description: "You have an audience" },
    { label: "Engineering depth", description: "You can build it" },
  ],
  profileBridgeOption: null,
  multiSelect: false,
};

describe("answerLabel", () => {
  it("joins selected options and free text", () => {
    expect(answerLabel({ selectedOptions: ["A", "B"], freeText: "and C" })).toBe("A, B, and C");
  });

  it("ignores empty free text", () => {
    expect(answerLabel({ selectedOptions: ["A"], freeText: "   " })).toBe("A");
  });
});

describe("SignalIntakeOrchestrator.generateFollowUps", () => {
  it("assembles answer-grounded options before one optional profile bridge", async () => {
    const orchestrator = new SignalIntakeOrchestrator(plannerModels({
      questions: [{
        missingAxis: "purpose",
        title: "Purpose",
        prompt: "What would make meeting scuba divers valuable to you?",
        answerGroundedOptions: [
          { label: "Find dive buddies", description: "Meet people to dive with" },
          { label: "Learn from experts", description: "Meet experienced divers" },
          { label: "Marine conservation", description: "Work on ocean stewardship" },
        ],
        profileBridgeOption: {
          label: "Underwater technology",
          description: "Connect diving with your technology background",
        },
        multiSelect: false,
      }],
      plannedFollowUpCount: 1,
    }));

    const result = await orchestrator.generateFollowUps({
      brief: "The user builds AI products.",
      rounds: [{ prompt: "Who do you want to meet?", answer: { selectedOptions: [], freeText: "scuba divers" } }],
      maxFollowUps: 1,
    });

    expect(result.questions[0]?.options.map((option) => option.label)).toEqual([
      "Find dive buddies",
      "Learn from experts",
      "Marine conservation",
      "Underwater technology",
    ]);
  });

  const plan = {
    questions: [question, { ...question, prompt: "Where should we look?" }],
    plannedFollowUpCount: 2,
  };

  it("sends the brief in a bridge-only slot and keeps both prompts' constraints", async () => {
    const capture: Capture = {};
    const orchestrator = new SignalIntakeOrchestrator(plannerModels(plan, capture));

    const result = await orchestrator.generateFollowUps({
      brief: "Ada builds developer tools.",
      rounds: [{ prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] } }],
      maxFollowUps: 3,
    });

    expect(result.questions).toHaveLength(2);
    expect(result.plannedFollowUpCount).toBe(2);
    expect(capture.prompt).toContain("A design partner");
    // One call now carries the brief, so the wall is a labelled slot plus a
    // prompt constraint rather than a second model that never saw the rounds.
    expect(capture.prompt).toContain("PROFILE BRIEF (profileBridgeOption only");
    expect(capture.prompt).toContain("Ada builds developer tools.");
    const systemPrompt = capture.messages?.[0] ?? "";
    expect(systemPrompt).toContain("from the answered rounds alone");
    expect(systemPrompt).toContain("Write these options as\nif no profile brief had been supplied");
    expect(systemPrompt).toContain("nothing in the brief may add, remove,");
    expect(systemPrompt).toContain("Generic labels");
    expect(systemPrompt).toContain("Learn diving techniques");
    // The bridge prompt's own thinking survives the merge.
    expect(systemPrompt).toContain("never rewrites, replaces, removes, or reclassifies one");
    expect(systemPrompt).toContain("Never return more than one bridge per question");
    expect(systemPrompt).toContain("scuba\ndivers + pianist should return null");
  });

  it("keeps 2-3 answer-grounded core options on every question, whatever the bridge does", async () => {
    // The two-call split enforced this structurally: the bridge model received
    // the core questions as immutable input. In one call it is a prompt
    // constraint, so the shape is asserted here instead.
    const bridges = [
      null,
      { label: "Underwater technology", description: "A natural bridge" },
      // A bridge that duplicates a core label is dropped, never substituted.
      { label: " find dive buddies ", description: "The same choice again" },
    ];
    for (const profileBridgeOption of bridges) {
      const orchestrator = new SignalIntakeOrchestrator(plannerModels({
        questions: [{
          missingAxis: "purpose",
          title: "Purpose",
          prompt: "What would make meeting scuba divers valuable to you?",
          answerGroundedOptions: [
            { label: "Find dive buddies", description: "Meet people to dive with" },
            { label: "Learn from experts", description: "Meet experienced divers" },
          ],
          profileBridgeOption,
          multiSelect: false,
        }],
        plannedFollowUpCount: 1,
      }));

      const result = await orchestrator.generateFollowUps({
        brief: "The user builds AI products.",
        rounds: [{ prompt: "Who?", answer: { selectedOptions: [], freeText: "scuba divers" } }],
        maxFollowUps: 1,
      });

      const labels = result.questions[0]?.options.map((option) => option.label) ?? [];
      expect(labels.slice(0, 2)).toEqual(["Find dive buddies", "Learn from experts"]);
      expect(labels.length).toBeLessThanOrEqual(3);
      expect(result.questions[0]).not.toEqual(FALLBACK_BRING_QUESTION);
    }
  });

  it("deduplicates options without letting the profile bridge displace two answer-grounded choices", async () => {
    const orchestrator = new SignalIntakeOrchestrator(plannerModels({
      questions: [{
        missingAxis: "desired_attributes",
        title: "Divers",
        prompt: "Which scuba divers would be most useful to meet?",
        answerGroundedOptions: [
          { label: "Dive buddies", description: "People to dive with" },
          { label: " dive buddies ", description: "Duplicate after trimming" },
          { label: "Experienced instructors", description: "People to learn from" },
        ],
        profileBridgeOption: {
          label: "Underwater technologists",
          description: "A natural bridge to the user's background",
        },
        multiSelect: false,
      }],
      plannedFollowUpCount: 1,
    }));

    const result = await orchestrator.generateFollowUps({
      brief: "The user builds technology products.",
      rounds: [{ prompt: "Who?", answer: { selectedOptions: ["Scuba divers"] } }],
      maxFollowUps: 1,
    });

    expect(result.questions[0]?.options.map((option) => option.label)).toEqual([
      "Dive buddies",
      "Experienced instructors",
      "Underwater technologists",
    ]);
  });

  it("falls back when deduplication leaves fewer than two answer-grounded choices", async () => {
    const orchestrator = new SignalIntakeOrchestrator(plannerModels({
      questions: [{
        missingAxis: "purpose",
        title: "Purpose",
        prompt: "What do you want from meeting scuba divers?",
        answerGroundedOptions: [
          { label: "Dive buddies", description: "People to dive with" },
          { label: " dive buddies ", description: "The same choice" },
        ],
        profileBridgeOption: {
          label: "Underwater technology",
          description: "A profile-derived bridge",
        },
        multiSelect: false,
      }],
      plannedFollowUpCount: 1,
    }));

    const result = await orchestrator.generateFollowUps({
      brief: "The user builds technology products.",
      rounds: [{ prompt: "Who?", answer: { selectedOptions: ["Scuba divers"] } }],
      maxFollowUps: 1,
    });

    expect(result).toEqual({
      questions: [FALLBACK_BRING_QUESTION],
      plannedFollowUpCount: 1,
    });
  });

  it("treats a null bridge on every question as an ordinary success, not a failure", async () => {
    let calls = 0;
    const orchestrator = new SignalIntakeOrchestrator({
      planner: {
        invoke: async () => {
          calls += 1;
          return {
            questions: [question, { ...question, prompt: "Where should we look?" }],
            plannedFollowUpCount: 2,
          };
        },
      } as never,
    });

    const result = await orchestrator.generateFollowUps({
      brief: "Ada builds developer tools.",
      rounds: [{ prompt: "Who?", answer: { selectedOptions: ["A design partner"] } }],
      maxFollowUps: 2,
    });

    // Personalization is optional: silence is not an error and buys no retry.
    expect(calls).toBe(1);
    expect(result.questions).toHaveLength(2);
    for (const served of result.questions) {
      expect(served.options.map((option) => option.label)).toEqual(["Distribution", "Engineering depth"]);
    }
  });

  it("omitting the bridge field entirely is as good as returning null", async () => {
    const { profileBridgeOption: _omitted, ...withoutBridge } = question;
    const orchestrator = new SignalIntakeOrchestrator(plannerModels({
      questions: [withoutBridge],
      plannedFollowUpCount: 1,
    }));

    const result = await orchestrator.generateFollowUps({
      brief: "Ada builds developer tools.",
      rounds: [{ prompt: "Who?", answer: { selectedOptions: ["A design partner"] } }],
      maxFollowUps: 1,
    });

    expect(result.questions[0]?.options.map((option) => option.label))
      .toEqual(["Distribution", "Engineering depth"]);
  });

  it("drops a bridge offered when no brief was supplied", async () => {
    const capture: Capture = {};
    const orchestrator = new SignalIntakeOrchestrator(plannerModels({
      questions: [{
        ...question,
        profileBridgeOption: { label: "Invented bridge", description: "From a brief that does not exist" },
      }],
      plannedFollowUpCount: 1,
    }, capture));

    const result = await orchestrator.generateFollowUps({
      brief: "   ",
      rounds: [{ prompt: "Who?", answer: { selectedOptions: ["A design partner"] } }],
      maxFollowUps: 1,
    });

    expect(capture.prompt).toContain("PROFILE BRIEF: none supplied");
    expect(result.questions[0]?.options.map((option) => option.label))
      .toEqual(["Distribution", "Engineering depth"]);
  });

  it("truncates model output to maxFollowUps", async () => {
    const orchestrator = new SignalIntakeOrchestrator(plannerModels(plan));

    const result = await orchestrator.generateFollowUps({
      brief: "b",
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
      maxFollowUps: 1,
    });

    expect(result.questions).toHaveLength(1);
    expect(result.plannedFollowUpCount).toBe(2);
  });

  it("echoes a locked plannedFollowUpCount instead of re-planning", async () => {
    const orchestrator = new SignalIntakeOrchestrator(plannerModels(plan));

    const result = await orchestrator.generateFollowUps({
      brief: "b",
      rounds: [
        { prompt: "p1", answer: { selectedOptions: ["x"] } },
        { prompt: "p2", answer: { selectedOptions: ["y"] } },
      ],
      maxFollowUps: 1,
      plannedFollowUpCount: 3,
    });

    expect(result.plannedFollowUpCount).toBe(3);
  });

  it("falls back to the static question with count 1 when the model fails", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      planner: { invoke: async () => { throw new Error("model down"); } } as never,
    });

    const result = await orchestrator.generateFollowUps({
      brief: "b",
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
      maxFollowUps: 2,
    });

    expect(result).toEqual({ questions: [FALLBACK_BRING_QUESTION], plannedFollowUpCount: 1 });
  });

  it("serves the static fallback when the planner returns zero follow-ups with budget remaining", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      planner: stub({ questions: [], plannedFollowUpCount: 0 }),
    });

    const result = await orchestrator.generateFollowUps({
      brief: "b",
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
      maxFollowUps: 2,
    });

    expect(result).toEqual({ questions: [FALLBACK_BRING_QUESTION], plannedFollowUpCount: 1 });
  });
});

describe("SignalIntakeOrchestrator.synthesize", () => {
  const synthesis = {
    description: "Looking for a design partner to test developer tooling.",
    lookingFor: "A design partner",
    youBring: "Engineering depth",
  };

  it("renders every round into the synthesis prompt", async () => {
    const capture: Capture = {};
    const orchestrator = new SignalIntakeOrchestrator({ synthesis: stub(synthesis, capture) });

    const result = await orchestrator.synthesize({
      rounds: [
        { prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] } },
        { prompt: "What do you bring?", answer: { selectedOptions: ["Engineering depth"] } },
        { prompt: "When?", answer: { selectedOptions: [], freeText: "This quarter" } },
      ],
    });

    expect(result.description).toBe(synthesis.description);
    expect(capture.prompt).toContain("Q: Who do you want to meet?\nA: A design partner");
    expect(capture.prompt).toContain("Q: What do you bring?\nA: Engineering depth");
    expect(capture.prompt).toContain("Q: When?\nA: This quarter");
  });

  it("appends where and feedback lines when present", async () => {
    const capture: Capture = {};
    const orchestrator = new SignalIntakeOrchestrator({ synthesis: stub(synthesis, capture) });

    await orchestrator.synthesize({
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
      whereText: "Berlin",
      feedback: "shorter please",
    });

    expect(capture.prompt).toContain("Where constraint: Berlin");
    expect(capture.prompt).toContain("Revision feedback on the previous draft: shorter please");
  });

  it("propagates synthesis model failure so the caller can mark the run failed", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      synthesis: { invoke: async () => { throw new Error("model down"); } } as never,
    });

    await expect(orchestrator.synthesize({
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
    })).rejects.toThrow("model down");
  });

  it("renders revision feedback in its own slot, never as a where constraint", async () => {
    const capture: Capture = {};
    const orchestrator = new SignalIntakeOrchestrator({ synthesis: stub(synthesis, capture) });

    await orchestrator.synthesize({
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
      feedback: "shorter please",
    });

    expect(capture.prompt).toContain("Revision feedback on the previous draft: shorter please");
    expect(capture.prompt).not.toContain("Where constraint");
  });

  it("sends the interview and nothing else, so no profile fact can reach the prompt", async () => {
    const capture: Capture = {};
    const orchestrator = new SignalIntakeOrchestrator({ synthesis: stub(synthesis, capture) });

    // The pack brief that sourced these questions says the person is an
    // ex-Google staff engineer. They never answered anything of the sort, so
    // synthesis must never see it — there is no input that could carry it.
    await orchestrator.synthesize({
      rounds: [
        { prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] } },
        { prompt: "What do you bring?", answer: { selectedOptions: [], freeText: "I can build the thing" } },
      ],
    });

    const everythingSent = (capture.messages ?? []).join("\n");
    for (const profileFact of ["ex-Google", "Google", "staff engineer", "Brief:"]) {
      expect(everythingSent).not.toContain(profileFact);
    }
    expect(capture.prompt).toContain("INTERVIEW:");
    expect(capture.prompt).toContain("A: A design partner");
    expect(capture.prompt).toContain("A: I can build the thing");
  });

  it("instructs the model to compose the answers rather than weave in background", async () => {
    const capture: Capture = {};
    const orchestrator = new SignalIntakeOrchestrator({ synthesis: stub(synthesis, capture) });

    await orchestrator.synthesize({
      rounds: [{ prompt: "Who?", answer: { selectedOptions: ["A design partner"] } }],
    });

    const systemPrompt = capture.messages?.[0] ?? "";
    expect(systemPrompt).toContain("ONLY the interview");
    expect(systemPrompt).toContain("Tighten the wording; never extend it.");
    expect(systemPrompt).toContain("trace back to something the person answered");
    expect(systemPrompt).not.toContain("brief");
  });
});

describe("static fallbacks", () => {
  it("are renderable questions", () => {
    for (const q of [FALLBACK_WHO_QUESTION, FALLBACK_BRING_QUESTION]) {
      expect(q.prompt.length).toBeGreaterThan(0);
      expect(q.options.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("the follow-up plan schema as the provider receives it", () => {
  it("inlines every option shape instead of emitting a $ref", () => {
    // `withStructuredOutput` converts this schema with the same converter and
    // sends it as `response_format.json_schema`. Reusing one zod instance for
    // two fields makes the converter emit the second as a `$ref` into
    // `definitions`, which Gemini rejects: the call burns its retry and answers
    // from the fallback model instead. Merging the bridge into this schema is
    // exactly the change that could reintroduce that, so it is asserted here.
    const json = JSON.stringify(toJsonSchema(followUpPlanSchema));

    expect(json).not.toContain("$ref");
    expect(json).not.toContain("definitions");
    expect(json).toContain("profileBridgeOption");
  });
});
