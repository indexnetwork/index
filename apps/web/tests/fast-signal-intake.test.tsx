import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";

import NewSignalPage from "@/app/i/new/page";
import { FastSignalIntake } from "@/components/signals/FastSignalIntake";

const mocks = vi.hoisted(() => ({
  fastSignalIntake: true,
  sendWebMessage: vi.fn(),
  start: vi.fn(),
  question: vi.fn(),
  prepare: vi.fn(),
  proposal: vi.fn(),
  revise: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  addNotification: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/contexts/AIChatContext", () => ({
  useAIChat: () => ({
    messages: [], liveQuestions: [], isLoading: false,
    sendWebMessage: mocks.sendWebMessage, clearChat: vi.fn(),
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuthContext: () => ({
    isAuthenticated: true,
    features: { signalAgent: true, fastSignalIntake: mocks.fastSignalIntake },
    signOut: vi.fn(), openLoginModal: vi.fn(),
  }),
}));
vi.mock("@/contexts/IndexesContext", () => ({
  useNetworksState: () => ({
    indexes: [
      { id: "network-1", title: "Builders" },
    ],
  }),
}));
vi.mock("@/contexts/APIContext", () => ({ useQuestionsService: () => ({ answer: vi.fn() }) }));
vi.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ({ addNotification: mocks.addNotification, error: mocks.showError }),
}));
vi.mock("@/lib/api", () => ({ apiClient: { post: mocks.apiPost, patch: mocks.apiPatch } }));
vi.mock("@/services/intake", () => ({
  intakeService: {
    start: mocks.start, question: mocks.question, prepare: mocks.prepare,
    proposal: mocks.proposal, revise: mocks.revise,
  },
}));

const question = (prompt: string) => ({
  title: "t", prompt,
  options: [{ label: "A design partner", description: "a" }, { label: "Other", description: "b" }],
  multiSelect: false,
});

const followUpResponse = (prompts: string[], total: number) => ({
  questions: prompts.map((prompt) => question(prompt)),
  total,
});

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/i/new"]}>
      <Routes><Route path="*" element={<><NewSignalPage /><LocationProbe /></>} /></Routes>
    </MemoryRouter>,
  );
}

async function answer(prompt: string, label: string) {
  await screen.findByText(prompt);
  fireEvent.click(screen.getByText(label));
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fastSignalIntake = true;
  mocks.start.mockResolvedValue({ question: question("Who do you want to meet?") });
  mocks.question.mockResolvedValue(followUpResponse(["What would you bring?"], 2));
  mocks.prepare.mockResolvedValue({ runId: "run-1" });
  mocks.proposal.mockResolvedValue({
    proposalId: "prop-1", description: "Looking for a design partner.",
    lookingFor: "A design partner", youBring: "Engineering depth",
  });
  mocks.apiPost.mockResolvedValue({ intentId: "intent-1" });
});

