import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { render } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  startReporterSession: vi.fn(),
  sendWebMessage: vi.fn().mockResolvedValue(undefined),
  getIntents: vi.fn(),
}));

vi.mock("@indexnetwork/protocol", () => ({
  REPORTER_BRIEFING_KICKOFF: "reporter-briefing-kickoff",
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuthContext: () => ({ isAuthenticated: true, features: { agentSurface: true } }),
}));

vi.mock("@/contexts/AIChatContext", () => ({
  useAIChat: () => ({
    messages: [],
    startReporterSession: mocks.startReporterSession,
    sendWebMessage: mocks.sendWebMessage,
  }),
}));

vi.mock("@/contexts/QuestionsContext", () => ({
  useQuestions: () => ({ globalPending: 3, loading: false }),
}));

vi.mock("@/contexts/APIContext", () => ({
  useIntents: () => ({ getIntents: mocks.getIntents }),
}));

vi.mock("@/components/ChatContent", () => ({
  default: () => <div data-testid="reporter-chat" />,
}));

import AgentReporterSurface from "@/components/AgentReporterSurface";

describe("AgentReporterSurface", () => {
  beforeEach(() => {
    mocks.startReporterSession.mockClear();
    mocks.sendWebMessage.mockClear();
    mocks.getIntents.mockReset();
    mocks.getIntents.mockResolvedValue({
      intents: [
        { id: "active-1", status: "ACTIVE" },
        { id: "paused-1", status: "PAUSED" },
        { id: "legacy-active", status: null },
      ],
    });
  });

  test("starts one hidden reporter briefing and shows fetched counts", async () => {
    render(<AgentReporterSurface />);

    await waitFor(() => expect(screen.getByText(
      "online — watching 2 signals · 3 questions pending",
    )).toBeInTheDocument());
    expect(mocks.startReporterSession).toHaveBeenCalledTimes(1);
    expect(mocks.sendWebMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendWebMessage).toHaveBeenCalledWith(
      "reporter-briefing-kickoff",
      undefined,
      undefined,
      { hidden: true, persona: "reporter" },
    );
    expect(screen.getByTestId("reporter-chat")).toBeInTheDocument();
  });
});
