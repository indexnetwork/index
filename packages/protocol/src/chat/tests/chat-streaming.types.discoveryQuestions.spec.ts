import { describe, it, expect } from "bun:test";
import {
  createChatSummarizerStartEvent,
  createChatSummarizerEndEvent,
  createQuestionGeneratorStartEvent,
  createQuestionGeneratorEndEvent,
  createDecisionQuestionsEvent,
  createDebugMetaEvent,
  type DebugMetaDiscoveryQuestions,
  type DebugMetaLlm,
} from "../chat-streaming.types.js";
import type { Question, QuestionStrategy } from "../../shared/schemas/question.schema.js";

const question: Question = {
  title: "Stage",
  prompt: "Where in your journey?",
  options: [
    { label: "ideating", description: "early" },
    { label: "shipping", description: "live" },
  ],
  multiSelect: false,
};
const strategies: QuestionStrategy[] = ["refine_intent"];

describe("decision-question stream types", () => {
  it("creates chat_summarizer_start / end events with the expected shape", () => {
    const start = createChatSummarizerStartEvent("s-1", { sessionId: "c-1" });
    expect(start.type).toBe("chat_summarizer_start");
    expect(start.sessionId).toBe("s-1");
    expect(start.payload).toEqual({ sessionId: "c-1" });
    const end = createChatSummarizerEndEvent("s-1", { durationMs: 12 });
    expect(end.type).toBe("chat_summarizer_end");
    expect(end.payload.durationMs).toBe(12);
  });

  it("creates question_generator_start / end events with the expected shape", () => {
    const start = createQuestionGeneratorStartEvent("s-1", { inputMode: "transcripts", negotiationCount: 3, hasChatContext: true });
    expect(start.type).toBe("question_generator_start");
    expect(start.payload.inputMode).toBe("transcripts");
    const end = createQuestionGeneratorEndEvent("s-1", { finalCount: 2, strategies, durationMs: 250, inputMode: "transcripts" });
    expect(end.type).toBe("question_generator_end");
    expect(end.payload.finalCount).toBe(2);
  });

  it("creates a decision_questions event carrying the questions array", () => {
    const ev = createDecisionQuestionsEvent("s-1", { questions: [question] });
    expect(ev.type).toBe("decision_questions");
    expect(ev.questions).toEqual([question]);
  });

  it("createDebugMetaEvent accepts an optional discoveryQuestions slot", () => {
    const llm: DebugMetaLlm = { calls: 0, totalDurationMs: 0, resets: [], hallucinations: [] };
    const dq: DebugMetaDiscoveryQuestions = {
      inputMode: "transcripts",
      finalCount: 1,
      strategies,
      durationMs: 100,
    };
    const ev = createDebugMetaEvent("s-1", "agent_loop", 1, [], llm, undefined, dq);
    expect(ev.discoveryQuestions).toEqual(dq);
  });
});
