import { config } from "dotenv";
config({ path: ".env.test" });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key-for-unit-tests";

import { describe, it, expect, mock } from "bun:test";
import { ChatSummarizer } from "../chat.summarizer.js";
import type { ChatContextDigest } from "../../shared/schemas/chat-context.schema.js";

const sampleDigest: ChatContextDigest = {
  statedFacts: ["Pre-revenue"],
  openQuestions: [],
  rejectionReasons: [],
  surfacedFindings: [],
};

function makeSummarizer(invokeImpl: (input: unknown) => Promise<unknown>) {
  const summarizer = new ChatSummarizer();
  // Replace the internal model with a mock; the production code's `this.model.invoke` call must use this.
  (summarizer as unknown as { model: { invoke: typeof invokeImpl } }).model = { invoke: invokeImpl };
  return summarizer;
}

describe("ChatSummarizer", () => {
  it("returns previousDigest unchanged when no new messages", async () => {
    const invokeMock = mock(async () => sampleDigest);
    const summarizer = makeSummarizer(invokeMock);

    const result = await summarizer.summarize({
      previousDigest: sampleDigest,
      newMessages: [],
    });

    expect(result).toEqual(sampleDigest);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns null when no previousDigest and no new messages", async () => {
    const invokeMock = mock(async () => sampleDigest);
    const summarizer = makeSummarizer(invokeMock);

    const result = await summarizer.summarize({
      previousDigest: null,
      newMessages: [],
    });

    expect(result).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("calls the LLM with new messages and returns parsed digest", async () => {
    const fresh: ChatContextDigest = {
      statedFacts: ["Pre-revenue", "Based in Berlin"],
      openQuestions: [],
      rejectionReasons: [],
      surfacedFindings: [],
    };
    const invokeMock = mock(async () => fresh);
    const summarizer = makeSummarizer(invokeMock);

    const result = await summarizer.summarize({
      previousDigest: null,
      newMessages: [
        { role: "user", content: "I'm pre-revenue and based in Berlin." },
      ],
    });

    expect(result).toEqual(fresh);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the LLM throws", async () => {
    const invokeMock = mock(async () => {
      throw new Error("model timeout");
    });
    const summarizer = makeSummarizer(invokeMock);

    const result = await summarizer.summarize({
      previousDigest: null,
      newMessages: [{ role: "user", content: "hi" }],
    });

    expect(result).toBeNull();
  });

  it("truncates messages to 240 chars before sending to the LLM", async () => {
    let capturedInput: unknown = null;
    const invokeMock = mock(async (input: unknown) => {
      capturedInput = input;
      return sampleDigest;
    });
    const summarizer = makeSummarizer(invokeMock);
    const longContent = "x".repeat(500);

    await summarizer.summarize({
      previousDigest: null,
      newMessages: [{ role: "user", content: longContent }],
    });

    // The captured input is a LangChain message array; the user content should be ≤240 chars.
    expect(JSON.stringify(capturedInput)).not.toContain("x".repeat(500));
    expect(JSON.stringify(capturedInput)).toContain("x".repeat(240));
  });
});
