import { describe, expect, spyOn, test } from "bun:test";

import type { NetworkGraphDatabase } from "../../shared/interfaces/database.interface.js";

import { NetworkGraphFactory } from "../../communities/application/index.js";

const networkId = "11111111-1111-4111-8111-111111111111";
const rollbackError = new Error("rollback failed with a secret that must not be logged");

function createGraph(database: Pick<NetworkGraphDatabase, "createNetwork" | "addMemberToNetwork" | "softDeleteNetwork">) {
  return new NetworkGraphFactory(database as NetworkGraphDatabase).createGraph();
}

describe("NetworkGraphFactory create rollback failures", () => {
  test("keeps the owner-membership failure response when its orphan cleanup fails", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const graph = createGraph({
        createNetwork: async () => ({ id: networkId, title: "Network" }) as never,
        addMemberToNetwork: async () => ({ success: false }),
        softDeleteNetwork: async () => { throw rollbackError; },
      });

      const result = await graph.invoke({
        userId: "user-1",
        operationMode: "create",
        createInput: { title: "Network", prompt: "private prompt" },
      });

      expect(result.mutationResult).toEqual({
        success: false,
        error: "Failed to set you as owner. Network was not created.",
      });
      expect(errorSpy).toHaveBeenCalledWith("[NetworkGraphFactory]", "Network create rollback failed", {
        networkId,
        rollbackFor: "owner_membership",
        rollbackErrorKind: "error",
      });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("private prompt");
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(rollbackError.message);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("keeps the create failure response when its cleanup fails", async () => {
    const primaryError = new Error("primary create failure");
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const graph = createGraph({
        createNetwork: async () => ({ id: networkId, title: "Network" }) as never,
        addMemberToNetwork: async () => { throw primaryError; },
        softDeleteNetwork: async () => { throw rollbackError; },
      });

      const result = await graph.invoke({
        userId: "user-1",
        operationMode: "create",
        createInput: { title: "Network", prompt: "private prompt" },
      });

      expect(result.mutationResult).toEqual({
        success: false,
        error: primaryError.message,
      });
      expect(errorSpy).toHaveBeenCalledWith("[NetworkGraphFactory]", "Network create rollback failed", {
        networkId,
        rollbackFor: "create_operation",
        rollbackErrorKind: "error",
      });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("private prompt");
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(rollbackError.message);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
