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
import { agents, intents } from "../../schemas/database.schema";
import type { AuthenticatedUser } from "../../guards/auth.guard";

const EMAIL = "test-chat-negotiator@example.com";

describe("Negotiator chat persona (IND-402)", () => {
  let controller: ChatController;
  const userAdapter = new UserDatabaseAdapter();
  let testUserId: string;
  let prevFlag: string | undefined;
  let prevSignalFlag: string | undefined;
  const createdSessionIds: string[] = [];

  /** Personas captured whenever the controller derives a persona factory. */
  const capturedPersonas: ChatPersonaConfig[] = [];
  /** Inputs captured from streamChatEventsWithContext calls. */
  const capturedStreamInputs: Array<{ userId: string; sessionId: string; message: string; scopeType?: string; scopeId?: string }> = [];
  /** Intent owned by the test user (IND-403 pinning). */
  let testIntentId: string;
  const INTENT_PAYLOAD = "Looking for a technical co-founder in Berlin";

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

  const negotiatorSessionReq = (body?: Record<string, unknown>) =>
    new Request("http://localhost/chat/negotiator/session", {
      method: "POST",
      ...(body
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });

  const streamReq = (body: Record<string, unknown>) =>
    new Request("http://localhost/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ useCheckpointer: false, ...body }),
    });

  beforeAll(async () => {
    prevFlag = process.env.NEGOTIATOR_CHAT_ENABLED;
    prevSignalFlag = process.env.WEB_SIGNAL_AGENT_ENABLED;

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

    const [intent] = await db.insert(intents).values({
      payload: INTENT_PAYLOAD,
      summary: INTENT_PAYLOAD,
      userId: testUserId,
    }).returning({ id: intents.id });
    testIntentId = intent.id;

    chatSessionService.setFactory(stubFactory);
    controller = new ChatController(() => ({ generate: async () => [] }) as never);
  });

  afterAll(async () => {
    if (prevFlag === undefined) delete process.env.NEGOTIATOR_CHAT_ENABLED;
    else process.env.NEGOTIATOR_CHAT_ENABLED = prevFlag;
    if (prevSignalFlag === undefined) delete process.env.WEB_SIGNAL_AGENT_ENABLED;
    else process.env.WEB_SIGNAL_AGENT_ENABLED = prevSignalFlag;

    for (const sessionId of createdSessionIds) {
      await conversationDatabaseAdapter.deleteChatSession(sessionId).catch(() => {});
    }
    if (testUserId) {
      await db.delete(intents).where(eq(intents.userId, testUserId));
      await db.delete(agents).where(eq(agents.ownerId, testUserId));
      await userAdapter.deleteById(testUserId);
    }
  });

  // ── Flag surface on the session bootstrap ──────────────────────────────

  test("/auth/me exposes the negotiator and Signal Agent flags", async () => {
    const authController = new AuthController();
    const meReq = () => new Request("http://localhost/auth/me");

    process.env.NEGOTIATOR_CHAT_ENABLED = 'false';
    process.env.WEB_SIGNAL_AGENT_ENABLED = 'false';
    const offRes = await authController.me(meReq(), mockUser());
    expect(offRes.status).toBe(200);
    const offData = (await offRes.json()) as {
      features: { negotiatorChat: boolean; signalAgent: boolean };
    };
    expect(offData.features).toEqual({ negotiatorChat: false, signalAgent: false });

    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    process.env.WEB_SIGNAL_AGENT_ENABLED = 'true';
    const onRes = await authController.me(meReq(), mockUser());
    const onData = (await onRes.json()) as {
      features: { negotiatorChat: boolean; signalAgent: boolean };
    };
    expect(onData.features).toEqual({ negotiatorChat: true, signalAgent: true });
    process.env.WEB_SIGNAL_AGENT_ENABLED = 'false';
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

  test("negotiator chat cannot be network-scoped", async () => {
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
    expect(data.error).toContain("cannot be network-scoped");
  }, 60000);

  // ── Intent-pinned sessions (P4.2 / IND-403) ───────────────────────────

  test("intent-pinned get-or-create is idempotent and distinct from the DM and the orchestrator intent session", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';

    const first = await controller.negotiatorSession(negotiatorSessionReq({ intentId: testIntentId }), mockUser());
    expect(first.status).toBe(200);
    const firstData = (await first.json()) as {
      session: { id: string; persona: string; title: string | null; scopeType: string | null; scopeId: string | null };
      created: boolean;
    };
    createdSessionIds.push(firstData.session.id);

    expect(firstData.created).toBe(true);
    expect(firstData.session.persona).toBe("negotiator");
    // The pinned session carries the canonical intent scope…
    expect(firstData.session.scopeType).toBe("intent");
    expect(firstData.session.scopeId).toBe(testIntentId);
    // …and is titled after the signal, not the agent.
    expect(firstData.session.title).toBe(INTENT_PAYLOAD);

    // Idempotent.
    const second = await controller.negotiatorSession(negotiatorSessionReq({ intentId: testIntentId }), mockUser());
    const secondData = (await second.json()) as { session: { id: string }; created: boolean };
    expect(secondData.created).toBe(false);
    expect(secondData.session.id).toBe(firstData.session.id);

    // Distinct from the unscoped DM.
    const dm = await conversationDatabaseAdapter.getNegotiatorChatSession(testUserId);
    expect(dm?.id).not.toBe(firstData.session.id);

    // Keying spec: the orchestrator's session for the SAME (user, intent) is a
    // different conversation — persona is part of the key.
    const orchestrator = await chatSessionService.resolveSessionForScope(testUserId, {
      scopeType: "intent",
      scopeId: testIntentId,
    });
    if ('error' in orchestrator) throw new Error(orchestrator.error);
    createdSessionIds.push(orchestrator.session.id);
    expect(orchestrator.session.id).not.toBe(firstData.session.id);
    expect(orchestrator.session.persona).toBe("orchestrator");
    expect(orchestrator.session.scopeType).toBe("intent");
  }, 60000);

  test("streaming persona=negotiator with intent scope resolves the pinned session and seeds the scope + prompt pin", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    capturedPersonas.length = 0;
    capturedStreamInputs.length = 0;

    const res = await controller.messageStream(
      streamReq({
        message: "What's happening with this signal?",
        persona: "negotiator",
        scopeType: "intent",
        scopeId: testIntentId,
      }),
      mockUser(),
    );
    expect(res.status).toBe(200);
    await res.text();

    const pinned = (await conversationDatabaseAdapter.getNegotiatorIntentChatSession(testUserId, testIntentId))!;
    expect(res.headers.get("X-Session-Id")).toBe(pinned.id);

    // Negotiator persona factory with the intent scope threaded to the graph.
    expect(capturedPersonas.length).toBe(1);
    expect(capturedPersonas[0].id).toBe("negotiator");
    expect(capturedStreamInputs.length).toBe(1);
    expect(capturedStreamInputs[0].scopeType).toBe("intent");
    expect(capturedStreamInputs[0].scopeId).toBe(testIntentId);

    // The prompt pins the signal (id + human-readable label) when built with
    // an intent-scoped context.
    const prompt = capturedPersonas[0].buildSystemContent(
      {
        userId: testUserId,
        userName: "Test Negotiator User",
        userEmail: EMAIL,
        user: { id: testUserId },
        userProfile: null,
        userNetworks: [],
        scopeType: "intent",
        scopeId: testIntentId,
      } as never,
      { iteration: 1 } as never,
    );
    expect(prompt).toContain("## Pinned signal");
    expect(prompt).toContain(testIntentId);
    expect(prompt).toContain(INTENT_PAYLOAD);
  }, 60000);

  test("streaming the pinned session by sessionId alone inherits the intent scope and negotiator persona", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    capturedPersonas.length = 0;
    capturedStreamInputs.length = 0;

    const pinned = (await conversationDatabaseAdapter.getNegotiatorIntentChatSession(testUserId, testIntentId))!;
    const res = await controller.messageStream(
      streamReq({ message: "Any progress?", sessionId: pinned.id }),
      mockUser(),
    );
    expect(res.status).toBe(200);
    await res.text();

    expect(capturedPersonas.length).toBe(1);
    expect(capturedPersonas[0].id).toBe("negotiator");
    expect(capturedStreamInputs[0].scopeType).toBe("intent");
    expect(capturedStreamInputs[0].scopeId).toBe(testIntentId);
  }, 60000);

  test("the unscoped DM cannot be scoped after the fact", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    const dm = (await conversationDatabaseAdapter.getNegotiatorChatSession(testUserId))!;

    const res = await controller.messageStream(
      streamReq({ message: "hello", sessionId: dm.id, scopeType: "intent", scopeId: testIntentId }),
      mockUser(),
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("DM cannot be scoped");
  }, 60000);

  test("intent-pinned session for a nonexistent intent is a 404; ?persona=negotiator lists DM and pinned sessions distinguishably", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';

    const missing = await controller.negotiatorSession(
      negotiatorSessionReq({ intentId: crypto.randomUUID() }),
      mockUser(),
    );
    expect(missing.status).toBe(404);

    // The sidebar finds the DM among negotiator sessions by its null scope.
    const listed = await controller.getSessions(
      new Request("http://localhost/chat/sessions?persona=negotiator"),
      mockUser(),
    );
    const listedData = (await listed.json()) as { sessions: Array<{ id: string; scopeType: string | null }> };
    const dm = (await conversationDatabaseAdapter.getNegotiatorChatSession(testUserId))!;
    const pinned = (await conversationDatabaseAdapter.getNegotiatorIntentChatSession(testUserId, testIntentId))!;
    const byId = new Map(listedData.sessions.map((s) => [s.id, s.scopeType]));
    expect(byId.get(dm.id)).toBeNull();
    expect(byId.get(pinned.id)).toBe("intent");

    // And the pinned session stays out of default history like the DM.
    const defaults = await controller.getSessions(new Request("http://localhost/chat/sessions"), mockUser());
    const defaultData = (await defaults.json()) as { sessions: Array<{ id: string }> };
    expect(defaultData.sessions.map((s) => s.id)).not.toContain(pinned.id);
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
