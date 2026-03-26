/**
 * Unit tests for IntegrationController.
 * Tests ownership verification on disconnect, basic list/connect flows,
 * and index-scoped link/unlink/import operations.
 */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeEach } from "bun:test";
import { IntegrationController } from "../integration.controller";
import type { AuthenticatedUser } from "../../guards/auth.guard";
import type { IntegrationAdapter, IntegrationConnection, IntegrationSession } from "../../lib/protocol/interfaces/integration.interface";
import { IntegrationService } from "../../services/integration.service";
import type { ChatDatabaseAdapter } from "../../adapters/database.adapter";

const USER_A: AuthenticatedUser = { id: "user-a", email: "a@test.com", name: "User A" };
const USER_B: AuthenticatedUser = { id: "user-b", email: "b@test.com", name: "User B" };

const INDEX_OWNED = "index-owned-by-a";
const INDEX_NOT_OWNED = "index-not-owned";

const CONNECTIONS: Record<string, IntegrationConnection[]> = {
  "user-a": [
    { id: "conn-1", toolkit: "gmail", status: "active", createdAt: "2026-01-01T00:00:00Z" },
    { id: "conn-2", toolkit: "slack", status: "active", createdAt: "2026-01-02T00:00:00Z" },
  ],
  "user-b": [
    { id: "conn-3", toolkit: "gmail", status: "active", createdAt: "2026-01-03T00:00:00Z" },
  ],
};

const disconnected: string[] = [];
const linkedIntegrations: Array<{ indexId: string; toolkit: string; connectedAccountId: string }> = [];
const bulkAdded: Array<{ indexId: string; userIds: string[] }> = [];

const mockAdapter: IntegrationAdapter = {
  async createSession() {
    return {} as IntegrationSession;
  },
  async executeToolAction() {
    return { successful: true, data: { connections: [] } };
  },
  async listConnections(userId: string) {
    return CONNECTIONS[userId] ?? [];
  },
  async getAuthUrl(_userId: string, _toolkit: string, _callbackUrl?: string) {
    return { redirectUrl: "https://oauth.example.com/auth" };
  },
  async disconnect(connectedAccountId: string) {
    disconnected.push(connectedAccountId);
    return { success: true };
  },
};

const mockDb = {
  deleteIndexIntegrationsByConnectedAccount: async () => {},
  getIndexIntegrations: async (indexId: string) =>
    linkedIntegrations.filter(l => l.indexId === indexId),
  insertIndexIntegration: async (indexId: string, toolkit: string, connectedAccountId: string) => {
    linkedIntegrations.push({ indexId, toolkit, connectedAccountId });
  },
  deleteIndexIntegration: async (indexId: string, toolkit: string) => {
    const idx = linkedIntegrations.findIndex(l => l.indexId === indexId && l.toolkit === toolkit);
    if (idx !== -1) linkedIntegrations.splice(idx, 1);
  },
  isIndexOwner: async (indexId: string, userId: string) => {
    return indexId === INDEX_OWNED && userId === "user-a";
  },
  isPersonalIndex: async () => false,
  addMembersBulkToIndex: async (indexId: string, userIds: string[]) => {
    bulkAdded.push({ indexId, userIds });
  },
} as unknown as ChatDatabaseAdapter;

