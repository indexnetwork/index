import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";

import OnboardingPage from "@/app/onboarding/page";
import { renderWithRouter } from "@/test/test-utils";

const mocks = vi.hoisted(() => ({
  user: {
    id: "user-1",
    onboarding: {
      profileConfirmedAt: "2026-07-01T00:00:00.000Z",
      currentStep: "first_signal",
    },
  } as Record<string, unknown>,
  refetchUser: vi.fn(),
  acceptInvitation: vi.fn(),
  refreshIndexes: vi.fn(),
  showError: vi.fn(),
  clearChat: vi.fn(),
  sendOnboardingMessage: vi.fn(),
  apiPost: vi.fn(),
  signalAgentEnabled: true,
  guidedProps: null as null | Record<string, unknown>,
}));

vi.mock("@/app/onboarding/legacy-page", () => ({ default: () => <div>Legacy onboarding</div> }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuthContext: () => ({
    user: mocks.user,
    features: { signalAgent: mocks.signalAgentEnabled },
    refetchUser: mocks.refetchUser,
  }),
}));

vi.mock("@/contexts/APIContext", () => ({
  useNetworks: () => ({ acceptInvitation: mocks.acceptInvitation }),
}));

vi.mock("@/contexts/IndexesContext", () => ({
  useNetworksState: () => ({ refreshIndexes: mocks.refreshIndexes, indexes: [] }),
}));

vi.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ({ error: mocks.showError }),
}));

vi.mock("@/contexts/AIChatContext", () => ({
  useAIChat: () => ({
    clearChat: mocks.clearChat,
    sendOnboardingMessage: mocks.sendOnboardingMessage,
    messages: [],
    isLoading: false,
    stopStream: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  apiClient: { post: mocks.apiPost },
}));

vi.mock("@/components/signals/GuidedSignalIntake", () => ({
  GuidedSignalIntake: (props: Record<string, unknown>) => {
    mocks.guidedProps = props;
    const onConfirmed = props.onConfirmed as (value: Record<string, unknown>) => Promise<void>;
    return (
      <div>
        <span data-testid="resume-id">{String(props.resumeIntentId ?? "none")}</span>
        <button
          type="button"
          onClick={() => void onConfirmed({
            intentId: "intent-1",
            proposal: { proposalId: "proposal-1", description: "Find a collaborator" },
            networkTitle: "Everywhere",
          }).catch(() => undefined)}
        >
          Complete first signal
        </button>
      </div>
    );
  },
}));

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function renderPage() {
  return renderWithRouter(
    <>
      <OnboardingPage />
      <LocationProbe />
    </>,
    { route: "/onboarding" },
  );
}

describe("flag-on onboarding first-signal handoff", () => {
  beforeEach(() => {
    mocks.user = {
      id: "user-1",
      onboarding: {
        profileConfirmedAt: "2026-07-01T00:00:00.000Z",
        currentStep: "first_signal",
      },
    };
    mocks.refetchUser.mockReset().mockResolvedValue(undefined);
    mocks.acceptInvitation.mockReset().mockResolvedValue(undefined);
    mocks.refreshIndexes.mockReset().mockResolvedValue(undefined);
    mocks.showError.mockReset();
    mocks.clearChat.mockReset();
    mocks.sendOnboardingMessage.mockReset().mockResolvedValue(undefined);
    mocks.apiPost.mockReset();
    mocks.signalAgentEnabled = true;
    mocks.guidedProps = null;
    localStorage.clear();
  });

  test("preserves the legacy onboarding page while the cutover flag is off", () => {
    mocks.signalAgentEnabled = false;
    renderPage();

    expect(screen.getByText("Legacy onboarding")).toBeInTheDocument();
    expect(mocks.guidedProps).toBeNull();
  });

  test("awaits durable completion before invitation acceptance, membership refresh, and exact navigation", async () => {
    localStorage.setItem("pendingInviteCode", "invite-code");
    const completion = deferred<{
      success: boolean;
      data: { intentId: string; completedAt: string };
    }>();
    mocks.apiPost.mockReturnValue(completion.promise);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Complete first signal" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/onboarding");
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
    expect(mocks.refreshIndexes).not.toHaveBeenCalled();

    completion.resolve({
      success: true,
      data: { intentId: "intent-1", completedAt: "2026-07-01T00:01:00.000Z" },
    });

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/i/intent-1"));
    expect(mocks.apiPost).toHaveBeenCalledWith("/tools/complete_onboarding", {
      query: { intentId: "intent-1" },
    });
    expect(mocks.refetchUser).toHaveBeenCalledTimes(1);
    expect(mocks.acceptInvitation).toHaveBeenCalledWith("invite-code");
    expect(mocks.refreshIndexes).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("pendingInviteCode")).toBeNull();
    expect(localStorage.getItem("index:onboarding:first-signal:user-1")).toBeNull();
  });

  test("stays on onboarding when completion validation fails", async () => {
    mocks.apiPost.mockResolvedValue({ success: false, error: "profile marker missing" });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Complete first signal" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("location")).toHaveTextContent("/onboarding");
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
    expect(mocks.refreshIndexes).not.toHaveBeenCalled();
    expect(localStorage.getItem("index:onboarding:first-signal:user-1")).toBe("intent-1");
  });

  test("derives the profile phase from durable state and deliberately restarts only that phase", async () => {
    mocks.user = { id: "user-1", onboarding: {} };
    renderPage();

    await waitFor(() => expect(mocks.clearChat).toHaveBeenCalledWith({ abortStream: true }));
    expect(mocks.sendOnboardingMessage).toHaveBeenCalledWith(
      "onboarding-profile-kickoff",
      undefined,
      undefined,
      { hidden: true },
    );
    expect(mocks.guidedProps).toBeNull();
  });

  test("refresh recovery supplies the exact pending intent instead of restarting intake", () => {
    localStorage.setItem("index:onboarding:first-signal:user-1", "intent-pending");
    renderPage();

    expect(screen.getByTestId("resume-id")).toHaveTextContent("intent-pending");
  });

  test("completed users navigate to the durable exact signal without rendering intake", async () => {
    mocks.user = {
      id: "user-1",
      onboarding: {
        profileConfirmedAt: "2026-07-01T00:00:00.000Z",
        firstSignalIntentId: "intent-durable",
        completedAt: "2026-07-01T00:01:00.000Z",
        currentStep: "complete",
      },
    };
    renderPage();

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/i/intent-durable"));
    expect(mocks.guidedProps).toBeNull();
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });
});
