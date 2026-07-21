import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ apiClient: { get: mocks.get, post: mocks.post } }));

import { confirmAgentActionProposal, getAgentActionProposal } from "./agent-actions";

describe("confirmAgentActionProposal", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.post.mockReset();
  });

  it("uses the owner-scoped proposal endpoint", async () => {
    const proposalId = "11111111-1111-4111-8111-111111111111";
    const response = { success: true, proposalId, status: "pending", actions: [], results: null };
    mocks.get.mockResolvedValue(response);

    await expect(getAgentActionProposal(proposalId)).resolves.toEqual(response);
    expect(mocks.get).toHaveBeenCalledWith(`/agent/actions/proposals/${proposalId}`);
  });

  it("uses the session confirmation endpoint and exact body", async () => {
    const response = {
      success: true,
      proposalId: "11111111-1111-4111-8111-111111111111",
      status: "replayed",
      results: [],
    };
    mocks.post.mockResolvedValue(response);

    await expect(confirmAgentActionProposal(response.proposalId)).resolves.toEqual(response);
    expect(mocks.post).toHaveBeenCalledWith("/agent/actions/confirm", { proposalId: response.proposalId });
  });
});
