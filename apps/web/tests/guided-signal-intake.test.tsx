import { useCallback, useState } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { GuidedSignalIntake } from "@/components/signals/GuidedSignalIntake";
import { renderWithRouter } from "@/test/test-utils";

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  answer: vi.fn(),
  showError: vi.fn(),
  chat: {
    messages: [] as Array<{ content: string }>,
    liveQuestions: [] as Array<Record<string, unknown>>,
    isLoading: false,
  },
}));

vi.mock("@/lib/api", () => ({
  apiClient: { post: mocks.apiPost },
}));

vi.mock("@/contexts/AIChatContext", () => ({
  useAIChat: () => mocks.chat,
}));

vi.mock("@/contexts/APIContext", () => ({
  useQuestionsService: () => ({ answer: mocks.answer }),
}));

vi.mock("@/contexts/IndexesContext", () => ({
  useNetworksState: () => ({
    indexes: [{ id: "22222222-2222-4222-8222-222222222222", title: "Climate Builders" }],
  }),
}));

vi.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ({ error: mocks.showError }),
}));

const proposalBlock = `\`\`\`intent_proposal
{"proposalId":"proposal-1","description":"Find a climate collaborator","networkId":"22222222-2222-4222-8222-222222222222"}
\`\`\``;

function renderIntake(overrides: {
  onConfirmed?: (value: { intentId: string }) => Promise<void>;
  resumeIntentId?: string;
} = {}) {
  const prepareSession = vi.fn();
  const sendKickoff = vi.fn(async () => undefined);
  const sendFollowup = vi.fn(async () => undefined);
  const onConfirmed = vi.fn(overrides.onConfirmed ?? (async () => undefined));
  renderWithRouter(
    <GuidedSignalIntake
      prepareSession={prepareSession}
      sendKickoff={sendKickoff}
      sendFollowup={sendFollowup}
      onConfirmed={onConfirmed}
      resumeIntentId={overrides.resumeIntentId}
    />,
  );
  return { prepareSession, sendKickoff, sendFollowup, onConfirmed };
}

describe("GuidedSignalIntake shared renderer", () => {
  beforeEach(() => {
    mocks.apiPost.mockReset();
    mocks.answer.mockReset();
    mocks.showError.mockReset();
    mocks.chat.messages = [];
    mocks.chat.liveQuestions = [];
    mocks.chat.isLoading = false;
  });

  test("waits for a committed reset before kicking off with the fresh unscoped session", async () => {
    const kickoff = vi.fn(async (_sessionId: string | null, _scopeId: string | null) => undefined);

    function StaleSessionHarness() {
      const [sessionId, setSessionId] = useState<string | null>("stale-signal-session");
      const [scopeId, setScopeId] = useState<string | null>("stale-network-scope");
      const prepareSession = useCallback(() => {
        setSessionId(null);
        setScopeId(null);
      }, []);
      const sendKickoff = useCallback(
        () => kickoff(sessionId, scopeId),
        [scopeId, sessionId],
      );

      return (
        <GuidedSignalIntake
          prepareSession={prepareSession}
          sendKickoff={sendKickoff}
          sendFollowup={async () => undefined}
          onConfirmed={async () => undefined}
        />
      );
    }

    renderWithRouter(<StaleSessionHarness />);

    await waitFor(() => expect(kickoff).toHaveBeenCalledWith(null, null));
    expect(kickoff).toHaveBeenCalledTimes(1);
    expect(kickoff).not.toHaveBeenCalledWith("stale-signal-session", "stale-network-scope");
  });

  test("runs the shared kickoff and renders the live question round", async () => {
    mocks.chat.liveQuestions = [{
      id: "question-1",
      payload: {
        prompt: "Who do you want to meet?",
        options: [{ label: "A collaborator", description: "Someone to build with" }],
        multiSelect: false,
      },
    }];
    mocks.answer.mockResolvedValue({ resumed: true });
    const harness = renderIntake();

    await waitFor(() => expect(harness.prepareSession).toHaveBeenCalledTimes(1));
    expect(harness.sendKickoff).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Who do you want to meet?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /A collaborator/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(mocks.answer).toHaveBeenCalledWith("question-1", {
      selectedOptions: ["A collaborator"],
    }));
  });

  test("retries completion without confirming the proposal twice", async () => {
    mocks.chat.messages = [{ content: proposalBlock }];
    mocks.apiPost.mockResolvedValue({ intentId: "intent-1" });
    let attempts = 0;
    const harness = renderIntake({
      onConfirmed: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("completion unavailable");
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Confirm signal" }));
    await waitFor(() => expect(harness.onConfirmed).toHaveBeenCalledTimes(1));
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    expect(mocks.apiPost).toHaveBeenCalledWith("/intents/confirm", {
      proposalId: "proposal-1",
      description: "Find a climate collaborator",
      networkId: "22222222-2222-4222-8222-222222222222",
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm signal" }));
    await waitFor(() => expect(harness.onConfirmed).toHaveBeenCalledTimes(2));
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    expect(harness.onConfirmed).toHaveBeenLastCalledWith(expect.objectContaining({
      intentId: "intent-1",
      networkTitle: "Climate Builders",
    }));
  });

  test("resume mode skips intake and retries only the exact already-created intent", async () => {
    let attempts = 0;
    const harness = renderIntake({
      resumeIntentId: "intent-resume",
      onConfirmed: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("response lost");
      },
    });

    await waitFor(() => expect(harness.onConfirmed).toHaveBeenCalledWith(expect.objectContaining({
      intentId: "intent-resume",
      proposal: null,
    })));
    expect(harness.prepareSession).not.toHaveBeenCalled();
    expect(harness.sendKickoff).not.toHaveBeenCalled();
    expect(mocks.apiPost).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry completion" }));
    });
    await waitFor(() => expect(harness.onConfirmed).toHaveBeenCalledTimes(2));
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });
});
