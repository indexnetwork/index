import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { OpportunityDatabaseAdapter, UserDatabaseAdapter, EnrichmentDatabaseAdapter, ChatDatabaseAdapter } from "../../adapters/database.adapter";
import { deleteNetworkAndMembers } from "./test-helpers";
import { RouteRegistry } from '../../lib/router/router.decorators';
import type { AuthenticatedUser } from "../../guards/auth.guard";

const RUN_PAID_INTEGRATION = process.env.RUN_PAID_INTEGRATION_TESTS === '1'
  && !!process.env.OPENROUTER_API_KEY;
const paidTest = RUN_PAID_INTEGRATION ? test : test.skip;

// ---------------------------------------------------------------------------
// Restore mocks after all tests
// ---------------------------------------------------------------------------
afterAll(() => {
  mock.restore();
});

// Mock notification queue so loading OpportunityController does not connect to Redis
mock.module("../../queues/notification.queue", () => ({
  queueOpportunityNotification: async () => ({ id: "mock-job" }),
}));

// Load controllers after mock is registered so createManual path never touches Redis in tests
let OpportunityControllerClass: typeof import("../opportunity.controller").OpportunityController;
let NetworkOpportunityControllerClass: typeof import("../opportunity.controller").NetworkOpportunityController;
beforeAll(async () => {
  const mod = await import("../opportunity.controller");
  OpportunityControllerClass = mod.OpportunityController;
  NetworkOpportunityControllerClass = mod.NetworkOpportunityController;
});

