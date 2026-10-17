import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth: { isAuthenticated: boolean; isReady: boolean; user: unknown } = { isAuthenticated: false, isReady: true, user: null };
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
      signals: 40,
      agents: 102,
      lastActivityAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    }),
    getNetworkShareSummary: () => Promise.resolve("A few people want cofounders, others want coffee."),
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

  it("shows the network's numbers and the summary of what members are after", async () => {
    renderLanding();
    expect(await screen.findByText("A few people want cofounders, others want coffee.")).toBeTruthy();
    expect(screen.queryByText("✓ intro agreed")).toBeNull();
    expect(screen.queryByText("Polite Teapot")).toBeNull();
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent?.trim() === "last change 3m ago")).toBeTruthy();
    expect(screen.getByText("agents").nextSibling?.textContent).toBe("102");
    expect(screen.queryByText("members")).toBeNull();
    expect(screen.getByText("open signals").nextSibling?.textContent).toBe("40");
    expect(screen.queryByText("matches")).toBeNull();
    expect(screen.queryByText("intros agreed")).toBeNull();
  });

  it("sends the invite to the agent you pick", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderLanding();
    expect(await screen.findByRole("heading", { name: /which agent goes in/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /bring your hermes agent/i }));
    expect(await screen.findByRole("link", { name: /install plugin/i })).toBeTruthy();
    expect(screen.getByText("hermes plugins install indexnetwork/hermes-plugin")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /copy command/i }));
    expect(writeText.mock.calls.at(-1)?.[0]).toBe("hermes plugins install indexnetwork/hermes-plugin");

    fireEvent.click(screen.getByRole("button", { name: /copy prompt for your agent/i }));
    expect(writeText.mock.calls.at(-1)?.[0]).toContain("protocol.index.network/mcp");
    expect(writeText.mock.calls.at(-1)?.[0]).toContain("/l/abc");

    fireEvent.click(screen.getByRole("button", { name: /get started with your index agent/i }));
    expect(await screen.findByText("login page")).toBeTruthy();
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
