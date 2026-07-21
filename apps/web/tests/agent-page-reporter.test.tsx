import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  features: null as { agentSurface?: boolean } | null,
  reporterSurface: vi.fn(() => <div data-testid="reporter-surface" />),
  chatContent: vi.fn(() => <div data-testid="chat-content" />),
}));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuthContext: () => ({
    user: null,
    isAuthenticated: true,
    isLoading: false,
    features: mocks.features,
  }),
}));

vi.mock("@/components/ClientLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ChatContent", () => ({
  default: mocks.chatContent,
}));

vi.mock("@/components/AgentReporterSurface", () => ({
  default: mocks.reporterSurface,
}));

vi.mock("@/components/NegotiatorMemoryPanel", () => ({
  default: () => <div data-testid="memory-panel" />,
}));

import AgentPage from "@/app/agent/page";

describe("/agent reporter surface gating", () => {
  beforeEach(() => {
    mocks.features = null;
    mocks.reporterSurface.mockClear();
    mocks.chatContent.mockClear();
  });

  test("flag off keeps the existing ChatContent surface", () => {
    render(<AgentPage />);

    expect(screen.getByTestId("chat-content")).toBeInTheDocument();
    expect(screen.queryByTestId("reporter-surface")).not.toBeInTheDocument();
    expect(mocks.reporterSurface).not.toHaveBeenCalled();
  });

  test("flag on renders the reporter surface", () => {
    mocks.features = { agentSurface: true };

    render(<AgentPage />);

    expect(screen.getByTestId("reporter-surface")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-content")).not.toBeInTheDocument();
  });
});
