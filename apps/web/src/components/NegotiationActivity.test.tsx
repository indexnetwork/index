import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { normalizeNegotiationActivity } from "@/lib/negotiation-activity";

import NegotiationActivity from "./NegotiationActivity";

const messages = [4, 1, 3, 2].map((value) => ({
  id: `m-${value}`,
  opportunityId: "opp-1",
  sender: value % 2 ? "theirs" as const : "yours" as const,
  parts: [{ text: `message ${value}` }],
  createdAt: `2026-07-24T00:00:0${value}.000Z`,
}));

describe("NegotiationActivity", () => {
  it("groups by stable correspondent and renders exactly the latest three in chronological order", () => {
    const groups = normalizeNegotiationActivity([{
      correspondentUserId: "user-b",
      correspondentLabel: "Ada's agent",
      correspondentAvatar: null,
      messages,
    }]);
    render(<NegotiationActivity groups={groups} loading={false} error={false} />);

    expect(screen.getByRole("region", { name: "Negotiation with Ada's agent" })).toBeTruthy();
    expect(screen.queryByText("message 1")).toBeNull();
    const rendered = screen.getAllByText(/message [234]/).map((node) => node.textContent);
    expect(rendered).toEqual(["message 2", "message 3", "message 4"]);
    expect(screen.getAllByText("Your agent")).toHaveLength(2);
    expect(screen.getAllByText("Their agent")).toHaveLength(1);
  });

  it("does not fabricate messages while activity is empty", () => {
    render(<NegotiationActivity groups={[]} loading={false} error={false} />);
    expect(screen.getByText(/Messages will appear here as they are persisted/)).toBeTruthy();
    expect(screen.queryByText(/message 1/)).toBeNull();
  });
});
