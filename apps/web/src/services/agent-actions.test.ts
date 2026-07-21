import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ apiClient: { post: mocks.post } }));

import { confirmAgentActionProposal } from "./agent-actions";

describe("confirmAgentActionProposal", () => {
  beforeEach(() => mocks.post.mockReset());

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