describe("fast signal intake", () => {
  test("renders round 1 from /start without any chat kickoff", async () => {
    renderPage();

    await screen.findByText("Who do you want to meet?");
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.sendWebMessage).not.toHaveBeenCalled();
  });

  test("answering round 1 requests round 2", async () => {
    renderPage();

    await answer("Who do you want to meet?", "A design partner");

    await screen.findByText("What would you bring?");
    expect(mocks.question).toHaveBeenCalledWith(
      [{ prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] } }],
      undefined,
    );
  });

  test("singular mode: fetches the next question per turn and locks the total", async () => {
    mocks.start.mockResolvedValue({ question: question("Who do you want to meet?") });
    mocks.question
      .mockResolvedValueOnce(followUpResponse(["What would you bring?"], 3))
      .mockResolvedValueOnce(followUpResponse(["When do you need this?"], 3));
    mocks.prepare.mockResolvedValue({ runId: "run-1" });

    render(<MemoryRouter><FastSignalIntake onConfirmed={vi.fn()} /></MemoryRouter>);
    fireEvent.click(await screen.findByText("A design partner"));
    fireEvent.click(screen.getByText("Continue"));

    expect(await screen.findByText("What would you bring?")).toBeTruthy();
    fireEvent.click(screen.getByText("A design partner")); // option label shared by the fixture
    fireEvent.click(screen.getByText("Continue"));

    expect(await screen.findByText("When do you need this?")).toBeTruthy();
    expect(mocks.question).toHaveBeenCalledTimes(2);
    expect(mocks.question).toHaveBeenLastCalledWith(
      [
        { prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] } },
        { prompt: "What would you bring?", answer: { selectedOptions: ["A design partner"] } },
      ],
      3,
    );
  });

  test("plural mode: steps through the batch client-side without extra calls", async () => {
    mocks.start.mockResolvedValue({ question: question("Who do you want to meet?") });
    mocks.question.mockResolvedValueOnce(followUpResponse(["What would you bring?", "When do you need this?"], 3));
    mocks.prepare.mockResolvedValue({ runId: "run-1" });

    render(<MemoryRouter><FastSignalIntake onConfirmed={vi.fn()} /></MemoryRouter>);
    fireEvent.click(await screen.findByText("A design partner"));
    fireEvent.click(screen.getByText("Continue"));

    expect(await screen.findByText("What would you bring?")).toBeTruthy();
    fireEvent.click(screen.getByText("A design partner"));
    fireEvent.click(screen.getByText("Continue"));

    expect(await screen.findByText("When do you need this?")).toBeTruthy();
    expect(mocks.question).toHaveBeenCalledTimes(1); // no refetch while the queue holds questions

    fireEvent.click(screen.getByText("A design partner"));
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1));
  });

  test("sizes the progress bar to total + 2 once the plan is detected", async () => {
    mocks.start.mockResolvedValue({ question: question("Who do you want to meet?") });
    mocks.question.mockResolvedValueOnce(followUpResponse(["What would you bring?", "When do you need this?", "Budget?"], 4));

    const { container } = render(<MemoryRouter><FastSignalIntake onConfirmed={vi.fn()} /></MemoryRouter>);
    fireEvent.click(await screen.findByText("A design partner"));
    fireEvent.click(screen.getByText("Continue"));

    await screen.findByText("What would you bring?");
    expect(container.querySelectorAll('[aria-label="Signal progress"] > span')).toHaveLength(6); // 4 questions + where + confirm
  });

  test("advances straight to the where picker when the plan returns no follow-ups", async () => {
    mocks.start.mockResolvedValue({ question: question("Who do you want to meet?") });
    mocks.question.mockResolvedValueOnce({ questions: [], total: 1 });
    mocks.prepare.mockResolvedValue({ runId: "run-1" });

    render(<MemoryRouter><FastSignalIntake onConfirmed={vi.fn()} /></MemoryRouter>);
    fireEvent.click(await screen.findByText("A design partner"));
    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Everywhere")).toBeTruthy(); // WherePicker rendered
  });

  test("shows the where picker before any proposal resolves", async () => {
    let releaseProposal: (() => void) | undefined;
    mocks.proposal.mockImplementation(() => new Promise((resolve) => {
      releaseProposal = () => resolve({
        proposalId: "prop-1", description: "d", lookingFor: "l", youBring: "y",
      });
    }));
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");

    await screen.findByText(/everywhere/i);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).toHaveBeenCalledWith({
      rounds: [
        { prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] } },
        { prompt: "What would you bring?", answer: { selectedOptions: ["A design partner"] } },
      ],
    });
    expect(screen.queryByText(/does this feel right/i)).toBeNull();
    releaseProposal?.();
  });

  test("picking a community resolves the proposal without whereText", async () => {
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");
    fireEvent.click(await screen.findByText("Builders"));

    await screen.findByText(/does this feel right/i);
    expect(mocks.proposal).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      networkId: "network-1",
      rounds: [
        { prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] } },
        { prompt: "What would you bring?", answer: { selectedOptions: ["A design partner"] } },
      ],
    }));
    expect(mocks.proposal.mock.calls[0][0]).not.toHaveProperty("whereText");
  });

  test("the where picker offers available communities", async () => {
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");

    await screen.findByText("Builders");
    expect(screen.getByText("Builders")).toBeTruthy();
  });

  test("revising carries the picked community so confirm still matches the proposal", async () => {
    mocks.revise.mockResolvedValue({
      proposalId: "prop-2", description: "Sharper signal.", lookingFor: "l", youBring: "y",
    });
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");
    fireEvent.click(await screen.findByText("Builders"));
    await screen.findByText(/does this feel right/i);

    fireEvent.change(screen.getByPlaceholderText(/tell it what to change/i), {
      target: { value: "make it about hardware" },
    });
    fireEvent.click(screen.getByRole("button", { name: /revise with agent/i }));

    await waitFor(() => expect(mocks.revise).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1", feedback: "make it about hardware", networkId: "network-1",
    })));
  });

  test("free text sends whereText", async () => {
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");
    await screen.findByText(/everywhere/i);
    fireEvent.change(screen.getByPlaceholderText(/somewhere more specific/i), {
      target: { value: "Berlin only" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(mocks.proposal).toHaveBeenCalledWith(
      expect.objectContaining({ whereText: "Berlin only" }),
    ));
  });

  test("confirming posts to /intents/confirm and navigates", async () => {
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");
    fireEvent.click(await screen.findByText("Builders"));
    fireEvent.click(await screen.findByRole("button", { name: /confirm signal/i }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/intents/confirm", {
      proposalId: "prop-1",
      description: "Looking for a design partner.",
      networkId: "network-1",
    }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/i/intent-1"));
  });

  test("renders the clarification round when verification is rejected", async () => {
    mocks.proposal
      .mockRejectedValueOnce({ code: "verification_rejected", clarification: question("What would make it concrete?") })
      .mockResolvedValueOnce({
        proposalId: "prop-2", description: "Sharper signal.", lookingFor: "l", youBring: "y",
      });
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");
    fireEvent.click(await screen.findByText("Builders"));

    await answer("What would make it concrete?", "A design partner");
    await screen.findByText(/does this feel right/i);
    expect(mocks.proposal).toHaveBeenCalledTimes(2);
  });

  test("merges the clarification into the LAST round when the plan has three questions", async () => {
    mocks.question.mockResolvedValueOnce(followUpResponse(["What would you bring?", "When do you need this?"], 3));
    mocks.proposal
      .mockRejectedValueOnce({ code: "verification_rejected", clarification: question("Narrow it down?") })
      .mockResolvedValueOnce({
        proposalId: "prop-2", description: "Sharper signal.", lookingFor: "l", youBring: "y",
      });
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");

    await screen.findByText("When do you need this?");
    fireEvent.change(screen.getByPlaceholderText(/or tell me in your own words/i), {
      target: { value: "next month" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    fireEvent.click(await screen.findByText("Builders"));

    await screen.findByText("Narrow it down?");
    fireEvent.change(screen.getByPlaceholderText(/or tell me in your own words/i), {
      target: { value: "by Friday" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await screen.findByText(/does this feel right/i);
    expect(mocks.proposal).toHaveBeenCalledTimes(2);
    const retry = mocks.proposal.mock.calls[1][0] as {
      rounds: Array<{ prompt: string; answer: { selectedOptions: string[]; freeText?: string } }>;
    };
    expect(retry.rounds).toHaveLength(3);
    expect(retry.rounds[0]).toEqual({
      prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] },
    });
    expect(retry.rounds[1]).toEqual({
      prompt: "What would you bring?", answer: { selectedOptions: ["A design partner"] },
    });
    expect(retry.rounds[2].answer.freeText).toBe("next month — by Friday");
  });

  test("a non-empty server synthesis wins over the locally derived answer label", async () => {
    mocks.proposal.mockResolvedValue({
      proposalId: "prop-1", description: "Looking for a design partner.",
      lookingFor: "Server-synthesized: a hands-on product cofounder",
      youBring: "Server-synthesized: five years of infra experience",
    });
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");
    fireEvent.click(await screen.findByText("Builders"));

    await screen.findByText("Server-synthesized: a hands-on product cofounder");
    await screen.findByText("Server-synthesized: five years of infra experience");
    expect(screen.queryByText("A design partner", { selector: "p" })).toBeNull();
  });

  test("an empty server synthesis falls back to the locally derived answer label", async () => {
    mocks.proposal.mockResolvedValue({
      proposalId: "prop-1", description: "Looking for a design partner.",
      lookingFor: "", youBring: "",
    });
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");
    fireEvent.click(await screen.findByText("Builders"));

    await screen.findByText(/does this feel right/i);
    expect(screen.getAllByText("A design partner", { selector: "p" }).length).toBeGreaterThanOrEqual(2);
  });

  test("always uses the deterministic funnel — the legacy chat fallback is retired", async () => {
    mocks.fastSignalIntake = false;
    renderPage();

    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    expect(mocks.sendWebMessage).not.toHaveBeenCalled();
  });

  test("skipping a proposal rejects it server-side and lands on the terminal state", async () => {
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");
    fireEvent.click(await screen.findByText("Builders"));
    await screen.findByText(/does this feel right/i);

    fireEvent.click(screen.getByRole("button", { name: /not yet/i }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/intents/reject", { proposalId: "prop-1" }));
    await screen.findByText(/nothing saved/i);
    expect(screen.queryByText(/does this feel right/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /start over/i }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
    await screen.findByText("Who do you want to meet?");
  });

  test("a failed skip surfaces an error instead of silently succeeding", async () => {
    mocks.apiPost.mockImplementation((url: string) => {
      if (url === "/intents/reject") return Promise.reject(new Error("boom"));
      return Promise.resolve({ intentId: "intent-1" });
    });
    renderPage();

    await answer("Who do you want to meet?", "A design partner");
    await answer("What would you bring?", "A design partner");
    fireEvent.click(await screen.findByText("Builders"));
    await screen.findByText(/does this feel right/i);

    fireEvent.click(screen.getByRole("button", { name: /not yet/i }));

    await waitFor(() => expect(mocks.showError).toHaveBeenCalledWith("Signal dismissal failed", "boom"));
    expect(screen.getAllByText(/couldn't dismiss this signal/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/nothing saved/i)).toBeNull();
  });
});

describe("fast signal intake resume", () => {
  test("a resumeIntentId short-circuits the funnel and drives completion", async () => {
    const onConfirmed = vi.fn().mockResolvedValue(undefined);

    render(<FastSignalIntake onConfirmed={onConfirmed} resumeIntentId="intent-resume" />);

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(expect.objectContaining({
      intentId: "intent-resume",
      proposal: null,
    })));
    expect(mocks.start).not.toHaveBeenCalled();
    expect(screen.queryByText("Who do you want to meet?")).toBeNull();
    await screen.findByText(/your first signal is saved/i);
  });

  test("a resume completion failure shows the retry affordance instead of a fresh funnel", async () => {
    let attempts = 0;
    const onConfirmed = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("response lost");
    });

    render(<FastSignalIntake onConfirmed={onConfirmed} resumeIntentId="intent-resume" />);

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    await screen.findByRole("alert");
    expect(mocks.showError).toHaveBeenCalledWith("Onboarding completion failed", "response lost");
    expect(screen.queryByText("Who do you want to meet?")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /retry completion/i }));

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(2));
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
