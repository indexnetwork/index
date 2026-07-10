/**
 * P4.1 negotiator chat persona — controller/service/adapter integration tests.
 *
 * Covers the IND-402 acceptance criteria that live in the API layer:
 * - NEGOTIATOR_CHAT_ENABLED=false → negotiator endpoints 404 (as if absent)
 * - get-or-create is idempotent: two calls → same sessionId, one session row,
 *   persona='negotiator', title = the personal negotiator agent's name
 * - the negotiator DM is excluded from the default /chat/sessions listing and
 *   visible with an explicit ?persona=negotiator filter
 * - streaming a negotiator session runs on the negotiator persona factory
 *   (client-scoped, loop behaviors off) and persists the turn
 * - scope params are rejected for negotiator sessions; persona/session
 *   mismatches are rejected
 *
 * Uses the real database adapters against the test DB; the graph factory is
 * stubbed (no LLM).
 */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm/sql";
import { ChatController } from "../chat.controller";
import { AuthController } from "../auth.controller";
import { UserDatabaseAdapter, conversationDatabaseAdapter } from "../../adapters/database.adapter";
import { chatSessionService } from "../../services/chat.service";
import type { ChatGraphFactory, ChatPersonaConfig } from "@indexnetwork/protocol";
import db from "../../lib/drizzle/drizzle";
import { agents } from "../../schemas/database.schema";
import type { AuthenticatedUser } from "../../guards/auth.guard";

const EMAIL = "test-chat-negotiator@example.com";

