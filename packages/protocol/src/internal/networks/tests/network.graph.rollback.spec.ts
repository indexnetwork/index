import { describe, expect, test } from "bun:test";

import type { NetworkGraphDatabase } from "../../../platform/database.js";

import { NetworkGraphFactory } from "../network.graph.js";
import { setLoggerFactory } from "../../shared/observability/log.js";

const networkId = "11111111-1111-4111-8111-111111111111";
const rollbackError = new Error("rollback failed with a secret that must not be logged");

function createGraph(database: Pick<NetworkGraphDatabase, "createNetwork" | "addMemberToNetwork" | "softDeleteNetwork">) {
  return new NetworkGraphFactory(database as NetworkGraphDatabase).createGraph();
}

describe("NetworkGraphFactory create rollback failures", () => {
  test("keeps the owner-membership failure response when its orphan cleanup fails", async () => {
    const errors: unknown[][] = [];
    setLoggerFactory(() => ({ verbose: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: (message, meta) => errors.push(["[NetworkGraphFactory]", message, meta]) }));
    {
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
      expect(errors).toContainEqual(["[NetworkGraphFactory]", "Network create rollback failed", {
        networkId,
        rollbackFor: "owner_membership",
        rollbackErrorKind: "error",
      }]);
      expect(JSON.stringify(errors)).not.toContain("private prompt");
      expect(JSON.stringify(errors)).not.toContain(rollbackError.message);
    }
  });

  test("keeps the create failure response when its cleanup fails", async () => {
    const primaryError = new Error("primary create failure");
    const errors: unknown[][] = [];
    setLoggerFactory(() => ({ verbose: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: (message, meta) => errors.push(["[NetworkGraphFactory]", message, meta]) }));
    {
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
      expect(errors).toContainEqual(["[NetworkGraphFactory]", "Network create rollback failed", {
        networkId,
        rollbackFor: "create_operation",
        rollbackErrorKind: "error",
      }]);
      expect(JSON.stringify(errors)).not.toContain("private prompt");
      expect(JSON.stringify(errors)).not.toContain(rollbackError.message);
    }
  });
});
