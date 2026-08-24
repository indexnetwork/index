/**
 * P5.4 (IND-408) — negotiator memory inspection API, DB-backed integration
 * tests against the test database.
 *
 * Pins the acceptance criteria that live at the API layer:
 * - list/edit/delete with STRICT self-only guards: 403 for any non-self
 *   caller, explicitly including a user who shares a mutual negotiation with
 *   the owner (the neighbor `GET /:userId/negotiations` route deliberately
 *   permits mutuals — memories must not copy that carve-out),
 * - `remember` (write service) → row visible via the API instantly,
 * - `forget` → gone from the next P5.3 injection (retrieval adapter read).
 */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm/sql";

import { UserController } from "../user.controller";
import { UserDatabaseAdapter } from "../../adapters/database.adapter";
import { agentDatabaseAdapter } from "../../adapters/agent.database.adapter";
import { negotiatorMemoryDatabaseAdapter } from "../../adapters/negotiator-memory.database.adapter";
import { negotiatorMemoryRetrievalAdapter } from "../../adapters/negotiator-memory.retrieval.adapter";
import { conversationDatabaseAdapter } from "../../adapters/database.adapter";
import { negotiatorMemoryWriteService } from "../../services/negotiator-memory.service";
import db from "../../lib/drizzle/drizzle";
import { negotiatorMemories } from "../../schemas/database.schema";
import { conversations, tasks } from "../../schemas/conversation.schema";
import type { AuthenticatedUser } from "../../guards/auth.guard";

const testPaid = process.env.RUN_PAID_INTEGRATION_TESTS === '1'
  && process.env.OPENROUTER_API_KEY
  ? test
  : test.skip;

const OWNER_EMAIL = "test-memory-owner@example.com";
const MUTUAL_EMAIL = "test-memory-mutual@example.com";

const BASE = "http://localhost/users";

