import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth: { isAuthenticated: boolean; isReady: boolean; user: unknown } = { isAuthenticated: false, isReady: true, user: null };
const acceptInvitation = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({ useAuthContext: () => auth }));
vi.mock("@/services/networks", () => ({
  networksService: {
    getNetworkByShareCode: () => Promise.resolve({ id: "n1", title: "Index Early Birds", _count: { members: 122 } }),
  },
  useNetworkService: () => ({ acceptInvitation }),
}));
// Stand-in form: one button per outcome the landing listens for.
vi.mock("@/components/AuthForm", () => ({
  default: ({ onMagicLinkSent }: { onMagicLinkSent?: (email: string) => void }) => (
    <button type="button" onClick={() => onMagicLinkSent?.("ada@example.com")}>send link</button>
  ),
}));

import NetworkWebInviteLanding from "./NetworkWebInviteLanding";

function renderLanding() {
  const tree = (
    <MemoryRouter initialEntries={["/l/abc"]}>
      <Routes>
        <Route path="/l/:code" element={<NetworkWebInviteLanding />} />
        <Route path="/onboarding" element={<p>onboarding page</p>} />
        <Route path="/networks/:id" element={<p>network page</p>} />
      </Routes>
    </MemoryRouter>
  );
  const view = render(tree);
  return { ...view, rerenderLanding: () => view.rerender(tree) };
}

describe("NetworkWebInviteLanding", () => {
  beforeEach(() => {
    auth.isAuthenticated = false;
    auth.user = null;
    acceptInvitation.mockReset();
    acceptInvitation.mockResolvedValue({ status: "joined", network: { id: "n1" } });
  });

  it("stays on check your email when the mailed link signs in from another tab", async () => {
    const { rerenderLanding } = renderLanding();
    fireEvent.click(await screen.findByRole("button", { name: "send link" }));
    expect(screen.getByText("Check your email")).toBeTruthy();

    // The magic link opened in a new tab; the shared session reaches this one.
    auth.isAuthenticated = true;
    await act(async () => { rerenderLanding(); });

    expect(screen.getByText("Check your email")).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.queryByText("onboarding page")).toBeNull();
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it("joins a new account and sends it to onboarding", async () => {
    auth.isAuthenticated = true;
    auth.user = { id: "u1", onboarding: {} };
    renderLanding();
    expect(await screen.findByText("onboarding page")).toBeTruthy();
    expect(acceptInvitation).toHaveBeenCalledWith("abc");
  });

  it("joins an existing account and opens the network", async () => {
    auth.isAuthenticated = true;
    auth.user = { id: "u1", onboarding: { profileConfirmedAt: "2026-10-01T00:00:00Z" } };
    renderLanding();
    expect(await screen.findByText("network page")).toBeTruthy();
    expect(acceptInvitation).toHaveBeenCalledWith("abc");
  });
});
