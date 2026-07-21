import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";

import NewSignalPage from "@/app/i/new/page";
import type { PendingQuestion } from "@/services/questions";

const mocks = vi.hoisted(() => ({
  state: {
    messages: [] as Array<{ content: string }>,
    liveQuestions: [] as PendingQuestion[],
    isLoading: false,
    startSignalSession: vi.fn(),
    sendWebMessage: vi.fn(),
    clearChat: vi.fn(),
  },
  answer: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  addNotification: vi.fn(),
  showError: vi.fn(),
  signOut: vi.fn(),
  openLoginModal: vi.fn(),
}));

vi.mock("@/contexts/AIChatContext", () => ({
  useAIChat: () => mocks.state,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuthContext: () => ({
    isAuthenticated: true,
    features: { signalAgent: true },
    signOut: mocks.signOut,
    openLoginModal: mocks.openLoginModal,
  }),
}));
vi.mock("@/contexts/IndexesContext", () => ({
  useNetworksState: () => ({
    indexes: [{ id: "network-1", title: "Builders", isPersonal: false }],
  }),
}));
vi.mock("@/contexts/APIContext", () => ({
  useQuestionsService: () => ({ answer: mocks.answer }),
}));
vi.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ({ addNotification: mocks.addNotification, error: mocks.showError }),
}));
vi.mock("@/lib/api", () => ({
  apiClient: { post: mocks.apiPost, patch: mocks.apiPatch },
}));

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/i/new"]}>
      <Routes>
        <Route path="*" element={<><NewSignalPage /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

function question(id: string): PendingQuestion {
  return {
    id,
    detection: {
      mode: "chat",
      sourceType: "conversation",
      sourceId: "session-1",
      timestamp: new Date().toISOString(),
    },
    actors: [],
    payload: {
      title: "Signal focus",
      prompt: "What are you looking for?",
      options: [{ label: "A collaborator", description: "Someone to build with" }],
      multiSelect: false,
    },
    status: "pending",
    answer: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    conversationId: "session-1",
  };
}

beforeEach(() => {
  mocks.state.messages = [];
  mocks.state.liveQuestions = [];
  mocks.state.isLoading = false;
  mocks.state.startSignalSession.mockReset();
  mocks.state.sendWebMessage.mockReset().mockResolvedValue(undefined);
  mocks.state.clearChat.mockReset();
  mocks.answer.mockReset().mockResolvedValue({ success: true, resumed: true });
  mocks.apiPost.mockReset().mockResolvedValue({ intentId: "intent-1" });
  mocks.apiPatch.mockReset().mockResolvedValue({});
  mocks.addNotification.mockReset();
  mocks.showError.mockReset();
  mocks.signOut.mockReset().mockResolvedValue(undefined);
  mocks.openLoginModal.mockReset();
});

describe("guided Signal creation", () => {
  test("starts a Signal session, renders blocking questions, and summarizes answers", async () => {
    const view = renderPage();

    await waitFor(() => expect(mocks.state.startSignalSession).toHaveBeenCalledTimes(1));
    expect(mocks.state.sendWebMessage).toHaveBeenCalledWith(
      "new-signal-kickoff",
      undefined,
      undefined,
      expect.objectContaining({
        hidden: true,
        persona: "signal",
        onError: expect.any(Function),
      }),
    );

    const current = question("question-1");
    mocks.state.liveQuestions = [current];
    mocks.state.isLoading = true;
    await act(async () => {
      // Re-rendering the route models the context update emitted by SSE.
      view.rerender(
        <MemoryRouter initialEntries={["/i/new"]}>
          <Routes><Route path="*" element={<><NewSignalPage /><LocationProbe /></>} /></Routes>
        </MemoryRouter>,
      );
    });

    expect(screen.getByRole("heading", { name: "What are you looking for?" })).toBeInTheDocument();
    expect(screen.getByText("A collaborator")).toBeInTheDocument();
    expect(screen.getByLabelText("Signal progress")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /A collaborator/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(mocks.answer).toHaveBeenCalledWith("question-1", { selectedOptions: ["A collaborator"] }));
    expect(screen.getByText("A collaborator")).toBeInTheDocument();
  });

  test("offers an in-page retry when kickoff fails", async () => {
    mocks.state.sendWebMessage.mockImplementationOnce((...args: unknown[]) => {
      const options = args[3] as { onError?: (error: unknown) => void } | undefined;
      options?.onError?.(new Error("network unavailable"));
      return Promise.resolve();
    });

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't start your signal. Please try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(mocks.state.sendWebMessage).toHaveBeenCalledTimes(2));
    expect(mocks.state.startSignalSession).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("location")).toHaveTextContent("/i/new");
  });

  test("redirects expired kickoff sessions to login with an auth error", async () => {
    const { AuthSessionError } = await import("@/lib/auth-client");
    mocks.state.sendWebMessage.mockImplementationOnce((...args: unknown[]) => {
      const options = args[3] as { onError?: (error: unknown) => void } | undefined;
      options?.onError?.(new AuthSessionError());
      return Promise.resolve();
    });

    renderPage();

    await waitFor(() => expect(mocks.showError).toHaveBeenCalledWith(
      "Session expired",
      "Please sign in again to start your signal.",
    ));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    expect(mocks.openLoginModal).toHaveBeenCalledWith(expect.stringContaining("/i/new"));
    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });

  test("shows the proposal confirmation card and confirms through the existing endpoint", async () => {
    const view = renderPage();
    mocks.state.messages = [{ 
      content: [
        "Here is the signal.",
        "```intent_proposal",
        JSON.stringify({
          proposalId: "proposal-1",
          description: "Find a thoughtful technical collaborator",
          youBring: "Product experience",
          networkId: "network-1",
        }),
        "```",
      ].join("\n"),
    }];

    await act(async () => {
      view.rerender(
        <MemoryRouter initialEntries={["/i/new"]}>
          <Routes><Route path="*" element={<><NewSignalPage /><LocationProbe /></>} /></Routes>
        </MemoryRouter>,
      );
    });

    expect(screen.getByText("LOOKING FOR")).toBeInTheDocument();
    expect(screen.getByText("Find a thoughtful technical collaborator")).toBeInTheDocument();
    expect(screen.getByText("YOU BRING")).toBeInTheDocument();
    expect(screen.getByText("Product experience")).toBeInTheDocument();
    expect(screen.getByText("Builders")).toBeInTheDocument();
    expect(screen.queryByText("Everywhere")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm signal" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/intents/confirm", {
      proposalId: "proposal-1",
      description: "Find a thoughtful technical collaborator",
      networkId: "network-1",
    }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/i/intent-1"));
    expect(mocks.addNotification).toHaveBeenCalledWith(expect.objectContaining({ type: "intent_broadcast" }));
  });
});