describe("Negotiator chat persona (IND-402)", () => {
  let controller: ChatController;
  const userAdapter = new UserDatabaseAdapter();
  let testUserId: string;
  let prevFlag: string | undefined;
  const createdSessionIds: string[] = [];

  /** Personas captured whenever the controller derives a persona factory. */
  const capturedPersonas: ChatPersonaConfig[] = [];
  /** Inputs captured from streamChatEventsWithContext calls. */
  const capturedStreamInputs: Array<{ userId: string; sessionId: string; message: string }> = [];

  const stubFactory = {
    withPersona(persona: ChatPersonaConfig) {
      capturedPersonas.push(persona);
      return stubFactory;
    },
    async *streamChatEventsWithContext(input: { userId: string; sessionId: string; message: string }) {
      capturedStreamInputs.push(input);
      yield { type: "token", content: "Here is " };
      yield { type: "token", content: "the record." };
      yield { type: "response_complete", response: "Here is the record." };
    },
  } as unknown as ChatGraphFactory;

  const mockUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: EMAIL,
    name: "Test Negotiator User",
  });

  const negotiatorSessionReq = () =>
    new Request("http://localhost/chat/negotiator/session", { method: "POST" });

  const streamReq = (body: Record<string, unknown>) =>
    new Request("http://localhost/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ useCheckpointer: false, ...body }),
    });

  beforeAll(async () => {
    prevFlag = process.env.NEGOTIATOR_CHAT_ENABLED;

    const existingUser = await userAdapter.findByEmail(EMAIL);
    if (existingUser) {
      await db.delete(agents).where(eq(agents.ownerId, existingUser.id));
      await userAdapter.deleteByEmail(EMAIL);
    }

    const user = await userAdapter.create({
      email: EMAIL,
      name: "Test Negotiator User",
    });
    testUserId = user.id;

    chatSessionService.setFactory(stubFactory);
    controller = new ChatController();
  });

  afterAll(async () => {
    if (prevFlag === undefined) delete process.env.NEGOTIATOR_CHAT_ENABLED;
    else process.env.NEGOTIATOR_CHAT_ENABLED = prevFlag;

    for (const sessionId of createdSessionIds) {
      await conversationDatabaseAdapter.deleteChatSession(sessionId).catch(() => {});
    }
    if (testUserId) {
      await db.delete(agents).where(eq(agents.ownerId, testUserId));
      await userAdapter.deleteById(testUserId);
    }
  });

  // ── Flag surface on the session bootstrap ──────────────────────────────

  test("features.negotiatorChat on /auth/me tracks the flag", async () => {
    const authController = new AuthController();
    const meReq = () => new Request("http://localhost/auth/me");

    process.env.NEGOTIATOR_CHAT_ENABLED = 'false';
    const offRes = await authController.me(meReq(), mockUser());
    expect(offRes.status).toBe(200);
    const offData = (await offRes.json()) as { features: { negotiatorChat: boolean } };
    expect(offData.features.negotiatorChat).toBe(false);

    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    const onRes = await authController.me(meReq(), mockUser());
    const onData = (await onRes.json()) as { features: { negotiatorChat: boolean } };
    expect(onData.features.negotiatorChat).toBe(true);
  }, 60000);

  // ── Flag off: endpoints behave as if they do not exist ────────────────────

  test("flag off → get-or-create endpoint returns 404", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'false';
    const res = await controller.negotiatorSession(negotiatorSessionReq(), mockUser());
    expect(res.status).toBe(404);
  }, 60000);

  test("flag off → streaming with persona=negotiator returns 404", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'false';
    const res = await controller.messageStream(
      streamReq({ message: "hello", persona: "negotiator" }),
      mockUser(),
    );
    expect(res.status).toBe(404);
  }, 60000);

  // ── Flag on: get-or-create is idempotent ──────────────────────────────────

  test("get-or-create is idempotent: same sessionId, persona and title from the agent row", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';

    const first = await controller.negotiatorSession(negotiatorSessionReq(), mockUser());
    expect(first.status).toBe(200);
    const firstData = (await first.json()) as {
      session: { id: string; persona: string; title: string | null; scopeType: string | null };
      created: boolean;
      agent: { id: string; name: string };
    };
    createdSessionIds.push(firstData.session.id);

    expect(firstData.created).toBe(true);
    expect(firstData.session.persona).toBe("negotiator");
    // Provisioned agent row drives identity and the session title.
    expect(firstData.agent.name).toBe("Test's Negotiator");
    expect(firstData.session.title).toBe("Test's Negotiator");
    // The persona registry key must not leak as a chat scope.
    expect(firstData.session.scopeType).toBeNull();

    const second = await controller.negotiatorSession(negotiatorSessionReq(), mockUser());
    expect(second.status).toBe(200);
    const secondData = (await second.json()) as { session: { id: string }; created: boolean };
    expect(secondData.created).toBe(false);
    expect(secondData.session.id).toBe(firstData.session.id);

    // Exactly one negotiator session row for the user.
    const stable = await conversationDatabaseAdapter.getNegotiatorChatSession(testUserId);
    expect(stable?.id).toBe(firstData.session.id);
  }, 60000);

  // ── History exclusion ──────────────────────────────────────────────────────

  test("negotiator DM is excluded from default /chat/sessions and visible with ?persona=negotiator", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';

    // A regular orchestrator session shows up in history.
    const orchestratorSessionId = await chatSessionService.createSession(testUserId, "Regular chat");
    createdSessionIds.push(orchestratorSessionId);

    const negotiatorSessionId = (await conversationDatabaseAdapter.getNegotiatorChatSession(testUserId))!.id;

    const defaultRes = await controller.getSessions(
      new Request("http://localhost/chat/sessions"),
      mockUser(),
    );
    const defaultData = (await defaultRes.json()) as { sessions: Array<{ id: string }> };
    const defaultIds = defaultData.sessions.map((s) => s.id);
    expect(defaultIds).toContain(orchestratorSessionId);
    expect(defaultIds).not.toContain(negotiatorSessionId);

    const filteredRes = await controller.getSessions(
      new Request("http://localhost/chat/sessions?persona=negotiator"),
      mockUser(),
    );
    const filteredData = (await filteredRes.json()) as { sessions: Array<{ id: string; persona: string }> };
    expect(filteredData.sessions.map((s) => s.id)).toContain(negotiatorSessionId);
    expect(filteredData.sessions.every((s) => s.persona === "negotiator")).toBe(true);
  }, 60000);

  // ── Streaming ──────────────────────────────────────────────────────────────

  test("streaming with persona=negotiator uses the negotiator persona factory and persists the turn", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    capturedPersonas.length = 0;
    capturedStreamInputs.length = 0;

    const res = await controller.messageStream(
      streamReq({ message: "Why did you pass on the fintech intro?", persona: "negotiator" }),
      mockUser(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const negotiatorSessionId = (await conversationDatabaseAdapter.getNegotiatorChatSession(testUserId))!.id;
    expect(res.headers.get("X-Session-Id")).toBe(negotiatorSessionId);

    const sse = await res.text();
    expect(sse).toContain("token");
    expect(sse).toContain("done");

    // The negotiator persona (not the orchestrator default) drove the run.
    expect(capturedPersonas.length).toBe(1);
    expect(capturedPersonas[0].id).toBe("negotiator");
    // P4.5 (IND-413): discovery-coupled callback stays off; hallucination
    // recovery is on now that create_intent makes proposal blocks legitimate.
    expect(capturedPersonas[0].loopBehaviors.createIntentCallback).toBe(false);
    expect(capturedPersonas[0].loopBehaviors.hallucinationRecovery).toBe(true);

    expect(capturedStreamInputs.length).toBe(1);
    expect(capturedStreamInputs[0].sessionId).toBe(negotiatorSessionId);
    expect(capturedStreamInputs[0].userId).toBe(testUserId);

    // Turn persisted on the negotiator session.
    const messages = await chatSessionService.getSessionMessages(negotiatorSessionId);
    const contents = messages.map((m) => m.content);
    expect(contents).toContain("Why did you pass on the fintech intro?");
    expect(contents).toContain("Here is the record.");
  }, 60000);

  test("streaming an existing negotiator session by sessionId alone also uses the negotiator persona", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    capturedPersonas.length = 0;

    const negotiatorSessionId = (await conversationDatabaseAdapter.getNegotiatorChatSession(testUserId))!.id;
    const res = await controller.messageStream(
      streamReq({ message: "Status update please", sessionId: negotiatorSessionId }),
      mockUser(),
    );
    expect(res.status).toBe(200);
    await res.text();

    expect(capturedPersonas.length).toBe(1);
    expect(capturedPersonas[0].id).toBe("negotiator");
  }, 60000);

  test("flag off → streaming an existing negotiator session returns 404", async () => {
    const negotiatorSessionId = (await conversationDatabaseAdapter.getNegotiatorChatSession(testUserId))!.id;
    process.env.NEGOTIATOR_CHAT_ENABLED = 'false';

    const res = await controller.messageStream(
      streamReq({ message: "hello", sessionId: negotiatorSessionId }),
      mockUser(),
    );
    expect(res.status).toBe(404);
  }, 60000);

  // ── Guardrails ─────────────────────────────────────────────────────────────

  test("negotiator chat cannot be scoped", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    const res = await controller.messageStream(
      streamReq({
        message: "hello",
        persona: "negotiator",
        scopeType: "network",
        scopeId: "00000000-0000-0000-0000-000000000000",
      }),
      mockUser(),
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("cannot be scoped");
  }, 60000);

  test("persona=negotiator with an orchestrator session is a 409 mismatch", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    const orchestratorSessionId = await chatSessionService.createSession(testUserId, "Mismatch test");
    createdSessionIds.push(orchestratorSessionId);

    const res = await controller.messageStream(
      streamReq({ message: "hello", sessionId: orchestratorSessionId, persona: "negotiator" }),
      mockUser(),
    );
    expect(res.status).toBe(409);
  }, 60000);

  test("orchestrator streaming path never derives a persona factory", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    capturedPersonas.length = 0;

    const orchestratorSessionId = await chatSessionService.createSession(testUserId, "Plain chat");
    createdSessionIds.push(orchestratorSessionId);

    const res = await controller.messageStream(
      streamReq({ message: "hello", sessionId: orchestratorSessionId }),
      mockUser(),
    );
    expect(res.status).toBe(200);
    await res.text();

    expect(capturedPersonas.length).toBe(0);
  }, 60000);
});
