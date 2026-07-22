import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { render } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  startReporterSession: vi.fn().mockResolvedValue(true),
  getIntents: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuthContext: () => ({ isAuthenticated: true, features: { agentSurface: true } }),
}));

vi.mock("@/contexts/AIChatContext", () => ({
  useAIChat: () => ({
    messages: [],
    startReporterSession: mocks.startReporterSession,
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
    mocks.getIntents.mockReset();
    mocks.getIntents.mockResolvedValue({
      intents: [
        { id: "active-1", status: "ACTIVE" },
        { id: "paused-1", status: "PAUSED" },
        { id: "legacy-active", status: null },
      ],
    });
  });

  test("resolves one server-authoritative reporter briefing and shows fetched counts", async () => {
    render(<AgentReporterSurface />);

    await waitFor(() => expect(screen.getByText(
      "online — watching 2 signals · 3 questions pending",
    )).toBeInTheDocument());
    expect(mocks.startReporterSession).toHaveBeenCalledTimes(1);
    expect(mocks.startReporterSession).toHaveBeenCalledWith();
    expect(screen.getByTestId("reporter-chat")).toBeInTheDocument();
  });
});