describe("IntegrationController", () => {
  const service = new IntegrationService(mockAdapter, mockDb);
  const controller = new IntegrationController(mockAdapter, service);

  beforeEach(() => {
    disconnected.length = 0;
    linkedIntegrations.length = 0;
    bulkAdded.length = 0;
  });

  describe("GET / (list)", () => {
    test("should return connections for the authenticated user", async () => {
      const req = new Request("http://test/api/integrations");
      const result = await controller.list(req, USER_A);

      const data = result as { connections: IntegrationConnection[] };
      expect(data.connections).toHaveLength(2);
      expect(data.connections[0].id).toBe("conn-1");
    });

    test("should return empty list for user with no connections", async () => {
      const req = new Request("http://test/api/integrations");
      const noConnectionsUser: AuthenticatedUser = { id: "user-none", email: "none@test.com", name: "No Connections" };
      const result = await controller.list(req, noConnectionsUser);

      const data = result as { connections: IntegrationConnection[] };
      expect(data.connections).toHaveLength(0);
    });
  });

  describe("POST /connect/:toolkit (connect)", () => {
    test("should return a redirect URL for allowed toolkit", async () => {
      const req = new Request("http://test/api/integrations/connect/gmail", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      });
      const result = await controller.connect(req, USER_A, { toolkit: "gmail" });

      const data = result as { redirectUrl: string };
      expect(data.redirectUrl).toBe("https://oauth.example.com/auth");
    });

    test("should return 400 for unsupported toolkit", async () => {
      const req = new Request("http://test/api/integrations/connect/evilkit", {
        method: "POST",
      });
      const result = await controller.connect(req, USER_A, { toolkit: "evilkit" });

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Unsupported toolkit");
    });
  });

  describe("POST /:toolkit/link", () => {
    test("should link toolkit to an owned index", async () => {
      const req = new Request("http://test/api/integrations/gmail/link", {
        method: "POST",
        body: JSON.stringify({ indexId: INDEX_OWNED }),
        headers: { "Content-Type": "application/json" },
      });
      const result = await controller.link(req, USER_A, { toolkit: "gmail" });

      const data = result as { success: boolean };
      expect(data.success).toBe(true);
      expect(linkedIntegrations).toHaveLength(1);
      expect(linkedIntegrations[0].indexId).toBe(INDEX_OWNED);
      expect(linkedIntegrations[0].toolkit).toBe("gmail");
    });

    test("should return 400 when user is not index owner", async () => {
      const req = new Request("http://test/api/integrations/gmail/link", {
        method: "POST",
        body: JSON.stringify({ indexId: INDEX_NOT_OWNED }),
        headers: { "Content-Type": "application/json" },
      });
      const result = await controller.link(req, USER_A, { toolkit: "gmail" });

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Access denied");
    });

    test("should return 400 when indexId is missing", async () => {
      const req = new Request("http://test/api/integrations/gmail/link", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });
      const result = await controller.link(req, USER_A, { toolkit: "gmail" });

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("indexId is required");
    });

    test("should return 400 for unsupported toolkit", async () => {
      const req = new Request("http://test/api/integrations/evilkit/link", {
        method: "POST",
        body: JSON.stringify({ indexId: INDEX_OWNED }),
        headers: { "Content-Type": "application/json" },
      });
      const result = await controller.link(req, USER_A, { toolkit: "evilkit" });

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /:toolkit/link (unlink)", () => {
    test("should unlink toolkit from an owned index", async () => {
      linkedIntegrations.push({ indexId: INDEX_OWNED, toolkit: "gmail", connectedAccountId: "conn-1" });

      const req = new Request(`http://test/api/integrations/gmail/link?indexId=${INDEX_OWNED}`, {
        method: "DELETE",
      });
      const result = await controller.unlink(req, USER_A, { toolkit: "gmail" });

      const data = result as { success: boolean };
      expect(data.success).toBe(true);
      expect(linkedIntegrations).toHaveLength(0);
    });

    test("should return 400 when user is not index owner", async () => {
      const req = new Request(`http://test/api/integrations/gmail/link?indexId=${INDEX_NOT_OWNED}`, {
        method: "DELETE",
      });
      const result = await controller.unlink(req, USER_A, { toolkit: "gmail" });

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Access denied");
    });

    test("should return 400 when indexId query param is missing", async () => {
      const req = new Request("http://test/api/integrations/gmail/link", {
        method: "DELETE",
      });
      const result = await controller.unlink(req, USER_A, { toolkit: "gmail" });

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("indexId query param is required");
    });
  });

  describe("POST /:toolkit/import", () => {
    test("should return 400 for unsupported toolkit", async () => {
      const req = new Request("http://test/api/integrations/evilkit/import", {
        method: "POST",
        body: JSON.stringify({ indexId: INDEX_OWNED }),
        headers: { "Content-Type": "application/json" },
      });
      const result = await controller.importContacts(req, USER_A, { toolkit: "evilkit" });

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(400);
    });

    test("should import contacts for an owned non-personal index", async () => {
      const req = new Request("http://test/api/integrations/gmail/import", {
        method: "POST",
        body: JSON.stringify({ indexId: INDEX_OWNED }),
        headers: { "Content-Type": "application/json" },
      });
      const result = await controller.importContacts(req, USER_A, { toolkit: "gmail" });

      const data = result as { imported: number; skipped: number };
      expect(data).toHaveProperty("imported");
      expect(data).toHaveProperty("skipped");
    });

    test("should return 400 for an index the user does not own", async () => {
      const req = new Request("http://test/api/integrations/gmail/import", {
        method: "POST",
        body: JSON.stringify({ indexId: INDEX_NOT_OWNED }),
        headers: { "Content-Type": "application/json" },
      });
      const result = await controller.importContacts(req, USER_A, { toolkit: "gmail" });

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Access denied");
    });
  });

  describe("DELETE /:id (disconnect)", () => {
    test("should disconnect own connection", async () => {
      const req = new Request("http://test/api/integrations/conn-1", { method: "DELETE" });
      const result = await controller.disconnect(req, USER_A, { id: "conn-1" });

      expect(result).not.toBeInstanceOf(Response);
      const data = result as { success: boolean };
      expect(data.success).toBe(true);
      expect(disconnected).toContain("conn-1");
    });

    test("should return 404 when disconnecting another user's connection", async () => {
      const req = new Request("http://test/api/integrations/conn-1", { method: "DELETE" });
      const result = await controller.disconnect(req, USER_B, { id: "conn-1" });

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(404);
      expect(disconnected).toHaveLength(0);
    });

    test("should return 404 for non-existent connection", async () => {
      const req = new Request("http://test/api/integrations/conn-999", { method: "DELETE" });
      const result = await controller.disconnect(req, USER_A, { id: "conn-999" });

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(404);
      expect(disconnected).toHaveLength(0);
    });
  });
});