describe("Negotiator memory inspection API (IND-408)", () => {
  const userAdapter = new UserDatabaseAdapter();
  const controller = new UserController();

  let ownerId: string;
  let mutualId: string;
  let agentId: string;
  let conversationId: string;
  let disclosureId: string;
  let playbookId: string;

  const asUser = (id: string, email: string): AuthenticatedUser => ({ id, email, name: "Memory Test" });
  const owner = () => asUser(ownerId, OWNER_EMAIL);
  const mutual = () => asUser(mutualId, MUTUAL_EMAIL);

  const listReq = (userId: string, qs = "") => new Request(`${BASE}/${userId}/negotiator/memories${qs}`);
  const patchReq = (userId: string, memoryId: string, body: unknown) =>
    new Request(`${BASE}/${userId}/negotiator/memories/${memoryId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });

  beforeAll(async () => {
    for (const email of [OWNER_EMAIL, MUTUAL_EMAIL]) {
      const existing = await userAdapter.findByEmail(email);
      if (existing) await userAdapter.deleteByEmail(email);
    }
    const ownerUser = await userAdapter.create({ email: OWNER_EMAIL, name: "Memory Owner" });
    const mutualUser = await userAdapter.create({ email: MUTUAL_EMAIL, name: "Memory Mutual" });
    ownerId = ownerUser.id;
    mutualId = mutualUser.id;

    const ensured = await agentDatabaseAdapter.ensureNegotiatorAgent(ownerId);
    if (!ensured) throw new Error("Failed to provision negotiator agent");
    agentId = ensured;

    // A real mutual negotiation between owner and the other user — the
    // premise of the "mutuals still get 403" test.
    const [conv] = await db.insert(conversations).values({}).returning();
    conversationId = conv.id;
    await db.insert(tasks).values({
      conversationId,
      metadata: { type: "negotiation", sourceUserId: ownerId, candidateUserId: mutualId },
    });

    const disclosure = await negotiatorMemoryDatabaseAdapter.create({
      agentId,
      userId: ownerId,
      kind: "disclosure_rule",
      content: "Never disclose the client's total budget to counterparties.",
      confidence: 0.9,
      sourceRefs: [{ type: "manual", id: "seed" }],
    });
    const playbook = await negotiatorMemoryDatabaseAdapter.create({
      agentId,
      userId: ownerId,
      kind: "playbook",
      content: "Open with the specific shared-interest angle before discussing scope.",
      confidence: 0.6,
    });
    disclosureId = disclosure.id;
    playbookId = playbook.id;
  }, 60000);

  afterAll(async () => {
    if (agentId) await db.delete(negotiatorMemories).where(eq(negotiatorMemories.agentId, agentId));
    if (conversationId) await db.delete(conversations).where(eq(conversations.id, conversationId));
    const ids = [ownerId, mutualId].filter(Boolean);
    if (ids.length) {
      for (const id of ids) await userAdapter.deleteById(id);
    }
  }, 60000);

  // ─── Self reads ────────────────────────────────────────────────────────────

  test("owner lists their memories (no embedding in the DTO)", async () => {
    const res = await controller.listNegotiatorMemories(listReq(ownerId), owner(), { userId: ownerId });
    expect(res.status).toBe(200);
    const body = await res.json() as { memories: Array<Record<string, unknown>> };
    const ids = body.memories.map((m) => m.id);
    expect(ids).toContain(disclosureId);
    expect(ids).toContain(playbookId);
    for (const m of body.memories) {
      expect(m).not.toHaveProperty("embedding");
      expect(m).toHaveProperty("kind");
      expect(m).toHaveProperty("confidence");
      expect(m).toHaveProperty("sourceRefs");
    }
  });

  test("kind filter narrows the list; invalid kind is a 400", async () => {
    const res = await controller.listNegotiatorMemories(
      listReq(ownerId, "?kind=disclosure_rule"), owner(), { userId: ownerId });
    const body = await res.json() as { memories: Array<{ id: string; kind: string }> };
    expect(body.memories.every((m) => m.kind === "disclosure_rule")).toBe(true);
    expect(body.memories.map((m) => m.id)).toContain(disclosureId);

    const bad = await controller.listNegotiatorMemories(
      listReq(ownerId, "?kind=secrets"), owner(), { userId: ownerId });
    expect(bad.status).toBe(400);
  });

  // ─── Strict self-only guards ───────────────────────────────────────────────

  test("a user with a MUTUAL negotiation still gets 403 on list/patch/delete (no mutual carve-out)", async () => {
    // Premise: the two users genuinely are mutuals by the neighbor route's
    // own definition — the same filter it uses returns their negotiation.
    const mutualRows = await conversationDatabaseAdapter.getNegotiationsByUser(ownerId, { mutualWithUserId: mutualId });
    expect(mutualRows.length).toBeGreaterThan(0);

    const list = await controller.listNegotiatorMemories(listReq(ownerId), mutual(), { userId: ownerId });
    expect(list.status).toBe(403);

    const patch = await controller.updateNegotiatorMemory(
      patchReq(ownerId, disclosureId, { confidence: 0.1 }), mutual(), { userId: ownerId, memoryId: disclosureId });
    expect(patch.status).toBe(403);

    const del = await controller.deleteNegotiatorMemory(
      listReq(ownerId), mutual(), { userId: ownerId, memoryId: disclosureId });
    expect(del.status).toBe(403);

    // Nothing changed under the owner.
    const row = await negotiatorMemoryDatabaseAdapter.getById(disclosureId, ownerId);
    expect(row?.confidence).toBe(0.9);
  });

  // ─── Edits ─────────────────────────────────────────────────────────────────

  testPaid("owner edits content + confidence; content edit re-embeds", async () => {
    const res = await controller.updateNegotiatorMemory(
      patchReq(ownerId, playbookId, { content: "Always anchor on scope before price.", confidence: 0.8 }),
      owner(), { userId: ownerId, memoryId: playbookId });
    expect(res.status).toBe(200);
    const body = await res.json() as { memory: { content: string; confidence: number } };
    expect(body.memory.content).toBe("Always anchor on scope before price.");
    expect(body.memory.confidence).toBe(0.8);

    const row = await negotiatorMemoryDatabaseAdapter.getById(playbookId, ownerId);
    expect(row?.content).toBe("Always anchor on scope before price.");
    expect(row?.embedding).not.toBeNull(); // re-embedded for the new content
  }, 30000);

  test("patch validation: empty body 400, unknown id 404, malformed JSON 400", async () => {
    const empty = await controller.updateNegotiatorMemory(
      patchReq(ownerId, playbookId, {}), owner(), { userId: ownerId, memoryId: playbookId });
    expect(empty.status).toBe(400);

    const unknown = await controller.updateNegotiatorMemory(
      patchReq(ownerId, crypto.randomUUID(), { confidence: 0.5 }),
      owner(), { userId: ownerId, memoryId: crypto.randomUUID() });
    expect(unknown.status).toBe(404);

    const malformed = await controller.updateNegotiatorMemory(
      new Request(`${BASE}/${ownerId}/negotiator/memories/${playbookId}`, { method: "PATCH", body: "not-json" }),
      owner(), { userId: ownerId, memoryId: playbookId });
    expect(malformed.status).toBe(400);
  });

  // ─── remember → visible instantly; forget → gone from next injection ──────

  test("remember in chat → row visible via the API instantly; forget → gone from the next P5.3 injection", async () => {
    const remembered = await negotiatorMemoryWriteService.rememberFromChat({
      userId: ownerId,
      kind: "disclosure_rule",
      content: "Do not reveal the client's current employer in outreach.",
      sessionId: "test-session",
    });
    expect(remembered).not.toBeNull();

    // Visible through the inspection API immediately.
    const res = await controller.listNegotiatorMemories(listReq(ownerId), owner(), { userId: ownerId });
    const body = await res.json() as { memories: Array<{ id: string; content: string; sourceRefs: Array<{ type: string; id: string }> }> };
    const found = body.memories.find((m) => m.id === remembered!.id);
    expect(found).toBeDefined();
    expect(found!.sourceRefs).toEqual([{ type: "chat", id: "test-session" }]);

    // ...and present in the P5.3 chat injection read.
    const before = await negotiatorMemoryRetrievalAdapter.retrieveForChat(ownerId);
    expect(before.some((e) => e.content.includes("current employer"))).toBe(true);

    // Forget by description → deleted...
    const outcome = await negotiatorMemoryWriteService.forgetFromChat({
      userId: ownerId,
      description: "Do not reveal the client's current employer in outreach.",
    });
    expect(outcome.status).toBe("deleted");

    // ...gone from the API and from the NEXT injection read.
    const after = await controller.listNegotiatorMemories(listReq(ownerId), owner(), { userId: ownerId });
    const afterBody = await after.json() as { memories: Array<{ id: string }> };
    expect(afterBody.memories.some((m) => m.id === remembered!.id)).toBe(false);

    const nextInjection = await negotiatorMemoryRetrievalAdapter.retrieveForChat(ownerId);
    expect(nextInjection.some((e) => e.content.includes("current employer"))).toBe(false);
  }, 60000);

  // ─── Owner delete ──────────────────────────────────────────────────────────

  test("owner deletes a memory; second delete is a 404", async () => {
    const res = await controller.deleteNegotiatorMemory(
      listReq(ownerId), owner(), { userId: ownerId, memoryId: playbookId });
    expect(res.status).toBe(200);

    const again = await controller.deleteNegotiatorMemory(
      listReq(ownerId), owner(), { userId: ownerId, memoryId: playbookId });
    expect(again.status).toBe(404);

    const list = await controller.listNegotiatorMemories(listReq(ownerId), owner(), { userId: ownerId });
    const body = await list.json() as { memories: Array<{ id: string }> };
    expect(body.memories.some((m) => m.id === playbookId)).toBe(false);
  });
});
