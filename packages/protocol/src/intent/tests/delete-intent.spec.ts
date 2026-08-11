import { describe, expect, test } from "bun:test";
import { createIntentTools } from "../../signals/application/intent.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

function makeContext(userId = "user-123"): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" } as any,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

function captureTool(deps: ToolDeps) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string> } | undefined;
  const defineTool = (def: any) => { if (def.name === "delete_intent") captured = def; return def; };
  createIntentTools(defineTool as any, deps);
  return captured!;
}

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";

describe("delete_intent", () => {
  test("returns error when intent does not exist", async () => {
    const deps = {
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getNetworksByScope: async () => [],
        getIntent: async () => null,
      },
      graphs: {
        intent: { invoke: async () => ({ executionResults: [{ success: true }] }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("caller-user"), query: { intentId: VALID_UUID } })
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("own");
  });

  test("returns error when intent belongs to another user", async () => {
    const deps = {
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getNetworksByScope: async () => [],
        getIntent: async () => ({ id: VALID_UUID, userId: "other-user" }),
      },
      graphs: {
        intent: { invoke: async () => ({ executionResults: [{ success: true }] }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("caller-user"), query: { intentId: VALID_UUID } })
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("own");
  });

  test("proceeds when intent belongs to the caller", async () => {
    const deps = {
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getNetworksByScope: async () => [],
        getIntent: async () => ({ id: VALID_UUID, userId: "caller-user" }),
      },
      graphs: {
        intent: { invoke: async () => ({ executionResults: [{ success: true }] }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("caller-user"), query: { intentId: VALID_UUID } })
    );
    expect(result.success).toBe(true);
  });

  test("success message says 'Intent archived successfully.'", async () => {
    const deps = {
      userDb: { getNetworkIdsForIntent: async () => [] },
      systemDb: {
        isNetworkMember: async () => true,
        getNetworksByScope: async () => [],
        getIntent: async () => ({ id: "11111111-1111-4111-8111-111111111111", userId: "caller-user" }),
      },
      graphs: {
        intent: { invoke: async () => ({ executionResults: [{ success: true }], agentTimings: [] }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("caller-user"), query: { intentId: "11111111-1111-4111-8111-111111111111" } })
    );
    expect(result.success).toBe(true);
    expect(result.data.message).toBe("Intent archived successfully.");
  });
});
