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

  it("shows the checklist the negotiation is running on, with open dimensions marked", () => {
    // The checklist IS the process: three pre-registered dimensions, what each
    // currently scores, and which ones are still open — the open ones being
    // exactly what the agent may come back and ask about.
    const groups = normalizeNegotiationActivity([{
      correspondentUserId: "ada",
      correspondentLabel: "Ada's agent",
      correspondentAvatar: null,
      checklist: [
        { name: "Mutual want", kind: "mutual_want", result: "ok", basis: "both intents say so" },
        { name: "Weekday availability", kind: "fit", result: "unknown", basis: "" },
        { name: "Ticket size", kind: "hard_constraint", result: "conflict", basis: "they stated pre-seed only" },
      ],
      messages: [{
        id: "m-1",
        opportunityId: "opp-1",
        sender: "yours" as const,
        action: "ask_user",
        text: "What grade do you climb, and can you make weeknights?",
        parts: [],
        createdAt: "2026-07-24T00:00:01.000Z",
      }],
    }]);
    render(<NegotiationActivity groups={groups} loading={false} error={false} />);

    expect(screen.getByText(/3 dimensions/)).toBeTruthy();
    expect(screen.getByText(/1 conflicting/)).toBeTruthy();
    expect(screen.getByText(/1 open/)).toBeTruthy();
    expect(screen.getByText("Mutual want")).toBeTruthy();
    expect(screen.getByText("Weekday availability")).toBeTruthy();
    // The turn renders through its own message field, and its action is labelled.
    expect(screen.getByText("ASKED YOU")).toBeTruthy();
    expect(screen.getByText(/What grade do you climb/)).toBeTruthy();
  });

  it("renders a negotiation with no checklist yet without inventing one", () => {
    const groups = normalizeNegotiationActivity([{
      correspondentUserId: "ada",
      correspondentLabel: "Ada's agent",
      correspondentAvatar: null,
      messages: [{
        id: "m-1",
        opportunityId: "opp-1",
        sender: "theirs" as const,
        text: "Reaching out.",
        parts: [],
        createdAt: "2026-07-24T00:00:01.000Z",
      }],
    }]);
    render(<NegotiationActivity groups={groups} loading={false} error={false} />);

    expect(screen.getByText("Reaching out.")).toBeTruthy();
    expect(screen.queryByLabelText("Match checklist")).toBeNull();
  });

  it("does not fabricate messages while activity is empty", () => {
    render(<NegotiationActivity groups={[]} loading={false} error={false} />);
    expect(screen.getByText(/No agent conversations have started yet/)).toBeTruthy();
    expect(screen.queryByText(/message 1/)).toBeNull();
  });

  it("filters non-displayable records before latest-three and removes empty correspondent groups", () => {
    const groups = normalizeNegotiationActivity([
      {
        correspondentUserId: "ada",
        correspondentLabel: "Ada's agent",
        correspondentAvatar: null,
        messages: [
          ...messages,
          {
            id: "tool-only",
            opportunityId: "opp-1",
            sender: "theirs",
            parts: [{ type: "tool-call" }],
            createdAt: "2026-07-24T00:00:05.000Z",
          },
        ],
      },
      {
        correspondentUserId: "empty",
        correspondentLabel: "Empty agent",
        correspondentAvatar: null,
        messages: [{
          id: "empty-tool",
          opportunityId: "opp-empty",
          sender: "theirs",
          parts: [{ type: "tool-call" }],
          createdAt: "2026-07-24T00:00:06.000Z",
        }],
      },
    ]);

    render(<NegotiationActivity groups={groups} loading={false} error={false} />);

    expect(screen.queryByRole("region", { name: "Negotiation with Empty agent" })).toBeNull();
    expect(screen.queryByText("message 1")).toBeNull();
    expect(screen.getAllByText(/message [234]/).map((node) => node.textContent))
      .toEqual(["message 2", "message 3", "message 4"]);
  });
});
