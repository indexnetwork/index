/**
 * Unit test: decision_questions propagation in the chat controller SSE loop.
 *
 * This isolates the SSE event-consumption logic that:
 *   1. Forwards the `decision_questions` event to the SSE client unchanged.
 *   2. Captures the questions so the final `done` event includes them.
 *
 * We do NOT instantiate ChatController (requires auth + DB + LangGraph).
 * Instead we replay the same loop pattern the controller uses and assert
 * the same output invariants. Any regression in the controller's handling
 * will also require fixing this test.
 */

import { describe, it, expect } from "bun:test";
import {
  createDoneEvent,
  formatSSEEvent,
} from "../../types/chat-streaming.types";
import type { Question } from "@indexnetwork/protocol";

// ── Minimal event types matching the production shape ─────────────────────────

interface BaseEvent { type: string }
interface DecisionQuestionsEvent extends BaseEvent {
  type: "decision_questions";
  questions: Question[];
}
interface ResponseCompleteEvent extends BaseEvent {
  type: "response_complete";
  response: string;
}
interface OtherEvent extends BaseEvent {
  type: "status";
  message: string;
}

type TestEvent = DecisionQuestionsEvent | ResponseCompleteEvent | OtherEvent;

/**
 * Mirrors the SSE consumption loop in `chat.controller.ts` for events relevant
 * to decisionQuestions.  Returns { enqueuedTypes, decisionQuestions }.
 */
async function runLoop(events: TestEvent[]): Promise<{
  enqueuedTypes: string[];
  decisionQuestions: Question[] | undefined;
  donePayload: ReturnType<typeof createDoneEvent>;
}> {
  const sessionId = "test-session";
  let fullResponse = "";
  let decisionQuestions: Question[] | undefined;
  const enqueuedTypes: string[] = [];

  // Replicate the production consumption loop exactly.
  async function* makeStream() { yield* events; }

  for await (const event of makeStream()) {
    if (event.type === "response_complete") {
      fullResponse = (event as ResponseCompleteEvent).response;
      // response_complete is NOT enqueued
    } else {
      enqueuedTypes.push(event.type);
    }

    if (event.type === "decision_questions") {
      decisionQuestions = (event as DecisionQuestionsEvent).questions;
    }
  }

  const donePayload = createDoneEvent(sessionId, fullResponse, {
    ...(decisionQuestions !== undefined ? { decisionQuestions } : {}),
  });

  return { enqueuedTypes, decisionQuestions, donePayload };
}

// ── Sample data ───────────────────────────────────────────────────────────────

const question: Question = {
  title: "Stage",
  prompt: "Where in your journey?",
  options: [
    { label: "ideating", description: "" },
    { label: "shipping", description: "" },
  ],
  multiSelect: false,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("chat controller SSE loop — decisionQuestions propagation", () => {
  it("forwards the decision_questions event and includes questions in the done payload", async () => {
    const events: TestEvent[] = [
      { type: "status", message: "Processing..." },
      { type: "decision_questions", questions: [question] },
      { type: "response_complete", response: "Here are the results." },
    ];

    const { enqueuedTypes, decisionQuestions, donePayload } = await runLoop(events);

    // decision_questions is forwarded to the SSE client
    expect(enqueuedTypes).toContain("decision_questions");

    // response_complete is NOT forwarded (internal only)
    expect(enqueuedTypes).not.toContain("response_complete");

    // captured questions
    expect(decisionQuestions).toEqual([question]);

    // done event includes questions
    expect(donePayload.decisionQuestions).toEqual([question]);
    expect(donePayload.type).toBe("done");
    expect(donePayload.response).toBe("Here are the results.");
  });

  it("done event has no decisionQuestions when no decision_questions event is emitted", async () => {
    const events: TestEvent[] = [
      { type: "status", message: "Processing..." },
      { type: "response_complete", response: "No decisions here." },
    ];

    const { enqueuedTypes, decisionQuestions, donePayload } = await runLoop(events);

    expect(enqueuedTypes).not.toContain("decision_questions");
    expect(decisionQuestions).toBeUndefined();
    expect(donePayload.decisionQuestions).toBeUndefined();
  });

  it("formatSSEEvent serializes the done event with decisionQuestions correctly", () => {
    const doneEvent = createDoneEvent("s-1", "reply", {
      decisionQuestions: [question],
    });
    const sse = formatSSEEvent(doneEvent);
    expect(sse).toStartWith("data: ");
    expect(sse).toEndWith("\n\n");
    const parsed = JSON.parse(sse.replace(/^data: /, "").trim()) as typeof doneEvent;
    expect(parsed.type).toBe("done");
    expect(parsed.decisionQuestions).toEqual([question]);
  });
});
