import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth: { isAuthenticated: boolean; isReady: boolean; user: unknown; refetchUser: ReturnType<typeof vi.fn> } = {
  isAuthenticated: false,
  isReady: true,
  user: null,
  refetchUser: vi.fn().mockResolvedValue(undefined),
};
const acceptInvitation = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({ useAuthContext: () => auth }));
vi.mock("@/services/networks", () => ({
  networksService: {
    getNetworkByShareCode: () => Promise.resolve({
      id: "n1",
      title: "Index Early Birds",
      _count: { members: 122 },
    }),
    getNetworkSharePulse: () => Promise.resolve({
      intents: 40,
      agents: 102,
      lastActivityAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    }),
    getNetworkShareSummary: () => Promise.resolve("A few people want cofounders, others want coffee."),
  },
  useNetworkService: () => ({ acceptInvitation }),
}));

import NetworkWebInviteLanding from "./NetworkWebInviteLanding";

function renderLanding() {
  const tree = (
    <MemoryRouter initialEntries={["/l/abc"]}>
      <Routes>
        <Route path="/l/:code" element={<NetworkWebInviteLanding />} />
        <Route path="/onboarding" element={<p>onboarding page</p>} />
        <Route path="/networks/:id" element={<p>network page</p>} />
        <Route path="/login" element={<p>login page</p>} />
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
    auth.refetchUser.mockClear();
    acceptInvitation.mockReset();
    acceptInvitation.mockResolvedValue({ status: "joined", network: { id: "n1" } });
  });

  it("sends a signed-out visitor to sign in, which comes back to the invite", async () => {
    renderLanding();
    const join = await screen.findByRole("link", { name: /join in the browser/i });
    expect(join.getAttribute("href")).toBe(`/login?next=${encodeURIComponent("/l/abc")}`);
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it("shows the network's numbers and the summary of what members are after", async () => {
    renderLanding();
    expect(await screen.findByText("A few people want cofounders, others want coffee.")).toBeTruthy();
    expect(screen.queryByText("✓ intro agreed")).toBeNull();
    expect(screen.queryByText("Polite Teapot")).toBeNull();
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent?.trim() === "last change 3m ago")).toBeTruthy();
    expect(screen.getByText("agents").nextSibling?.textContent).toBe("102");
    expect(screen.queryByText("members")).toBeNull();
    expect(screen.getByText("open intents").nextSibling?.textContent).toBe("40");
    expect(screen.queryByText("matches")).toBeNull();
    expect(screen.queryByText("intros agreed")).toBeNull();
  });

  it("copies the same agent prompt as everywhere else, with this invite to join", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderLanding();
    fireEvent.click(await screen.findByRole("button", { name: /copy a prompt for your agent/i }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    const prompt = writeText.mock.calls.at(-1)?.[0] as string;
    expect(prompt).toContain("protocol.index.network/mcp");
    expect(prompt).toContain("join_network");
    expect(prompt).toContain("/l/abc");
    expect(screen.queryByText(/hermes/i)).toBeNull();
  });

  it("joins a new account and sends it to onboarding", async () => {
    auth.isAuthenticated = true;
    auth.user = { id: "u1", onboarding: {} };
    renderLanding();
    expect(await screen.findByText("onboarding page")).toBeTruthy();
    expect(acceptInvitation).toHaveBeenCalledWith("abc");
    expect(auth.refetchUser).toHaveBeenCalled();
  });

  it("joins an existing account and opens the network", async () => {
    auth.isAuthenticated = true;
    auth.user = { id: "u1", onboarding: { profileConfirmedAt: "2026-10-01T00:00:00Z" } };
    renderLanding();
    expect(await screen.findByText("network page")).toBeTruthy();
    expect(acceptInvitation).toHaveBeenCalledWith("abc");
    expect(auth.refetchUser).toHaveBeenCalled();
  });
});
