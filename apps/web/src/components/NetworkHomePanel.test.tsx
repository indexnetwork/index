import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NetworkHomePanel from "./NetworkHomePanel";

const mocks = vi.hoisted(() => ({ getRadarView: vi.fn(), act: vi.fn() }));
const service = { getRadarView: mocks.getRadarView };
vi.mock("@/contexts/APIContext", () => ({ useOpportunities: () => service }));
vi.mock("@/hooks/useOpportunityActions", () => ({ useOpportunityActions: () => ({ opportunityStatusMap: {}, opportunityActionLoading: {}, handleOpportunityAction: mocks.act }) }));
vi.mock("@/components/UserAvatar", () => ({ default: () => null }));

const card = (id: string, status = "pending", extra = {}) => ({ opportunityId: id, status, peer: { userId: id, name: id }, mainText: `about ${id}`, ...extra });
const mount = () => render(<MemoryRouter><NetworkHomePanel network={{ id: "foresight", title: "Foresight" }} /></MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); });

describe("network member home", () => {
  it("requests only the current network and groups opportunities by the viewer's state", async () => {
    mocks.getRadarView.mockResolvedValue({ items: [card("Alice"), card("Bob", "negotiating"), card("Carol", "pending", { viewerCommitted: true })] });
    mount();
    await screen.findByText("Alice");
    expect(mocks.getRadarView).toHaveBeenCalledWith(expect.objectContaining({ networkId: "foresight", statuses: ["pending", "negotiating", "accepted"] }));
    expect(within(screen.getByRole("region", { name: "waiting on you" })).getByText("Alice")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "in progress" })).getByText("Bob")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "accepted" })).getByText("Carol")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "open chat ›" })).toHaveAttribute("href", "/u/Carol/chat");
  });

  it("uses the shared decision flow and preserves the unverified-person flag", async () => {
    mocks.getRadarView.mockResolvedValue({ items: [card("Alice", "pending", { peer: { userId: "Alice", name: "Alice", emailVerified: false } })] });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "accept" }));
    expect(mocks.act).toHaveBeenCalledWith("Alice", "accepted", "Alice", { notOnIndex: true });
    fireEvent.click(screen.getByRole("button", { name: "pass" }));
    expect(mocks.act).toHaveBeenCalledWith("Alice", "rejected", "Alice");
  });

  it("recovers from a failed request", async () => {
    mocks.getRadarView.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ items: [] });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "try again" }));
    await screen.findByText("nothing waiting on you right now.");
    expect(mocks.getRadarView).toHaveBeenCalledTimes(2);
  });

  it("discards late results after moving to another network", async () => {
    let finish!: (value: unknown) => void;
    mocks.getRadarView.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce({ items: [card("Bob")] });
    const view = mount();
    view.rerender(<MemoryRouter><NetworkHomePanel key="other" network={{ id: "other", title: "Other" }} /></MemoryRouter>);
    await screen.findByText("Bob");
    finish({ items: [card("Alice")] });
    await waitFor(() => expect(screen.queryByText("Alice")).not.toBeInTheDocument());
    expect(mocks.getRadarView).toHaveBeenLastCalledWith(expect.objectContaining({ networkId: "other" }));
  });
});
