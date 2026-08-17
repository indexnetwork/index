/**
 * P4.1 negotiator chat persona — controller/service/adapter integration tests.
 *
 * Covers the IND-402 acceptance criteria that live in the API layer:
 * - NEGOTIATOR_CHAT_ENABLED=false → negotiator endpoints 404 (as if absent)
 * - the intent pin is mandatory: get-or-create without an intentId is a 400,
 *   and with one it is idempotent (two calls → same sessionId, one row,
 *   persona='negotiator', title = the signal)
 * - negotiator sessions are excluded from the default /chat/sessions listing,
 *   and ?persona=negotiator no longer selects them
 * - streaming a negotiator session runs on the negotiator persona factory
 *   (client-scoped, loop behaviors off) and persists the turn
 * - network scope and persona/session mismatches are rejected; conversations
 *   preserved from the removed unscoped DM are read-only
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
import { agents, chatSessionScopes, conversationParticipants, conversations, intents } from "../../schemas/database.schema";
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
  }, 30_000);

  afterAll(async () => {
    if (prevFlag === undefined) delete process.env.NEGOTIATOR_CHAT_ENABLED;
    else process.env.NEGOTIATOR_CHAT_ENABLED = prevFlag;

    for (const sessionId of createdSessionIds) {
      await conversationDatabaseAdapter.deleteChatSession(sessionId).catch(() => {});
    }
    if (testUserId) {
      await db.delete(intents).where(eq(intents.userId, testUserId));
      await db.delete(agents).where(eq(agents.ownerId, testUserId));
      await userAdapter.deleteById(testUserId);
    }
  }, 60_000);

  // ── Flag surface on the session bootstrap ──────────────────────────────

  test("/auth/me exposes the negotiator flag", async () => {
    const authController = new AuthController();
    const meReq = () => new Request("http://localhost/auth/me");

    process.env.NEGOTIATOR_CHAT_ENABLED = 'false';
    const offRes = await authController.me(meReq(), mockUser());
    expect(offRes.status).toBe(200);
    const offData = (await offRes.json()) as {
      features: { negotiatorChat: boolean; fastSignalIntake: boolean };
    };
    expect(offData.features).toEqual({ negotiatorChat: false, fastSignalIntake: false });

    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    const onRes = await authController.me(meReq(), mockUser());
    const onData = (await onRes.json()) as {
      features: { negotiatorChat: boolean; fastSignalIntake: boolean };
    };
    expect(onData.features).toEqual({ negotiatorChat: true, fastSignalIntake: false });
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

  // ── Flag on: the intent pin is mandatory ──────────────────────────────────

  test("get-or-create without an intentId is a 400", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';

    // No body at all — the shape the retired sidebar used to post.
    const noBody = await controller.negotiatorSession(negotiatorSessionReq(), mockUser());
    expect(noBody.status).toBe(400);
    expect(((await noBody.json()) as { error: string }).error).toContain("intentId");

    // Present but empty/blank is the same rejection, not a silent fallback.
    for (const body of [{}, { intentId: "" }, { intentId: "   " }]) {
      const res = await controller.negotiatorSession(negotiatorSessionReq(body), mockUser());
      expect(res.status).toBe(400);
    }
  }, 60000);

  test("get-or-create for an intent the caller does not own is a 404", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    const missing = await controller.negotiatorSession(
      negotiatorSessionReq({ intentId: crypto.randomUUID() }),
      mockUser(),
    );
    expect(missing.status).toBe(404);
  }, 60000);

  // ── Streaming ──────────────────────────────────────────────────────────────

  test("streaming with persona=negotiator and no scope is a 400", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    capturedPersonas.length = 0;

    // The unscoped DM this used to open no longer exists, so a new negotiator
    // session has no target without an intent.
    const res = await controller.messageStream(
      streamReq({ message: "Why did you pass on the fintech intro?", persona: "negotiator" }),
      mockUser(),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("intent scope");
    expect(capturedPersonas.length).toBe(0);
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

  test("intent-pinned get-or-create is idempotent and distinct from another persona's intent session", async () => {
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

    // Keying spec: the orchestrator's session for the SAME (user, intent) is a
    // different conversation — persona is part of the key.
    const signal = await chatSessionService.resolveSessionForScope(testUserId, {
      scopeType: "intent",
      scopeId: testIntentId,
    }, "signal");
    if ('error' in signal) throw new Error(signal.error);
    createdSessionIds.push(signal.session.id);
    expect(signal.session.id).not.toBe(firstData.session.id);
    expect(signal.session.persona).toBe("signal");
    expect(signal.session.scopeType).toBe("intent");
  }, 120_000);

  test("flag off → streaming an existing pinned session returns 404", async () => {
    const pinned = (await conversationDatabaseAdapter.getNegotiatorIntentChatSession(testUserId, testIntentId))!;
    process.env.NEGOTIATOR_CHAT_ENABLED = 'false';

    const res = await controller.messageStream(
      streamReq({ message: "hello", sessionId: pinned.id }),
      mockUser(),
    );
    expect(res.status).toBe(404);
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
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

  // ── Conversations preserved from the removed unscoped DM ──────────────

  test("a preserved unscoped negotiator conversation is readable but cannot be continued", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';

    // Manufacture a row in the shape the removed DM used to write: a
    // negotiator conversation registered under ('persona', 'negotiator') with
    // no chat scope. Nothing creates these any more; the point is that the
    // ones already in the database keep working as history.
    const legacyId = crypto.randomUUID();
    const now = new Date();
    await db.insert(conversations).values({ id: legacyId, persona: 'negotiator', createdAt: now, updatedAt: now });
    await db.insert(conversationParticipants).values([
      { conversationId: legacyId, participantId: testUserId, participantType: 'user' as const },
    ]);
    await db.insert(chatSessionScopes).values({
      conversationId: legacyId,
      userId: testUserId,
      scopeType: 'persona',
      scopeId: 'negotiator',
      createdAt: now,
      updatedAt: now,
    });
    createdSessionIds.push(legacyId);

    // Still loadable by id — history is preserved, not deleted.
    const loaded = await chatSessionService.getSession(legacyId, testUserId);
    expect(loaded?.id).toBe(legacyId);
    expect(loaded?.persona).toBe("negotiator");
    expect(loaded?.scopeType).toBeNull();

    // But the surface is gone: it cannot be continued…
    const continued = await controller.messageStream(
      streamReq({ message: "still there?", sessionId: legacyId }),
      mockUser(),
    );
    expect(continued.status).toBe(400);
    expect(((await continued.json()) as { error: string }).error).toContain("read-only");

    // …and it cannot be retroactively pinned to an intent either.
    const scoped = await controller.messageStream(
      streamReq({ message: "hello", sessionId: legacyId, scopeType: "intent", scopeId: testIntentId }),
      mockUser(),
    );
    expect(scoped.status).toBe(400);
  }, 60000);

  // ── History listing ────────────────────────────────────────────────────

  test("negotiator sessions stay out of /chat/sessions, and ?persona=negotiator no longer selects them", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';

    const orchestratorSessionId = await chatSessionService.createSession(testUserId, "Regular chat", undefined, undefined, "orchestrator");
    createdSessionIds.push(orchestratorSessionId);
    const pinned = (await conversationDatabaseAdapter.getNegotiatorIntentChatSession(testUserId, testIntentId))!;

    const defaults = await controller.getSessions(new Request("http://localhost/chat/sessions"), mockUser());
    const defaultIds = ((await defaults.json()) as { sessions: Array<{ id: string }> }).sessions.map((x) => x.id);
    expect(defaultIds).toContain(orchestratorSessionId);
    expect(defaultIds).not.toContain(pinned.id);

    // The negotiator filter existed only to find the DM. It is gone, so the
    // parameter is inert and the route returns orchestrator history.
    const filtered = await controller.getSessions(
      new Request("http://localhost/chat/sessions?persona=negotiator"),
      mockUser(),
    );
    const filteredData = (await filtered.json()) as { sessions: Array<{ id: string; persona: string }> };
    expect(filteredData.sessions.map((x) => x.id)).not.toContain(pinned.id);
    expect(filteredData.sessions.every((x) => x.persona === "orchestrator")).toBe(true);
  }, 60000);

  test("persona=negotiator with an orchestrator session is a 409 mismatch", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    const orchestratorSessionId = await chatSessionService.createSession(testUserId, "Mismatch test", undefined, undefined, "orchestrator");
    createdSessionIds.push(orchestratorSessionId);

    const res = await controller.messageStream(
      streamReq({ message: "hello", sessionId: orchestratorSessionId, persona: "negotiator" }),
      mockUser(),
    );
    expect(res.status).toBe(409);
  }, 60000);

  test("a retired orchestrator session is read-only and derives no persona factory", async () => {
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
    capturedPersonas.length = 0;

    const orchestratorSessionId = await chatSessionService.createSession(
      testUserId, "Plain chat", undefined, undefined, "orchestrator",
    );
    createdSessionIds.push(orchestratorSessionId);

    const res = await controller.messageStream(
      streamReq({ message: "hello", sessionId: orchestratorSessionId }),
      mockUser(),
    );
    expect(res.status).toBe(409);
    expect((await res.json() as { code: string }).code).toBe('WEB_SIGNAL_SESSION_REQUIRED');
    expect(capturedPersonas.length).toBe(0);
  }, 60000);
});
