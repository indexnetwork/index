import { config } from "dotenv";
import { describe, expect, test } from "bun:test";

import type { ActiveIntent, CreatedIntent, CreateIntentData, IntentGraphDatabase, UpdateIntentData } from "../../platform/database.js";
import type { EmbeddingGenerator } from "../../platform/discovery/embedder.js";
import type { IntentGraphQueue } from "../../platform/runtime/queue.js";
import { Intents } from "../intents.js";

// This spec is intentionally a live evaluation. Package scripts execute from
// packages/protocol, while credentials live at the repository root.
config({ path: new URL("../../../../../.env.test", import.meta.url).pathname, override: true });

const HAS_OPENROUTER_KEY = Boolean(process.env.OPENROUTER_API_KEY);

const USER_ID = "alice";
const NETWORK_ID = "network-1";

const CO_FOUNDER_SIGNAL =
  "I am looking for an ML engineer to co-found my New York developer-tools company; I want to start working together this quarter.";
const UPDATED_SIGNAL =
  "I am looking for an ML engineer with production LLM experience to co-found my New York developer-tools company, starting in October.";
const VAGUE_SIGNAL = "I want a job.";

/** In-memory host implementing the ports the intent graph uses. No profile text or premises reach the model. */
class FakeIntentHost {
  readonly intents: Array<CreatedIntent & { archivedAt: Date | null; embedding?: number[] }> = [];
  readonly hydeJobs: Array<
    | { kind: "generate"; data: Parameters<IntentGraphQueue["addGenerateHydeJob"]>[0] }
    | { kind: "delete"; data: Parameters<IntentGraphQueue["addDeleteHydeJob"]>[0] }
  > = [];
  readonly embedded: string[] = [];
  private idCounter = 0;

  private active(): ActiveIntent[] {
    return this.intents
      .filter((intent) => !intent.archivedAt)
      .map(({ id, payload, summary, createdAt }) => ({ id, payload, summary, createdAt }));
  }

  readonly database = {
    getUser: async (id: string) => ({ id, name: "Alice", email: "alice@example.com", socials: [] }),
    getActiveIntents: async () => this.active(),
    getActiveIntentsAcrossIndexes: async () => this.active(),
    getIntentsInIndexForMember: async () => this.active(),
    getNetworkIntentsForMember: async () => this.active().map((intent) => ({ ...intent, userId: USER_ID, userName: "Alice" })),
    isNetworkMember: async () => true,
    createIntent: async (data: CreateIntentData) => {
      const intent = {
        id: `intent-${++this.idCounter}`,
        userId: data.userId,
        payload: data.payload,
        summary: null,
        isIncognito: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        embedding: data.embedding,
      };
      this.intents.push(intent);
      return intent;
    },
    updateIntent: async (id: string, data: UpdateIntentData) => {
      const intent = this.intents.find((candidate) => candidate.id === id && !candidate.archivedAt);
      if (!intent) return null;
      if (data.payload !== undefined) intent.payload = data.payload;
      intent.embedding = data.embedding;
      intent.updatedAt = new Date();
      return intent;
    },
    archiveIntent: async (id: string) => {
      const intent = this.intents.find((candidate) => candidate.id === id && !candidate.archivedAt);
      if (!intent) return { success: false, error: "Intent not found" };
      intent.archivedAt = new Date();
      return { success: true };
    },
    deleteIntentIndexAssociations: async () => {},
    expireOpportunitiesByIntentActor: async () => 0,
  } as unknown as IntentGraphDatabase;

  readonly embedder: EmbeddingGenerator = {
    generate: async (text) => {
      this.embedded.push(String(text));
      return Array.from({ length: 8 }, (_, i) => i / 8);
    },
  };

  readonly queue: IntentGraphQueue = {
    addGenerateHydeJob: async (data) => { this.hydeJobs.push({ kind: "generate", data }); },
    addDeleteHydeJob: async (data) => { this.hydeJobs.push({ kind: "delete", data }); },
  };

  graph() {
    return new Intents({ database: this.database, embedder: this.embedder, queue: this.queue }).createGraph();
  }
}

/** Graph input shared by every case: a user id and nothing about the user. */
const base = { userId: USER_ID, userProfile: "" };

