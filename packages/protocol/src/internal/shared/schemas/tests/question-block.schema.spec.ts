/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";

import { QuestionBlockSchema, parseQuestionMessage, serializeQuestionMessage } from "../../../../protocol/question-block.schema.js";
import { questionBlockFixture, questionMessageFixture, questionProseFixture } from "../../../../protocol/question-block.fixture.js";

const REF_A = "0b0e8a9c-6d3f-4d6a-9f2e-1c5b7a4d8e01";
const REF_B = "7f3d2c1b-8a90-4e5f-b6c7-d8e9f0a1b2c3";

const minimalBlock = {
  version: 1 as const,
  questions: [{ prompt: "What equity range works for you?", opportunityId: REF_A }],
};

describe("QuestionBlockSchema", () => {
  it("accepts a minimal block and the fixture block", () => {
    expect(QuestionBlockSchema.safeParse(minimalBlock).success).toBe(true);
    expect(QuestionBlockSchema.safeParse(questionBlockFixture).success).toBe(true);
  });

  it("rejects unknown fields at both levels (strict)", () => {
    expect(QuestionBlockSchema.safeParse({ ...minimalBlock, answered: [] }).success).toBe(false);
    expect(QuestionBlockSchema.safeParse({
      version: 1,
      questions: [{ ...minimalBlock.questions[0], id: "q1" }],
    }).success).toBe(false);
  });

  it("rejects an unknown version", () => {
    expect(QuestionBlockSchema.safeParse({ ...minimalBlock, version: 2 }).success).toBe(false);
  });

  it("rejects an empty questions array", () => {
    expect(QuestionBlockSchema.safeParse({ version: 1, questions: [] }).success).toBe(false);
  });

  it("rejects refs that are not opportunity uuids", () => {
    expect(QuestionBlockSchema.safeParse({
      version: 1,
      questions: [{ prompt: "x", opportunityId: "" }],
    }).success).toBe(false);
    expect(QuestionBlockSchema.safeParse({
      version: 1,
      questions: [{ prompt: "x", opportunityId: "not-a-row-anywhere" }],
    }).success).toBe(false);
  });

  it("rejects a ref appearing twice anywhere in the block", () => {
    // Twice as primary.
    expect(QuestionBlockSchema.safeParse({
      version: 1,
      questions: [
        { prompt: "a", opportunityId: REF_A },
        { prompt: "b", opportunityId: REF_A },
      ],
    }).success).toBe(false);
    // Primary of one question inside another's alsoUnblocks.
    expect(QuestionBlockSchema.safeParse({
      version: 1,
      questions: [
        { prompt: "a", opportunityId: REF_A, alsoUnblocks: [REF_B] },
        { prompt: "b", opportunityId: REF_B },
      ],
    }).success).toBe(false);
    // Primary repeated in its own alsoUnblocks.
    expect(QuestionBlockSchema.safeParse({
      version: 1,
      questions: [{ prompt: "a", opportunityId: REF_A, alsoUnblocks: [REF_A] }],
    }).success).toBe(false);
  });
});

