/**
 * The signal's DM (intent-scoped PersonalAgent chat) — controller/service/
 * adapter integration tests.
 *
 * Covers the API-layer acceptance criteria of the intent-pinned surface:
 * - the intent pin is mandatory: get-or-create without an intentId is a 400,
 *   and with one it is idempotent (two calls → same sessionId, one row,
 *   persona='personal', title = the signal); scope-resolve returns the SAME
 *   session — one DM per (user, intent), no per-persona twins
 * - DM sessions are excluded from the default /chat/sessions listing
 * - streaming an intent-scoped session runs the signal's IntentAgent on its
 *   serialized inbox (phase 2 full chat ownership) — the persona graph is
 *   never derived for this scope — relays the turn's streamed reply chunks
 *   as token events, falls back to the completed text on a silent channel,
 *   and answers a failed turn with fixed honest copy
 * - api-key (agent-surface) turns require the intent scope; rows that
 *   outlived the persona-collapse migration fail closed
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
import { INTENT_AGENT_TURN_FAILURE_REPLY } from "../chat.controller";
import { publishIntentAgentReplyChunk } from "../../lib/intent-agent/intent-agent-reply.stream";
import type { IntentAgentTurnResult, IntentAgentUserMessageEvent } from "../../lib/intent-agent/intent-agent.types";

const EMAIL = "test-chat-negotiator@example.com";

describe("Signal DM (intent-scoped PersonalAgent chat)", () => {
  let controller: ChatController;
  const userAdapter = new UserDatabaseAdapter();
  let testUserId: string;
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

  /** Events the controller handed to the IntentAgent seam. */
  const agentTurnEvents: IntentAgentUserMessageEvent[] = [];
  /** Scripted per test; the default echoes an empty turn. */
  let scriptedAgentTurn: (event: IntentAgentUserMessageEvent) => Promise<IntentAgentTurnResult> =
    async () => ({ acts: [], messages: [] });

  /** Parse the SSE body into its JSON events. */
  const sseEvents = (body: string): Array<Record<string, unknown>> => body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);

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
    controller = new ChatController(
      () => ({ generate: async () => [] }) as never,
      (event) => {
        agentTurnEvents.push(event);
        return scriptedAgentTurn(event);
      },
    );
  }, 30_000);

  afterAll(async () => {

    for (const sessionId of createdSessionIds) {
      await conversationDatabaseAdapter.deleteChatSession(sessionId).catch(() => {});
    }
    if (testUserId) {
      await db.delete(intents).where(eq(intents.userId, testUserId));
      await db.delete(agents).where(eq(agents.ownerId, testUserId));
      await userAdapter.deleteById(testUserId);
    }
  }, 60_000);

  // ── Feature surface on the session bootstrap ───────────────────────────

  test("/auth/me still reports the negotiator surface as on", async () => {
    const authController = new AuthController();
    const res = await authController.me(new Request("http://localhost/auth/me"), mockUser());
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      features: { negotiatorChat: boolean; fastSignalIntake: boolean };
    };
    expect(data.features.negotiatorChat).toBe(true);
  }, 60000);

  // ── Flag on: the intent pin is mandatory ──────────────────────────────────

  test("get-or-create without an intentId is a 400", async () => {

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
    const missing = await controller.negotiatorSession(
      negotiatorSessionReq({ intentId: crypto.randomUUID() }),
      mockUser(),
    );
    expect(missing.status).toBe(404);
  }, 60000);

  // ── Streaming ──────────────────────────────────────────────────────────────

  test("an api-key stream with no scope is refused — agents only hold a signal's DM", async () => {
    capturedPersonas.length = 0;

    const res = await controller.messageStream(
      streamReq({ message: "Why did you pass on the fintech intro?" }),
      mockUser(),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("intent scope");
    expect(capturedPersonas.length).toBe(0);
  }, 60000);

  // ── Guardrails ─────────────────────────────────────────────────────────────

  test("an api-key stream cannot be network-scoped either", async () => {
    const res = await controller.messageStream(
      streamReq({
        message: "hello",
        scopeType: "network",
        scopeId: "00000000-0000-0000-0000-000000000000",
      }),
      mockUser(),
    );
    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("intent scope");
  }, 60000);

  test("a retired persona id in the stream body is rejected by the schema", async () => {
    const res = await controller.messageStream(
      streamReq({ message: "hello", persona: "negotiator", scopeType: "intent", scopeId: crypto.randomUUID() }),
      mockUser(),
    );
    expect(res.status).toBe(400);
  }, 60000);

  // ── Intent-pinned sessions (P4.2 / IND-403) ───────────────────────────

  test("intent-pinned get-or-create is idempotent, and scope-resolve names the same one DM", async () => {

    const first = await controller.negotiatorSession(negotiatorSessionReq({ intentId: testIntentId }), mockUser());
    expect(first.status).toBe(200);
    const firstData = (await first.json()) as {
      session: { id: string; persona: string; title: string | null; scopeType: string | null; scopeId: string | null };
      created: boolean;
    };
    createdSessionIds.push(firstData.session.id);

    expect(firstData.created).toBe(true);
    expect(firstData.session.persona).toBe("personal");
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

    // Keying spec: an intent scope names exactly ONE session — the DM. The
    // scope resolver returns the same conversation, never a per-persona twin.
    const resolved = await chatSessionService.resolveNegotiatorIntentSession(testUserId, testIntentId);
    if ('error' in resolved) throw new Error(resolved.error);
    expect(resolved.session.id).toBe(firstData.session.id);
    expect(resolved.created).toBe(false);
  }, 120_000);

  // Phase 2 (full chat ownership): every intent-scoped negotiator turn runs
  // the IntentAgent on its serialized inbox; the persona graph — and with it
  // the persona's chat tool registrations — is never derived for this scope.
  test("streaming with intent scope runs the IntentAgent, never the persona factory", async () => {
    capturedPersonas.length = 0;
    capturedStreamInputs.length = 0;
    agentTurnEvents.length = 0;
    scriptedAgentTurn = async (event) => ({
      acts: [{ tool: 'message_user', text: 'One match is waiting on you.', sessionId: event.sessionId, messageId: 'assistant-1', stage: 'reply' }],
      messages: ['One match is waiting on you.'],
    });

    const res = await controller.messageStream(
      streamReq({
        message: "What's happening with this signal?",
        persona: "personal",
        scopeType: "intent",
        scopeId: testIntentId,
      }),
      mockUser(),
    );
    expect(res.status).toBe(200);
    const body = await res.text();

    const pinned = (await conversationDatabaseAdapter.getNegotiatorIntentChatSession(testUserId, testIntentId))!;
    expect(res.headers.get("X-Session-Id")).toBe(pinned.id);

    // Ownership is unconditional: the agent got the turn, the persona did not.
    expect(capturedPersonas.length).toBe(0);
    expect(capturedStreamInputs.length).toBe(0);
    expect(agentTurnEvents).toHaveLength(1);
    expect(agentTurnEvents[0]).toMatchObject({
      kind: 'user_message',
      userId: testUserId,
      intentId: testIntentId,
      sessionId: pinned.id,
      text: "What's happening with this signal?",
    });

    // The client's message was persisted BEFORE the turn (the agent's memory).
    const messages = await chatSessionService.getSessionMessages(pinned.id);
    expect(messages.some((m) => m.role === 'user' && m.content === "What's happening with this signal?")).toBe(true);

    // The silent channel fell back to the completed reply in one token event,
    // and the done event carries the authoritative text.
    const events = sseEvents(body);
    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens.map((e) => e.content)).toEqual(['One match is waiting on you.']);
    const done = events.find((e) => e.type === 'done') as { response: string } | undefined;
    expect(done?.response).toBe('One match is waiting on you.');
  }, 60000);

  test("streaming the pinned session by sessionId alone routes to the same agent turn", async () => {
    capturedPersonas.length = 0;
    agentTurnEvents.length = 0;
    scriptedAgentTurn = async (event) => ({
      acts: [{ tool: 'message_user', text: 'Still on it.', sessionId: event.sessionId, messageId: 'assistant-2', stage: 'reply' }],
      messages: ['Still on it.'],
    });

    const pinned = (await conversationDatabaseAdapter.getNegotiatorIntentChatSession(testUserId, testIntentId))!;
    const res = await controller.messageStream(
      streamReq({ message: "Any progress?", sessionId: pinned.id }),
      mockUser(),
    );
    expect(res.status).toBe(200);
    await res.text();

    expect(capturedPersonas.length).toBe(0);
    expect(agentTurnEvents).toHaveLength(1);
    expect(agentTurnEvents[0]).toMatchObject({ intentId: testIntentId, sessionId: pinned.id });
  }, 60000);

  test("reply chunks published on the turn's channel relay as ordered token events, with no duplicate remainder", async () => {
    agentTurnEvents.length = 0;
    scriptedAgentTurn = async (event) => {
      // The host's shape: chunks published (post-check, post-persist) before
      // the job resolves, concatenating to exactly the joined messages.
      await publishIntentAgentReplyChunk(event.messageId, { seq: 1, content: 'Declined that match. ' });
      await publishIntentAgentReplyChunk(event.messageId, { seq: 2, content: 'Nothing else needs you.' });
      return {
        acts: [{ tool: 'message_user', text: 'Declined that match. Nothing else needs you.', sessionId: event.sessionId, messageId: 'assistant-3', stage: 'reply' }],
        messages: ['Declined that match. Nothing else needs you.'],
      };
    };

    const pinned = (await conversationDatabaseAdapter.getNegotiatorIntentChatSession(testUserId, testIntentId))!;
    const res = await controller.messageStream(
      streamReq({ message: "reject the manufacturing match", sessionId: pinned.id }),
      mockUser(),
    );
    expect(res.status).toBe(200);
    const events = sseEvents(await res.text());

    const tokens = events.filter((e) => e.type === 'token').map((e) => e.content);
    expect(tokens).toEqual(['Declined that match. ', 'Nothing else needs you.']);
    const done = events.find((e) => e.type === 'done') as { response: string } | undefined;
    expect(done?.response).toBe('Declined that match. Nothing else needs you.');
  }, 60000);

  test("a failed agent turn answers with the fixed honest copy and persists it", async () => {
    scriptedAgentTurn = async () => {
      throw new Error('turn timed out');
    };

    const pinned = (await conversationDatabaseAdapter.getNegotiatorIntentChatSession(testUserId, testIntentId))!;
    const res = await controller.messageStream(
      streamReq({ message: "hello?", sessionId: pinned.id }),
      mockUser(),
    );
    expect(res.status).toBe(200);
    const events = sseEvents(await res.text());

    const tokens = events.filter((e) => e.type === 'token').map((e) => e.content);
    expect(tokens).toEqual([INTENT_AGENT_TURN_FAILURE_REPLY]);
    const messages = await chatSessionService.getSessionMessages(pinned.id);
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', content: INTENT_AGENT_TURN_FAILURE_REPLY });
  }, 60000);

  // ── Rows that outlived the persona-collapse migration ─────────────────

  test("an unmigrated negotiator-persona conversation is readable but fails closed", async () => {

    // Manufacture a row in the retired shape: a 'negotiator' conversation
    // registered under ('persona', 'negotiator') with no chat scope. The
    // migration rewrites these to 'personal'; any row that outlives it must
    // stay readable history and never drive a turn.
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

    // But the persona id is retired: it cannot be continued…
    const continued = await controller.messageStream(
      streamReq({ message: "still there?", sessionId: legacyId }),
      mockUser(),
    );
    expect(continued.status).toBe(409);
    expect(((await continued.json()) as { code: string }).code).toBe("CHAT_PERSONA_UNSUPPORTED");

    // …and it cannot be retroactively pinned to an intent either.
    const scoped = await controller.messageStream(
      streamReq({ message: "hello", sessionId: legacyId, scopeType: "intent", scopeId: testIntentId }),
      mockUser(),
    );
    expect(scoped.status).toBe(409);
  }, 60000);

  // ── History listing ────────────────────────────────────────────────────

  test("DM sessions stay out of /chat/sessions, and ?persona=negotiator no longer selects them", async () => {

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

  test("a retired orchestrator session is read-only and derives no persona factory", async () => {
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
