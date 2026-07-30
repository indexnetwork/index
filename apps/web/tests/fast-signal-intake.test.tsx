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
    startSignalSession: vi.fn(), sendWebMessage: mocks.sendWebMessage, clearChat: vi.fn(),
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
  useNetworksState: () => ({ indexes: [{ id: "network-1", title: "Builders", isPersonal: false }] }),
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
  mocks.question.mockResolvedValue({ question: question("What would you bring?") });
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
    expect(mocks.question).toHaveBeenCalledWith({ selectedOptions: ["A design partner"] });
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
      runId: "run-1", networkId: "network-1",
    }));
    expect(mocks.proposal.mock.calls[0][0]).not.toHaveProperty("whereText");
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

  test("falls back to the legacy chat path when the flag is off", async () => {
    mocks.fastSignalIntake = false;
    renderPage();

    await waitFor(() => expect(mocks.sendWebMessage).toHaveBeenCalledWith(
      "new-signal-kickoff", undefined, undefined, expect.objectContaining({ hidden: true, persona: "signal" }),
    ));
    expect(mocks.start).not.toHaveBeenCalled();
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