// ─── Readable transcript output ──────────────────────────────────────────────
const paint = (code: string) => (text: string) => (Bun.enableANSIColors ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = paint("1"), dim = paint("2"), cyan = paint("36"), green = paint("32"), magenta = paint("35"), yellow = paint("33");

function render(value: unknown, indent: string): string {
  if (typeof value === "string") return green(value);
  if (typeof value === "number") return magenta(String(value));
  if (Array.isArray(value) && value.length === 0) return dim("none");
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => `\n${indent}${dim("•")} ${green(item)}`).join("");
  }
  return dim(JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`));
}

/** Prints one graph call as `→ in` / `← out` so the live run reads as a transcript. */
function show(step: string, input: string, output: Record<string, unknown>): void {
  const width = Math.max("in".length, ...Object.keys(output).map((key) => key.length));
  const lines = [
    `\n${bold(cyan(`▶ ${step}`))}`,
    `  ${yellow("→")} ${dim("in".padEnd(width))}  ${input}`,
    ...Object.entries(output).map(([key, value]) => `  ${cyan("←")} ${dim(key.padEnd(width))}  ${render(value, " ".repeat(width + 6))}`),
  ];
  console.info(lines.join("\n"));
}

describe.skipIf(!HAS_OPENROUTER_KEY)("Intents graph — signal lifecycle (live)", () => {
  test("creates, reads, updates and deletes one signal", async () => {
    const host = new FakeIntentHost();
    const graph = host.graph();
    const scoped = { ...base, scopeType: "network" as const, scopeId: NETWORK_ID };

    // Create: infer → verify → reconcile → execute.
    const created = await graph.invoke({ ...scoped, inputContent: CO_FOUNDER_SIGNAL });
    show("create", CO_FOUNDER_SIGNAL, {
      classification: created.verifiedIntents[0]?.verification?.classification,
      persisted: host.intents[0]?.payload,
      trace: created.trace.map((entry) => entry.detail),
      failures: created.validationFailures,
    });
    expect(created.error).toBeUndefined();
    expect(created.verifiedIntents.length).toBeGreaterThan(0);
    expect(created.verifiedIntents[0].verification?.classification).toMatch(/COMMISSIVE|DIRECTIVE/);
    expect(created.executionResults).toEqual([
      expect.objectContaining({ actionType: "create", success: true, intentId: "intent-1" }),
    ]);
    expect(host.intents[0]).toMatchObject({ userId: USER_ID, embedding: expect.any(Array) });
    expect(host.embedded).toEqual([host.intents[0].payload]);
    expect(host.hydeJobs).toEqual([
      { kind: "generate", data: { intentId: "intent-1", userId: USER_ID, scopeType: "network", scopeId: NETWORK_ID } },
    ]);

    // Read: fast path, no model calls.
    const read = await graph.invoke({ ...scoped });
    show("read", `network ${NETWORK_ID}`, { intents: read.readResult?.intents });
    expect(read.readResult).toMatchObject({ count: 1, intents: [{ id: "intent-1", description: host.intents[0].payload }] });

    // Update: bound to the explicit target.
    const updated = await graph.invoke({ ...scoped, targetIntentIds: ["intent-1"], inputContent: UPDATED_SIGNAL });
    show("update intent-1", UPDATED_SIGNAL, {
      persisted: host.intents[0].payload,
      trace: updated.trace.map((entry) => entry.detail),
      failures: updated.validationFailures,
    });
    expect(updated.executionResults).toEqual([
      expect.objectContaining({ actionType: "update", success: true, intentId: "intent-1" }),
    ]);
    expect(host.intents[0].payload).toBe(updated.executionResults[0].payload!);
    expect(host.intents[0].payload).toMatch(/LLM|October/i);
    expect(host.hydeJobs).toHaveLength(2);

    // Delete: expire without inference or verification.
    const deleted = await graph.invoke({ ...scoped, archive: true, targetIntentIds: ["intent-1"] });
    show("delete intent-1", "(no content; explicit target)", { executionResults: deleted.executionResults, hydeJob: host.hydeJobs.at(-1) });
    expect(deleted.executionResults).toEqual([{ actionType: "expire", success: true, intentId: "intent-1", error: undefined }]);
    expect(host.intents[0].archivedAt).toBeInstanceOf(Date);
    expect(host.hydeJobs.at(-1)).toEqual({ kind: "delete", data: { intentId: "intent-1" } });

    const readAfterDelete = await graph.invoke({ ...scoped });
    show("read after delete", `network ${NETWORK_ID}`, { intents: readAfterDelete.readResult?.intents });
    expect(readAfterDelete.readResult).toMatchObject({ count: 0, intents: [] });
  }, 180_000);

  test.concurrent("proposes a signal without persisting it", async () => {
    const host = new FakeIntentHost();
    const result = await host.graph().invoke({ ...base, dryRun: true, inputContent: CO_FOUNDER_SIGNAL });
    show("propose", CO_FOUNDER_SIGNAL, {
      proposed: result.verifiedIntents.map((intent) => intent.description),
      persisted: host.intents.length,
      trace: result.trace.map((entry) => entry.detail),
    });

    expect(result.verifiedIntents.length).toBeGreaterThan(0);
    expect(result.actions).toEqual([]);
    expect(result.executionResults).toEqual([]);
    expect(host.intents).toEqual([]);
    expect(host.hydeJobs).toEqual([]);
  }, 120_000);

  test.concurrent("rejects a vague utterance instead of persisting it", async () => {
    const host = new FakeIntentHost();
    const result = await host.graph().invoke({ ...base, inputContent: VAGUE_SIGNAL });
    show("create (vague)", VAGUE_SIGNAL, {
      inferred: result.inferredIntents.map((intent) => intent.description),
      failures: result.validationFailures,
      persisted: host.intents.length,
    });

    expect(result.executionResults).toEqual([]);
    expect(host.intents).toEqual([]);
    if (result.inferredIntents.length > 0) {
      expect(result.validationFailures.map((failure) => failure.category)).toContainEqual(expect.stringMatching(/vague_or_invalid|non_actionable/));
    }
  }, 120_000);
});
