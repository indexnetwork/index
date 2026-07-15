/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";

import { UserController } from "../user.controller";
import { UserDatabaseAdapter, conversationDatabaseAdapter } from "../../adapters/database.adapter";
import db from "../../lib/drizzle/drizzle";
import { artifacts, messages, tasks } from "../../schemas/database.schema";
import type { AuthenticatedUser } from "../../guards/auth.guard";

describe("UserController Integration", () => {
  const controller = new UserController();
  const userAdapter = new UserDatabaseAdapter();
  let testUserId: string;
  const testEmail = `test-user-controller-${Date.now()}@example.com`;

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(testEmail);
    if (existingUser) await userAdapter.deleteByEmail(testEmail);

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test User Controller",
      intro: "Intro",
      location: "City",
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    if (testUserId) await userAdapter.deleteById(testUserId);
  });

  const mockAuthUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: testEmail,
    name: "Test User Controller",
  });

  describe("GET /:userId", () => {
    test("should return 200 and user when userId exists", async () => {
      const req = new Request("http://localhost/users/" + testUserId);
      const res = await controller.getUser(req, mockAuthUser(), { userId: testUserId });
      const data = await res.json() as { user?: { id: string; name: string }; error?: string };

      expect(res.status).toBe(200);
      expect(data.user).toBeDefined();
      expect(data.user!.id).toBe(testUserId);
      expect(data.user!.name).toBe("Test User Controller");
    });

    test("should return 404 when userId does not exist", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const req = new Request("http://localhost/users/" + fakeId);
      const res = await controller.getUser(req, mockAuthUser(), { userId: fakeId });
      const data = await res.json() as { error?: string };

      expect(res.status).toBe(404);
      expect(data.error).toBe("User not found");
    });
  });

  describe("GET /:userId/negotiations", () => {
    test("stitches continuation segments and paginates complete opportunity threads", async () => {
      const run = Date.now();
      const counterparty = await userAdapter.create({
        email: `test-negotiation-thread-${run}@example.com`,
        name: "Thread Counterparty",
      });
      const conversation = await conversationDatabaseAdapter.createConversation([
        { participantId: `agent:${testUserId}`, participantType: "agent" },
        { participantId: `agent:${counterparty.id}`, participantType: "agent" },
      ]);

      const sharedOpportunityId = crypto.randomUUID();
      const otherOpportunityId = crypto.randomUUID();
      const oldTaskId = crypto.randomUUID();
      const currentTaskId = crypto.randomUUID();
      const otherTaskId = crypto.randomUUID();
      const fallbackTaskOneId = crypto.randomUUID();
      const fallbackTaskTwoId = crypto.randomUUID();
      const oldCreatedAt = new Date("2026-01-01T10:00:00.000Z");
      const currentCreatedAt = new Date("2026-01-05T10:00:00.000Z");
      const currentUpdatedAt = new Date("2026-01-05T11:00:00.000Z");
      const currentStatusTimestamp = new Date("2026-01-05T10:30:00.000Z");
      const tiedMessageCreatedAt = new Date("2026-01-05T10:05:00.000Z");
      const metadata = {
        type: "negotiation",
        sourceUserId: testUserId,
        candidateUserId: counterparty.id,
      };

      try {
        await db.insert(tasks).values([
          {
            id: oldTaskId,
            conversationId: conversation.id,
            state: "completed",
            metadata: { ...metadata, opportunityId: sharedOpportunityId },
            createdAt: oldCreatedAt,
            updatedAt: new Date("2026-01-01T11:00:00.000Z"),
          },
          {
            id: currentTaskId,
            conversationId: conversation.id,
            state: "completed",
            statusMessage: { phase: "resumed-complete" },
            statusTimestamp: currentStatusTimestamp,
            metadata: { ...metadata, opportunityId: sharedOpportunityId, isContinuation: true, priorTurnCount: 1 },
            createdAt: currentCreatedAt,
            updatedAt: currentUpdatedAt,
          },
          {
            id: otherTaskId,
            conversationId: conversation.id,
            state: "working",
            metadata: { ...metadata, opportunityId: otherOpportunityId },
            createdAt: new Date("2026-01-04T10:00:00.000Z"),
            updatedAt: new Date("2026-01-04T11:00:00.000Z"),
          },
          {
            id: fallbackTaskOneId,
            conversationId: conversation.id,
            state: "submitted",
            metadata,
            createdAt: new Date("2026-01-03T10:00:00.000Z"),
            updatedAt: new Date("2026-01-03T11:00:00.000Z"),
          },
          {
            id: fallbackTaskTwoId,
            conversationId: conversation.id,
            state: "submitted",
            metadata,
            createdAt: new Date("2026-01-02T10:00:00.000Z"),
            updatedAt: new Date("2026-01-02T11:00:00.000Z"),
          },
        ]);

        await db.insert(messages).values([
          {
            conversationId: conversation.id,
            taskId: currentTaskId,
            senderId: `agent:${counterparty.id}`,
            role: "agent",
            parts: [{ kind: "data", data: { action: "accept", assessment: { reasoning: "Accepted after resuming" } } }],
            createdAt: tiedMessageCreatedAt,
          },
          {
            conversationId: conversation.id,
            taskId: oldTaskId,
            senderId: `agent:${testUserId}`,
            role: "agent",
            parts: [{ kind: "data", data: { action: "outreach", assessment: { reasoning: "Original outreach opener" } } }],
            createdAt: tiedMessageCreatedAt,
          },
        ]);

        await db.insert(artifacts).values([
          {
            taskId: oldTaskId,
            name: "negotiation-outcome",
            parts: [{ kind: "data", data: { hasOpportunity: false, turnCount: 1, reason: "turn_cap" } }],
          },
          {
            taskId: currentTaskId,
            name: "negotiation-outcome",
            parts: [{ kind: "data", data: { hasOpportunity: false, turnCount: 1, reason: "duplicate_older_artifact" } }],
            createdAt: new Date("2026-01-05T10:10:00.000Z"),
          },
          {
            taskId: currentTaskId,
            name: "negotiation-outcome",
            parts: [{ kind: "data", data: { hasOpportunity: true, turnCount: 2, reason: "accepted_after_resume" } }],
            createdAt: new Date("2026-01-05T10:20:00.000Z"),
          },
        ]);

        type NegotiationDto = {
          id: string;
          segments: number;
          state: string;
          statusMessage: { phase?: string } | null;
          statusTimestamp: string | null;
          outcome: { hasOpportunity: boolean; turnCount: number; reason?: string } | null;
          turns: Array<{ action: string; reasoning: string; createdAt: string }>;
          createdAt: string;
          updatedAt: string;
        };
        const getPage = async (limit: number, offset: number) => {
          const request = new Request(`http://localhost/users/${testUserId}/negotiations?limit=${limit}&offset=${offset}`);
          const response = await controller.getNegotiations(request, mockAuthUser(), { userId: testUserId });
          expect(response.status).toBe(200);
          return (await response.json() as { negotiations: NegotiationDto[] }).negotiations;
        };

        const allThreads = await getPage(50, 0);
        expect(allThreads).toHaveLength(4);

        const stitched = allThreads.find((thread) => thread.id === currentTaskId);
        expect(stitched).toBeDefined();
        expect(stitched?.segments).toBe(2);
        expect(stitched?.turns.map((turn) => turn.action)).toEqual(["outreach", "accept"]);
        expect(stitched?.turns.map((turn) => turn.reasoning)).toEqual(["Original outreach opener", "Accepted after resuming"]);
        expect(stitched?.state).toBe("completed");
        expect(stitched?.statusMessage).toEqual({ phase: "resumed-complete" });
        expect(stitched?.statusTimestamp).toBe(currentStatusTimestamp.toISOString());
        expect(stitched?.outcome).toEqual({ hasOpportunity: true, role: null, turnCount: 2, reason: "accepted_after_resume" });
        expect(stitched?.createdAt).toBe(currentCreatedAt.toISOString());
        expect(stitched?.updatedAt).toBe(currentUpdatedAt.toISOString());
        expect(allThreads.some((thread) => thread.id === oldTaskId)).toBe(false);

        expect(allThreads.some((thread) => thread.id === otherTaskId)).toBe(true);
        expect(allThreads.find((thread) => thread.id === fallbackTaskOneId)?.segments).toBe(1);
        expect(allThreads.find((thread) => thread.id === fallbackTaskTwoId)?.segments).toBe(1);

        const firstPage = await getPage(2, 0);
        const secondPage = await getPage(2, 2);
        expect([...firstPage, ...secondPage].map((thread) => thread.id)).toEqual(allThreads.map((thread) => thread.id));
      } finally {
        await conversationDatabaseAdapter.deleteConversation(conversation.id);
        await userAdapter.deleteById(counterparty.id);
      }
    }, 30000);
  });
});