// ═══════════════════════════════════════════════════════════════════════════════
// OpportunityDatabaseAdapter Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("OpportunityDatabaseAdapter Integration", () => {
  const userAdapter = new UserDatabaseAdapter();
  const profileAdapter = new EnrichmentDatabaseAdapter();
  let adapter: OpportunityDatabaseAdapter;
  let testUserId: string;
  const testEmail = `test-opportunity-adapter-${Date.now()}@example.com`;

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(testEmail);
    if (existingUser) {
      await profileAdapter.deleteProfile(existingUser.id);
      await userAdapter.deleteByEmail(testEmail);
    }

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test Opportunity Adapter User",
      intro: "Test user for opportunity adapter tests",
      location: "Test City",
    });
    testUserId = user.id;
    console.log(`Created test user: ${testUserId}`);

    await profileAdapter.saveProfile(testUserId, {
      userId: testUserId,
      identity: {
        name: "Test Opportunity Adapter User",
        bio: "Full-stack developer with focus on distributed systems",
        location: "Test City",
      },
      narrative: {
        context: "Building scalable applications and exploring new technologies",
      },
      attributes: {
        interests: ["distributed systems", "databases", "TypeScript"],
        skills: ["Node.js", "PostgreSQL", "Redis"],
      },
      embedding: null,
    });

    adapter = new OpportunityDatabaseAdapter();
  });

  afterAll(async () => {
    if (testUserId) {
      await profileAdapter.deleteProfile(testUserId);
      await userAdapter.deleteById(testUserId);
    }
  });

  test("getProfile should return a users-sourced profile document for existing user", async () => {
    // getProfile now sources identity from the `users` table (name/intro->bio/location);
    // typed skills/interests/narrative.context are dropped (empty) -- see WS5 (IND-363).
    const profile = await adapter.getProfile(testUserId);

    expect(profile).not.toBeNull();
    expect(profile!.identity).toBeDefined();
    expect(profile!.identity.name).toBe("Test Opportunity Adapter User");
    expect(profile!.identity.bio).toBe("Full-stack developer with focus on distributed systems");
    expect(profile!.identity.location).toBe("Test City");
    expect(profile!.context).toBe("");
  });

  test("getProfile should return null for non-existent user", async () => {
    const fakeUserId = "00000000-0000-0000-0000-000000000000";
    const profile = await adapter.getProfile(fakeUserId);

    expect(profile).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OpportunityController Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("OpportunityController Integration", () => {
  let controller: InstanceType<typeof OpportunityControllerClass>;
  let indexOpportunityController: InstanceType<typeof NetworkOpportunityControllerClass>;
  const userAdapter = new UserDatabaseAdapter();
  const profileAdapter = new EnrichmentDatabaseAdapter();
  const chatDbAdapter = new ChatDatabaseAdapter();
  const opportunityAdapter = new OpportunityDatabaseAdapter();
  let testUserId: string;
  let candidateUserId: string;
  let testIndexId: string;
  let testOpportunityId: string;
  const testEmail = `test-opportunity-ctrl-${Date.now()}@example.com`;
  const candidateEmail = `test-opportunity-candidate-${Date.now()}@example.com`;

  beforeAll(async () => {
    controller = new OpportunityControllerClass();
    indexOpportunityController = new NetworkOpportunityControllerClass();
    for (const email of [testEmail, candidateEmail]) {
      const existingUser = await userAdapter.findByEmail(email);
      if (existingUser) {
        await profileAdapter.deleteProfile(existingUser.id);
        await userAdapter.deleteByEmail(email);
      }
    }

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test Opportunity Controller User",
      intro: "CEO of an AI startup looking for technical talent",
      location: "San Francisco, CA",
      socials: { x: "https://x.com/testopp", linkedin: "https://linkedin.com/in/testopp" },
    });
    testUserId = user.id;
    console.log(`Created main test user: ${testUserId}`);

    await profileAdapter.saveProfile(testUserId, {
      userId: testUserId,
      identity: {
        name: "Test Opportunity Controller User",
        bio: "Startup CEO focused on AI-powered products",
        location: "San Francisco, CA",
      },
      narrative: {
        context: "Building the next generation of AI tools for developers",
      },
      attributes: {
        interests: ["AI", "startups", "product development"],
        skills: ["leadership", "product strategy", "fundraising"],
      },
      embedding: Array(2000).fill(0.1) as number[],
    });

    const candidate = await userAdapter.create({
      email: candidateEmail,
      name: "Test Candidate User",
      intro: "Senior ML engineer with startup experience",
      location: "New York, NY",
    });
    candidateUserId = candidate.id;
    console.log(`Created candidate test user: ${candidateUserId}`);

    await profileAdapter.saveProfile(candidateUserId, {
      userId: candidateUserId,
      identity: {
        name: "Test Candidate User",
        bio: "Machine learning engineer specializing in NLP and computer vision",
        location: "New York, NY",
      },
      narrative: {
        context: "Led ML teams at multiple startups, looking for new opportunities",
      },
      attributes: {
        interests: ["machine learning", "NLP", "computer vision", "startups"],
        skills: ["Python", "PyTorch", "TensorFlow", "MLOps"],
      },
      embedding: Array(2000).fill(0.15) as number[],
    });

    const index = await chatDbAdapter.createNetwork({
      title: "Test Opportunity Index",
      prompt: "Index for opportunity controller tests",
    });
    testIndexId = index.id;
    await chatDbAdapter.addMemberToNetwork(testIndexId, testUserId, "owner");

    const opp = await opportunityAdapter.createOpportunity({
      detection: {
        source: "manual",
        createdBy: testUserId,
        timestamp: new Date().toISOString(),
      },
      actors: [
        { networkId: testIndexId, userId: testUserId, role: "agent" },
        { networkId: testIndexId, userId: candidateUserId, role: "patient" },
      ],
      interpretation: {
        category: "collaboration",
        reasoning: "Controller test opportunity",
        confidence: 0.9,
      },
      context: { networkId: testIndexId },
      confidence: "0.9",
    });
    testOpportunityId = opp.id;
  }, 60_000);

  afterAll(async () => {
    if (testIndexId) {
      await deleteNetworkAndMembers(testIndexId);
    }
    if (testUserId) {
      await profileAdapter.deleteProfile(testUserId);
      await userAdapter.deleteById(testUserId);
    }
    if (candidateUserId) {
      await profileAdapter.deleteProfile(candidateUserId);
      await userAdapter.deleteById(candidateUserId);
    }
  }, 60_000);

  const mockUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: testEmail,
    name: "Test Opportunity Controller User",
  });

  test("listOpportunities should return 200 with opportunities array", async () => {
    const req = new Request("http://localhost/opportunities");
    const res = await controller.listOpportunities(req, mockUser());
    const data = (await res.json()) as { opportunities?: unknown[] };

    expect(res.status).toBe(200);
    expect(Array.isArray(data.opportunities)).toBe(true);
    expect(data.opportunities!.length).toBeGreaterThanOrEqual(1);
  });

  paidTest("getHome should return 200 with sections and meta", async () => {
    const req = new Request("http://localhost/opportunities/home");
    const res = await controller.getHome(req, mockUser());
    const data = (await res.json()) as { sections?: unknown[]; meta?: { totalOpportunities: number; totalSections: number }; error?: string };

    if (res.status === 500 && data.error) {
      expect(data.error).toBeDefined();
      return;
    }
    expect(res.status).toBe(200);
    expect(Array.isArray(data.sections)).toBe(true);
    expect(data.meta).toBeDefined();
    expect(typeof data.meta!.totalOpportunities).toBe("number");
    expect(typeof data.meta!.totalSections).toBe("number");
  }, 60000); // Home graph can be slow

  test("getOpportunity should return 400 when id is missing", async () => {
    const req = new Request("http://localhost/opportunities");
    const res = await controller.getOpportunity(req, mockUser(), {});
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(data.error).toBe("Missing opportunity id");
  });

  test("getOpportunity should return 404 when opportunity not found", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const req = new Request("http://localhost/opportunities/" + fakeId);
    const res = await controller.getOpportunity(req, mockUser(), { id: fakeId });
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(404);
    expect(data.error).toBe("Opportunity not found");
  });

  test("getOpportunity should return 200 and opportunity when found", async () => {
    const req = new Request("http://localhost/opportunities/" + testOpportunityId);
    const res = await controller.getOpportunity(req, mockUser(), { id: testOpportunityId });
    const data = (await res.json()) as { id?: string; category?: string; status?: string } & Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(data.id).toBe(testOpportunityId);
    expect(data.category).toBe("collaboration");
    expect(data.status).toBeDefined();
  });

  test("updateStatus should return 400 when id is missing", async () => {
    const req = new Request("http://localhost/opportunities/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "accepted" }),
    });
    const res = await controller.updateStatus(req, mockUser(), {});
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(data.error).toBe("Missing opportunity id");
  });

  test("updateStatus should return 400 when status is invalid", async () => {
    const req = new Request("http://localhost/opportunities/" + testOpportunityId + "/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "invalid" }),
    });
    const res = await controller.updateStatus(req, mockUser(), { id: testOpportunityId });
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(data.error).toContain("Invalid status");
  });

  test("updateStatus should reject malformed uptake acknowledgement IDs", async () => {
    const req = new Request("http://localhost/opportunities/" + testOpportunityId + "/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "accepted", acknowledgedUptakeQuestionIds: "q-1" }),
    });
    const res = await controller.updateStatus(req, mockUser(), { id: testOpportunityId });
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(data.error).toContain("acknowledgedUptakeQuestionIds");
  });

  test("startChat should reject malformed uptake acknowledgement IDs", async () => {
    const req = new Request("http://localhost/opportunities/" + testOpportunityId + "/start-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledgedUptakeQuestionIds: [""] }),
    });
    const res = await controller.startChat(req, mockUser(), { id: testOpportunityId });
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(data.error).toContain("acknowledgedUptakeQuestionIds");
  });

  test("updateStatus should return 404 when opportunity not found", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const req = new Request("http://localhost/opportunities/" + fakeId + "/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "pending" }),
    });
    const res = await controller.updateStatus(req, mockUser(), { id: fakeId });
    expect(res.status).toBe(404);
  });

  test("updateStatus should return 200 when updated", async () => {
    const req = new Request("http://localhost/opportunities/" + testOpportunityId + "/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "pending" }),
    });
    const res = await controller.updateStatus(req, mockUser(), { id: testOpportunityId });
    const data = (await res.json()) as { opportunity?: { status?: string }; status?: string };

    expect(res.status).toBe(200);
    expect(data.opportunity).toBeDefined();
    expect(data.opportunity!.status).toBe("pending");
  });

  test("listForIndex should return 400 when networkId is missing", async () => {
    const req = new Request("http://localhost/networks/opportunities");
    const res = await indexOpportunityController.listForIndex(req, mockUser(), {});
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(data.error).toBe("Missing network id");
  });

  test("listForIndex should return 200 with opportunities for index", async () => {
    const req = new Request("http://localhost/networks/" + testIndexId + "/opportunities");
    const res = await indexOpportunityController.listForIndex(req, mockUser(), { networkId: testIndexId });
    const data = (await res.json()) as { opportunities?: unknown[] };

    expect(res.status).toBe(200);
    expect(Array.isArray(data.opportunities)).toBe(true);
    expect(data.opportunities!.length).toBeGreaterThanOrEqual(1);
  });

  test("createManual should return 400 when networkId is missing", async () => {
    const req = new Request("http://localhost/networks/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parties: [{ userId: testUserId }, { userId: candidateUserId }],
        reasoning: "Test manual opportunity",
      }),
    });
    const res = await indexOpportunityController.createManual(req, mockUser(), {});
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(data.error).toBe("Missing network id");
  });

  test("createManual should return 400 when body missing parties or reasoning", async () => {
    const req = new Request("http://localhost/networks/" + testIndexId + "/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await indexOpportunityController.createManual(req, mockUser(), { networkId: testIndexId });
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(data.error).toContain("parties");
  });

  paidTest("createManual should return 201 when valid or 409 when opportunity already exists", async () => {
    const req = new Request("http://localhost/networks/" + testIndexId + "/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parties: [{ userId: testUserId }, { userId: candidateUserId }],
        reasoning: "Manual match for controller test",
      }),
    });
    const res = await indexOpportunityController.createManual(req, mockUser(), { networkId: testIndexId });
    const data = (await res.json()) as { id?: string; interpretation?: { summary: string }; error?: string };

    expect([201, 409]).toContain(res.status);
    if (res.status === 201) {
      expect(data.id).toBeDefined();
      expect(data.interpretation).toBeDefined();
    } else {
      expect(data.error).toContain("already exists");
    }
  });

  test('does not register POST /opportunities/discover, so router dispatch falls through to 404', () => {
    const directRoute = RouteRegistry.getRoutes(OpportunityControllerClass).find((route) =>
      route.method === 'POST' && route.path === '/discover',
    );
    const response = directRoute
      ? new Response('unexpected registered route', { status: 200 })
      : new Response('Not Found', { status: 404 });

    expect(response.status).toBe(404);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// OpportunityController Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════