describe("checklist dimension label (checklist plan §4)", () => {
  it("accepts a question that names the dimension it parked on", () => {
    const parsed = QuestionBlockSchema.safeParse({
      version: 1,
      questions: [{ ...minimalBlock.questions[0], dimension: "Ticket size" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("still accepts blocks authored before the field existed", () => {
    // The whole point of the field being optional: a message serialized by an
    // earlier build must keep parsing, or the fail-closed parser would drop
    // every in-flight question-message the day this shipped.
    expect(QuestionBlockSchema.safeParse(minimalBlock).success).toBe(true);
    expect(parseQuestionMessage(serializeQuestionMessage("Prose.", minimalBlock))).not.toBeNull();
  });

  it("survives the round trip with the label intact", () => {
    const labeled = {
      version: 1 as const,
      questions: [{ prompt: "Is remote in scope?", opportunityId: REF_A, dimension: "Location", alsoUnblocks: [REF_B] }],
    };
    const parsed = parseQuestionMessage(serializeQuestionMessage("Prose.", labeled));
    expect(parsed!.block.questions[0].dimension).toBe("Location");
  });

  it("rejects an empty label rather than rendering a blank step", () => {
    expect(QuestionBlockSchema.safeParse({
      version: 1,
      questions: [{ ...minimalBlock.questions[0], dimension: "" }],
    }).success).toBe(false);
  });
});

describe("serialize → parse round trip", () => {
  it("is lossless for prose and block", () => {
    const prose = "Two negotiations are waiting on you.\n\nDetails below.";
    const message = serializeQuestionMessage(prose, minimalBlock);
    const parsed = parseQuestionMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed!.prose).toBe(prose);
    expect(parsed!.block).toEqual(minimalBlock);
    // Re-serializing the parse result reproduces the message byte-for-byte.
    expect(serializeQuestionMessage(parsed!.prose, parsed!.block)).toBe(message);
  });

  it("survives prose that mentions the marker or contains fences", () => {
    const prose = "Earlier I sent a block like:\n\n```index-questions\nnot the real one\n```\n\nHere is the update.";
    const message = serializeQuestionMessage(prose, minimalBlock);
    const parsed = parseQuestionMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed!.prose).toBe(prose);
    expect(parsed!.block).toEqual(minimalBlock);
  });

  it("escalates the fence past backtick runs in prompts", () => {
    const block = {
      version: 1 as const,
      questions: [{ prompt: "Should I share the ```internal``` repo name?", opportunityId: REF_A }],
    };
    const message = serializeQuestionMessage("Prose.", block);
    const parsed = parseQuestionMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed!.block).toEqual(block);
  });

  it("serializes a proseless body as the block alone", () => {
    const message = serializeQuestionMessage("", minimalBlock);
    const parsed = parseQuestionMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed!.prose).toBe("");
    expect(parsed!.block).toEqual(minimalBlock);
  });

  it("throws on serializing a block the schema rejects", () => {
    expect(() => serializeQuestionMessage("Prose.", {
      version: 1,
      questions: [],
    } as never)).toThrow();
  });
});

describe("parseQuestionMessage fails closed", () => {
  const validMessage = serializeQuestionMessage("Prose.", minimalBlock);

  it("returns null for a plain message with no block", () => {
    expect(parseQuestionMessage("Just catching up — no questions today.")).toBeNull();
  });

  it("returns null for a truncated block (no closing fence)", () => {
    const truncated = validMessage.slice(0, validMessage.length - 10);
    expect(parseQuestionMessage(truncated)).toBeNull();
  });

  it("returns null for a fence cut off right after the marker line", () => {
    expect(parseQuestionMessage("Prose.\n\n```index-questions")).toBeNull();
    expect(parseQuestionMessage("Prose.\n\n```index-questions\n")).toBeNull();
  });

  it("returns null for malformed JSON inside the fence", () => {
    expect(parseQuestionMessage("Prose.\n\n```index-questions\n{ not json\n```")).toBeNull();
  });

  it("returns null for valid JSON that is not a valid block", () => {
    expect(parseQuestionMessage("Prose.\n\n```index-questions\n[]\n```")).toBeNull();
    expect(parseQuestionMessage("Prose.\n\n```index-questions\n{ \"version\": 1, \"questions\": [] }\n```")).toBeNull();
    // Unknown field smuggled into an otherwise valid block.
    const withUnknown = JSON.stringify({ ...minimalBlock, sneaky: true });
    expect(parseQuestionMessage(`Prose.\n\n\`\`\`index-questions\n${withUnknown}\n\`\`\``)).toBeNull();
    // Ref that cannot point at an opportunity row.
    const badRef = JSON.stringify({ version: 1, questions: [{ prompt: "x", opportunityId: "ref-to-nothing" }] });
    expect(parseQuestionMessage(`Prose.\n\n\`\`\`index-questions\n${badRef}\n\`\`\``)).toBeNull();
  });

  it("returns null for a block that parses but violates ref uniqueness", () => {
    // Must render as plain text, never partially render the steps UI.
    const duplicated = JSON.stringify({
      version: 1,
      questions: [
        { prompt: "a", opportunityId: REF_A },
        { prompt: "b", opportunityId: REF_A },
      ],
    });
    expect(parseQuestionMessage(`Prose.\n\n\`\`\`index-questions\n${duplicated}\n\`\`\``)).toBeNull();
  });

  it("returns null when the block is not the terminal section", () => {
    expect(parseQuestionMessage(`${validMessage}\n\nP.S. one more thing.`)).toBeNull();
  });

  it("tolerates trailing whitespace after the closing fence", () => {
    expect(parseQuestionMessage(`${validMessage}\n  \n`)).not.toBeNull();
  });
});

describe("fixture message", () => {
  it("parses into the fixture prose and block", () => {
    const parsed = parseQuestionMessage(questionMessageFixture);
    expect(parsed).not.toBeNull();
    expect(parsed!.prose).toBe(questionProseFixture);
    expect(parsed!.block).toEqual(questionBlockFixture);
  });

  it("is exactly what the serializer emits, byte-for-byte", () => {
    expect(serializeQuestionMessage(questionProseFixture, questionBlockFixture)).toBe(questionMessageFixture);
  });
});
