/**
 * Question-message rendering against the question block contract
 * (docs/plans/2026-08-18-conversational-questions.md).
 *
 * The canonical message comes from the protocol fixture subpath — these tests
 * must not mint their own wire format. Contract under test: a body ending in a
 * valid ```index-questions block renders as prose + steps (negotiation refs
 * never displayed); any malformed variant fails closed and the ENTIRE body
 * renders through the normal plain-text path; a body with no block is
 * untouched.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { questionBlockFixture, questionMessageFixture } from "@indexnetwork/protocol";

import AssistantMessageContent from "@/components/chat/AssistantMessageContent";
import { QuestionRegenerationIndicator, QuestionSteps } from "@/components/chat/QuestionSteps";

const [firstQuestion, secondQuestion] = questionBlockFixture.questions;

function renderMessage(content: string, onQuestionQuote?: (prompt: string) => void) {
  return render(
    <MemoryRouter>
      <AssistantMessageContent
        content={content}
        isStreaming={false}
        {...(onQuestionQuote ? { onQuestionQuote } : {})}
      />
    </MemoryRouter>,
  );
}

describe("question-message rendering", () => {
  it("renders the fixture as prose plus one step per question", () => {
    const { container } = renderMessage(questionMessageFixture);

    expect(screen.getByTestId("question-steps")).toBeInTheDocument();
    expect(screen.getAllByTestId("question-step")).toHaveLength(
      questionBlockFixture.questions.length,
    );
    expect(screen.getByText(firstQuestion.prompt)).toBeInTheDocument();
    expect(screen.getByText(secondQuestion.prompt)).toBeInTheDocument();
    // The prose renders as a normal message above the steps.
    expect(container.textContent).toContain(
      "I moved three conversations forward on your search for a technical co-founder.",
    );
    expect(container.textContent?.indexOf("I moved three conversations")).toBeLessThan(
      container.textContent?.indexOf(firstQuestion.prompt) ?? -1,
    );
  });

  it("never displays the negotiation refs — they are routing data", () => {
    const { container } = renderMessage(questionMessageFixture);

    const text = container.textContent ?? "";
    expect(text).not.toContain(firstQuestion.opportunityId);
    expect(text).not.toContain(firstQuestion.alsoUnblocks?.[0]);
    expect(text).not.toContain(secondQuestion.opportunityId);
    expect(text).not.toContain("opportunityId");
  });

  it("offers no submit path — answering is a plain chat reply", () => {
    renderMessage(questionMessageFixture);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  describe("fails closed to plain text", () => {
    const malformedVariants: Array<[name: string, body: string]> = [
      [
        "broken JSON in the block",
        questionMessageFixture.replace('"version": 1,', '"version": 1,,'),
      ],
      [
        "unknown block version",
        questionMessageFixture.replace('"version": 1', '"version": 2'),
      ],
      [
        "duplicate negotiation ref across questions",
        questionMessageFixture.replace(
          secondQuestion.opportunityId,
          firstQuestion.opportunityId,
        ),
      ],
      [
        "text after the closing fence — the block must terminate the message",
        `${questionMessageFixture}\n\nOne more thing.`,
      ],
      [
        "unterminated fence",
        questionMessageFixture.replace(/\n`{3,}\s*$/, ""),
      ],
    ];

    it.each(malformedVariants)("%s renders the whole body as today", (_name, body) => {
      const { container } = renderMessage(body);

      // No steps, not even for the questions a partial parse could recover.
      expect(screen.queryByTestId("question-steps")).toBeNull();
      // The entire body, raw block payload included, goes through the normal
      // rendering path — the refs are visible as code-block text.
      expect(container.textContent).toContain(firstQuestion.opportunityId);
      expect(container.textContent).toContain(
        "I moved three conversations forward on your search for a technical co-founder.",
      );
    });
  });

  it("leaves a message without a block untouched", () => {
    const { container } = renderMessage("Just a **normal** update, no questions.");

    expect(screen.queryByTestId("question-steps")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("normal");
    expect(container.textContent).toContain("Just a normal update, no questions.");
  });
});

describe("QuestionSteps quote affordance", () => {
  it("passes the tapped question's prompt to onQuote", () => {
    const onQuote = vi.fn();
    render(<QuestionSteps block={questionBlockFixture} onQuote={onQuote} />);

    fireEvent.click(screen.getByRole("button", { name: "Answer question 2" }));
    expect(onQuote).toHaveBeenCalledWith(secondQuestion.prompt);
  });

  it("renders no buttons without an onQuote handler", () => {
    render(<QuestionSteps block={questionBlockFixture} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("QuestionRegenerationIndicator", () => {
  it("announces that the agent is updating its questions", () => {
    render(<QuestionRegenerationIndicator />);
    const indicator = screen.getByTestId("question-regeneration-indicator");
    expect(indicator.getAttribute("aria-label")).toBe("Your agent is updating its questions");
  });
});

describe("QuestionSteps options", () => {
  const blockWith = (options?: Array<{ label: string; description: string }>) => ({
    version: 1 as const,
    questions: [{
      prompt: "Are you a founder of a pre-seed game studio, or representing one?",
      opportunityId: "0b0e8a9c-6d3f-4d6a-9f2e-1c5b7a4d8e01",
      ...(options ? { options } : {}),
    }],
  });

  it("renders the agent's decision options as choices", () => {
    // The negotiator authors 2–4 options with the consequence of each, and the
    // parked reader carries them — but the block had no field for them, so
    // every question arrived as prose with a reply arrow and nothing to pick.
    const quoted: string[] = [];
    render(<QuestionSteps block={blockWith([
      { label: "I am the founder", description: "I will tell them you are raising for your own studio." },
      { label: "I represent a studio", description: "I will position you as representing the team." },
    ])} onQuote={(text) => quoted.push(text)} />);

    const options = screen.getByTestId("question-step-options");
    expect(options).toBeTruthy();
    fireEvent.click(screen.getByText("I am the founder"));
    // Choosing quotes into the input rather than submitting: answering stays a
    // plain chat reply, so options and free text remain one lane.
    expect(quoted).toEqual(["I am the founder"]);
  });

  it("renders prose only when the park had no authored options", () => {
    render(<QuestionSteps block={blockWith()} onQuote={() => {}} />);
    expect(screen.queryByTestId("question-step-options")).toBeNull();
    expect(screen.getByText(/Are you a founder/)).toBeTruthy();
  });
});
