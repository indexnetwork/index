import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NetworkDetailPage from "./page";

const state = vi.hoisted(() => ({ owner: false, plain: true, post: vi.fn(), remove: vi.fn() }));
const networks = [{ id: "network-1", title: "Foresight", permissions: { joinPolicy: "anyone" } }];
const service = { getCurrentUserMemberSettings: async () => ({ isOwner: state.owner }) };
const api = { post: state.post };
const notifications = { success: vi.fn(), error: vi.fn() };
vi.mock("@/contexts/AuthContext", () => ({ useAuthContext: () => ({ user: { id: "me" } }) }));
vi.mock("@/contexts/NetworksContext", () => ({ useNetworksState: () => ({ networks, removeNetwork: state.remove }) }));
vi.mock("@/contexts/APIContext", () => ({ useNetworks: () => service }));
vi.mock("@/contexts/NotificationContext", () => ({ useNotifications: () => notifications }));
vi.mock("@/lib/api", () => ({ APIError: class extends Error {}, useAuthenticatedAPI: () => api }));
vi.mock("@/hooks/useCompact", () => ({ useCompact: () => false }));
vi.mock("@/components/intents-home/appFrameContext", () => ({ useInAppFrame: () => state.plain }));
vi.mock("@/components/NetworkHomePanel", () => ({ default: () => <div>network dashboard</div> }));
vi.mock("@/components/NetworkOverviewPanel", () => ({ default: () => <div>network intents</div> }));
vi.mock("@/components/NetworkSettingsPanel", () => ({ default: () => <div>owner settings</div> }));

function mount(path = "/foresight") {
  const router = createMemoryRouter([{ path: "/foresight/*", element: <NetworkDetailPage networkIdOverride="network-1" basePath="/foresight" /> }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}
beforeEach(() => { state.owner = false; state.plain = true; vi.clearAllMocks(); });

describe("network home routing", () => {
  it("lands on Home and lets members navigate to intents", async () => {
    const router = mount();
    await screen.findByText("network dashboard");
    expect(screen.getByRole("tab", { name: "home" })).toHaveAttribute("aria-selected", "true");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "intents" }), { button: 0, ctrlKey: false });
    await screen.findByText("network intents");
    expect(router.state.location.pathname).toBe("/foresight/intents");
    expect(screen.queryByRole("tab", { name: "settings" })).not.toBeInTheDocument();
  });
  it("allows a member's direct intents link but redirects owner-only tabs", async () => {
    const router = mount("/foresight/intents");
    await screen.findByText("network intents");
    await router.navigate("/foresight/settings");
    await screen.findByText("network dashboard");
    expect(router.state.location.pathname).toBe("/foresight");
  });
  it("preserves owner settings", async () => {
    state.owner = true;
    mount("/foresight/settings");
    await screen.findByText("owner settings");
    expect(screen.getByRole("tab", { name: "home" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "access" })).toBeInTheDocument();
  });
  it.each([true, false])("can cancel leaving directly from Home (plain=%s)", async (plain) => {
    state.plain = plain;
    mount();
    await screen.findByText("network dashboard");
    fireEvent.click(screen.getByRole("button", { name: "leave" }));
    await screen.findByText(/leave Foresight\?/);
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    await waitFor(() => expect(screen.queryByText(/leave Foresight\?/)).not.toBeInTheDocument());
    expect(state.post).not.toHaveBeenCalled();
  });
});
