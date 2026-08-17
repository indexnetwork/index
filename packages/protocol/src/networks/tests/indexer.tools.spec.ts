import { describe, expect, test } from "bun:test";
import { createIntentTools } from "../../intents/tools/intent.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

type Fixture<T> = T extends (...args: any[]) => unknown ? (...args: any[]) => any : T extends object ? { [K in keyof T]?: Fixture<T[K]> } : T;
type ToolDepsFixture = Fixture<ToolDeps>;

function makeContext(userId = "user-1"): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

function captureTool(name: string, deps: ToolDepsFixture) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string> } | undefined;
  const defineTool = (def: { name: string; handler: (...args: unknown[]) => unknown }) => {
    if (def.name === name) captured = def as typeof captured;
    return def;
  };
  createIntentTools(defineTool as never, deps as ToolDeps);
  return captured!;
}

describe("read_intent_indexes — relevancyScore", () => {
  test("intents_in_network links include relevancyScore", async () => {
    const deps = {
      systemDb: {
        isNetworkMember: async () => true,
        isNetworkOwner: async () => false,
      },
      graphs: {
        intentIndex: {
          invoke: async () => ({
            readResult: {
              links: [
                { intentId: "intent-1", networkId: "net-1", intentTitle: "Find a co-founder", userId: "user-1", userName: "Alice", createdAt: new Date(), relevancyScore: 0.87 },
              ],
              count: 1,
              mode: "intents_in_network",
            },
          }),
        },
      },
    };

    const tool = captureTool("read_intent_indexes", deps);
    const result = JSON.parse(
      await tool.handler({
        context: makeContext("user-1"),
        query: { networkId: "11111111-1111-4111-8111-111111111111" },
      })
    );

    expect(result.success).toBe(true);
    expect(result.data.links[0].relevancyScore).toBe(0.87);
  });
});
