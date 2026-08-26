process.env.OPENROUTER_API_KEY = 'test-key';
process.env.NODE_ENV = 'test';

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

import type { ChatGraphFactory } from '@indexnetwork/protocol';

import { ChatController } from '../chat.controller';
import { AuthGuard, SessionOnlyGuard, type AuthenticatedUser } from '../../guards/auth.guard';
import { recordRequestAuthContext } from '../../lib/request-auth-context';
import { RouteRegistry } from '../../lib/router/router.decorators';
import { agentService } from '../../services/agent.service';
import { chatSessionService } from '../../services/chat.service';
import { userService } from '../../services/user.service';
import type { PersonalAgentResult } from '@indexnetwork/protocol';
import type { PersonalAgentUserMessageEvent } from '../../lib/negotiation/personal-agent';

const USER: AuthenticatedUser = {
  id: 'signal-user-1',
  email: 'signal@example.com',
  name: 'Signal User',
};

const personalInputs: Array<Record<string, unknown>> = [];

function factoryFor(inputs: Array<Record<string, unknown>>): ChatGraphFactory {
  return {
    async *streamChatEventsWithContext(input: Record<string, unknown>) {
      inputs.push(input);
      yield { type: 'response_complete', response: 'Done.' };
    },
  } as unknown as ChatGraphFactory;
}

const personalFactory = factoryFor(personalInputs);

function session(id: string, persona: string, scope?: { scopeType: string; scopeId: string }) {
  return {
    id,
    userId: USER.id,
    title: null,
    persona,
    networkId: null,
    scopeType: scope?.scopeType ?? null,
    scopeId: scope?.scopeId ?? null,
    shareToken: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('PersonalAgent web chat routing', () => {
  let controller: ChatController;
  let createSessionSpy: ReturnType<typeof spyOn>;
  let getSessionSpy: ReturnType<typeof spyOn>;
  let addMessageSpy: ReturnType<typeof spyOn>;
  let getFactorySpy: ReturnType<typeof spyOn>;
  /** Events the controller handed to the PersonalAgent seam. */
  const agentTurnEvents: PersonalAgentUserMessageEvent[] = [];
  let scriptedAgentTurn: (event: PersonalAgentUserMessageEvent) => Promise<PersonalAgentResult>;

  async function stream(
    body: Record<string, unknown>,
    surface: 'web' | 'dual',
    authKind?: 'session' | 'api_key',
  ) {
    const abortController = new AbortController();
    const req = new Request('http://localhost/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ useCheckpointer: false, ...body }),
      signal: abortController.signal,
    });
    if (authKind === 'session') {
      recordRequestAuthContext(req, { kind: 'session' });
    } else if (authKind === 'api_key') {
      recordRequestAuthContext(req, { kind: 'api_key', agentId: null });
    }
    const response = surface === 'web'
      ? await controller.webMessageStream(req, USER)
      : await controller.messageStream(req, USER);
    abortController.abort();
    if (response.headers.get('Content-Type')?.includes('text/event-stream')) {
      await response.text();
    }
    return response;
  }

  beforeEach(() => {
    personalInputs.length = 0;
    agentTurnEvents.length = 0;
    scriptedAgentTurn = async () => ({ acts: [], messages: [] });
    controller = new ChatController(
      () => ({ generate: async () => [] }) as never,
      (event) => {
        agentTurnEvents.push(event);
        return scriptedAgentTurn(event);
      },
    );

    createSessionSpy = spyOn(chatSessionService, 'createSession').mockResolvedValue('new-session');
    getSessionSpy = spyOn(chatSessionService, 'getSession').mockResolvedValue(null);
    addMessageSpy = spyOn(chatSessionService, 'addMessage').mockResolvedValue('message-1');
    spyOn(chatSessionService, 'getCheckpointer').mockResolvedValue(undefined);
    spyOn(chatSessionService, 'generateSessionTitle').mockResolvedValue(undefined);
    spyOn(chatSessionService, 'getSessionMetadata').mockResolvedValue(undefined);
    spyOn(chatSessionService, 'upsertSessionMetadata').mockResolvedValue();
    spyOn(chatSessionService, 'saveMessageMetadata').mockResolvedValue();
    getFactorySpy = spyOn(chatSessionService, 'getPersonalAgentGraphFactory').mockReturnValue(personalFactory);
  });

  afterEach(() => {
    mock.restore();
  });

  test('web creation persists the one PersonalAgent persona and uses its factory', async () => {
    const response = await stream(
      { message: 'Help refine my signal' },
      'web',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Session-Id')).toBe('new-session');
    expect(response.headers.get('X-Chat-Persona')).toBe('personal');
    expect(createSessionSpy).toHaveBeenCalledWith(
      USER.id,
      undefined,
      undefined,
      undefined,
      'personal',
    );
    expect(getFactorySpy).toHaveBeenCalledTimes(1);
    expect(personalInputs).toHaveLength(1);
  });

  test('a web stream with no persona named resolves the one persona — no default needed', async () => {
    const response = await stream({ message: 'ordinary chat' }, 'web');

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Chat-Persona')).toBe('personal');
    expect(createSessionSpy).toHaveBeenCalledTimes(1);
  });

  test('the persona is named from the user own personal agent row', async () => {
    const agentSpy = spyOn(agentService, 'getNegotiatorAgent')
      .mockResolvedValue({ id: 'agent-1', name: "Signal User's Agent" } as never);

    await stream({ message: 'Draft a signal' }, 'web');
    expect(getFactorySpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "Signal User's Agent" }),
      { onboarding: false },
    );

    // A missing row is not fatal here: the prompt falls back to a generic
    // self-description rather than failing the turn or naming a product.
    agentSpy.mockResolvedValue(null as never);
    await stream({ message: 'Draft another' }, 'web');
    expect(getFactorySpy).toHaveBeenLastCalledWith(null, { onboarding: false });
  });

  test('a persisted session is continued when the followup omits persona', async () => {
    getSessionSpy.mockResolvedValue(session('personal-session', 'personal'));

    const response = await stream(
      { message: 'Now archive the older one', sessionId: 'personal-session' },
      'web',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Chat-Persona')).toBe('personal');
    expect(createSessionSpy).not.toHaveBeenCalled();
    expect(getFactorySpy).toHaveBeenCalledTimes(1);
  });

  test('a stale persona field in the request body is inert — stripped, never routed on', async () => {
    getSessionSpy.mockResolvedValue(session('personal-session', 'personal'));

    // The persona field left the schema: zod strips unknown keys, so stale
    // clients still stream and the stored session decides everything.
    const response = await stream(
      { message: 'continue', sessionId: 'personal-session', persona: 'signal' },
      'web',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Chat-Persona')).toBe('personal');
    expect(getFactorySpy).toHaveBeenCalledTimes(1);
  });

  test('legacy orchestrator session loads but a web turn is rejected without side effects', async () => {
    getSessionSpy.mockResolvedValue(session('legacy-session', 'orchestrator'));
    spyOn(chatSessionService, 'getSessionMessages').mockResolvedValue([]);
    spyOn(chatSessionService, 'getMessageMetadataByMessageIds').mockResolvedValue([]);

    const loadReq = new Request('http://localhost/chat/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'legacy-session' }),
    });
    const loaded = await controller.getSession(loadReq, USER);
    expect(loaded.status).toBe(200);
    expect((await loaded.json() as { session: { persona: string } }).session.persona).toBe('orchestrator');

    const response = await stream(
      { sessionId: 'legacy-session', message: 'continue' },
      'web',
    );
    const payload = await response.json() as {
      code: string;
      action: { type: string; href: string };
    };

    expect(response.status).toBe(409);
    expect(payload.code).toBe('WEB_SIGNAL_SESSION_REQUIRED');
    expect(payload.action).toEqual({ type: 'start_signal_session', href: '/' });
    expect(addMessageSpy).not.toHaveBeenCalled();
    expect(getFactorySpy).not.toHaveBeenCalled();
  });

  test('unknown and unmigrated persisted personas never fall back to a live one', async () => {
    for (const persona of ['unknown', 'signal', 'negotiator', 'onboarding']) {
      getSessionSpy.mockResolvedValue(session(`${persona}-session`, persona));

      const response = await stream(
        { message: 'continue', sessionId: `${persona}-session` },
        'web',
      );
      const payload = await response.json() as { code: string };

      expect(response.status).toBe(409);
      expect(payload.code).toBe('CHAT_PERSONA_UNSUPPORTED');
    }
    expect(addMessageSpy).not.toHaveBeenCalled();
  });

  test('an intent scope resolves the signal DM on the web resolver, and the dual-auth twin is gone', async () => {
    const dm = session('dm-session', 'personal', { scopeType: 'intent', scopeId: 'intent-1' });
    const resolveSpy = spyOn(chatSessionService, 'resolveNegotiatorIntentSession').mockResolvedValue({
      session: dm,
      created: true,
      intentTitle: 'A signal',
    } as never);
    const req = new Request('http://localhost/chat/web/session/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scopeType: 'intent', scopeId: 'intent-1' }),
    });
    recordRequestAuthContext(req, { kind: 'session' });

    const webResponse = await controller.webResolveSession(req, USER);
    expect(webResponse.status).toBe(200);
    expect(resolveSpy).toHaveBeenLastCalledWith(USER.id, 'intent-1');

    // The byte-identical dual-auth route was deleted with its last caller.
    const route = RouteRegistry.getRoutes(ChatController).find((c) => c.path === '/session/resolve');
    expect(route).toBeUndefined();
  });

  test('a session-auth intent-scoped turn runs the PersonalAgent, never the graph persona', async () => {
    spyOn(agentService, 'getNegotiatorAgent').mockResolvedValue({ id: 'agent-1', name: 'Agent' } as never);
    spyOn(chatSessionService, 'validateIntentScope').mockResolvedValue({ ok: true, title: 'A signal' });
    const dm = session('dm-session', 'personal', { scopeType: 'intent', scopeId: 'intent-1' });
    spyOn(chatSessionService, 'resolveNegotiatorIntentSession').mockResolvedValue({
      session: dm,
      created: false,
      intentTitle: 'A signal',
    } as never);
    scriptedAgentTurn = async () => ({ acts: [], messages: ['On it.'] });

    const response = await stream(
      { message: 'What is happening with this signal?', scopeType: 'intent', scopeId: 'intent-1' },
      'dual',
      'session',
    );

    expect(response.status).toBe(200);
    expect(agentTurnEvents).toHaveLength(1);
    expect(agentTurnEvents[0]).toMatchObject({
      event: 'user_message',
      userId: USER.id,
      intentId: 'intent-1',
      sessionId: 'dm-session',
    });
    expect(getFactorySpy).not.toHaveBeenCalled();
  });

  test('onboarding surface streams the one persona and stays restricted while incomplete', async () => {
    const findUserSpy = spyOn(userService, 'findById').mockResolvedValue({
      id: USER.id,
      onboarding: {},
    } as never);
    const request = (body: Record<string, unknown> = {}) => new Request('http://localhost/chat/onboarding/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Continue onboarding', ...body }),
    });

    const allowed = await controller.onboardingMessageStream(request(), USER);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('X-Chat-Persona')).toBe('personal');
    expect(createSessionSpy).toHaveBeenLastCalledWith(
      USER.id,
      undefined,
      undefined,
      undefined,
      'personal',
    );
    expect(getFactorySpy).toHaveBeenCalledTimes(1);
    expect(getFactorySpy).toHaveBeenLastCalledWith(null, { onboarding: true });

    // The restricted surface cannot be scoped or client-prefilled.
    const scoped = await controller.onboardingMessageStream(
      request({ scopeType: 'network', scopeId: 'network-1' }),
      USER,
    );
    expect(scoped.status).toBe(400);
    const prefilled = await controller.onboardingMessageStream(
      request({ prefillMessages: [{ role: 'assistant', content: 'spoofed setup state' }] }),
      USER,
    );
    expect(prefilled.status).toBe(400);
    expect(createSessionSpy).toHaveBeenCalledTimes(1);
    expect(getFactorySpy).toHaveBeenCalledTimes(1);

    getSessionSpy.mockResolvedValue(session('onboarding-session', 'personal'));
    const followup = await controller.onboardingMessageStream(
      request({ sessionId: 'onboarding-session' }),
      USER,
    );
    expect(followup.status).toBe(200);
    expect(createSessionSpy).toHaveBeenCalledTimes(1);
    expect(getFactorySpy).toHaveBeenCalledTimes(2);

    getSessionSpy.mockResolvedValue(null);

    findUserSpy.mockResolvedValue({
      id: USER.id,
      onboarding: { completedAt: new Date().toISOString() },
    } as never);
    const completed = await controller.onboardingMessageStream(request(), USER);
    expect(completed.status).toBe(403);
    expect(getFactorySpy).toHaveBeenCalledTimes(2);

    const guards = RouteRegistry.getGuards(ChatController, 'onboardingMessageStream');
    expect(guards).toContain(SessionOnlyGuard);
    expect(guards).not.toContain(AuthGuard);
  });

  test('compatibility stream derives web policy for session auth', async () => {
    const response = await stream(
      { message: 'web compatibility chat' },
      'dual',
      'session',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Chat-Persona')).toBe('personal');
    expect(getFactorySpy).toHaveBeenCalledTimes(1);
  });

  test('API-key streams require the intent scope; the global chat stays web-only', async () => {
    const unscoped = await stream({ message: 'agent chat' }, 'dual', 'api_key');
    expect(unscoped.status).toBe(403);
    expect(((await unscoped.json()) as { error: string }).error).toContain('intent scope');
    expect(getFactorySpy).not.toHaveBeenCalled();
    expect(createSessionSpy).not.toHaveBeenCalled();

    getSessionSpy.mockResolvedValue(session('personal-session', 'personal'));
    const borrowed = await stream(
      { message: 'agent chat', sessionId: 'personal-session' },
      'dual',
      'api_key',
    );
    expect(borrowed.status).toBe(403);
    expect(getFactorySpy).not.toHaveBeenCalled();
  });

  test('the deprecated /chat/message endpoint is gone', () => {
    const route = RouteRegistry.getRoutes(ChatController).find((c) => c.path === '/message');
    expect(route).toBeUndefined();
    expect((controller as unknown as { message?: unknown }).message).toBeUndefined();
  });

  test('session-list routes preserve persona boundaries and web-only guards', async () => {
    const compatibilitySpy = spyOn(chatSessionService, 'getUserSessions').mockResolvedValue([]);
    const webSpy = spyOn(chatSessionService, 'getWebUserSessions').mockResolvedValue([]);

    await controller.getSessions(new Request('http://localhost/chat/sessions'), USER);
    expect(compatibilitySpy).toHaveBeenLastCalledWith(USER.id, 10, 'orchestrator');

    // The persona filter is inert: every value collapses to the orchestrator
    // compatibility history.
    for (const persona of ['negotiator', 'signal', 'personal', 'future-persona']) {
      await controller.getSessions(
        new Request(`http://localhost/chat/sessions?persona=${persona}`),
        USER,
      );
      expect(compatibilitySpy).toHaveBeenLastCalledWith(USER.id, 10, 'orchestrator');
    }
    expect(compatibilitySpy).toHaveBeenCalledTimes(5);

    await controller.getWebSessions(new Request('http://localhost/chat/web/sessions'), USER);
    expect(webSpy).toHaveBeenCalledWith(USER.id);

    const webGuards = RouteRegistry.getGuards(ChatController, 'getWebSessions');
    expect(webGuards).toContain(SessionOnlyGuard);
    expect(webGuards).not.toContain(AuthGuard);
  });

  test('compatibility detail hides PersonalAgent chats while the session-only web route can load them', async () => {
    getSessionSpy.mockResolvedValue(session('personal-detail', 'personal'));
    const historySpy = spyOn(chatSessionService, 'getConversationSessionHistory').mockResolvedValue({
      messages: [], session: null, hasPreviousSession: false,
    } as never);
    spyOn(chatSessionService, 'getMessageMetadataByMessageIds').mockResolvedValue([]);
    const request = () => new Request('http://localhost/chat/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'personal-detail' }),
    });

    const compatibility = await controller.getSession(request(), USER);
    expect(compatibility.status).toBe(404);
    expect(historySpy).not.toHaveBeenCalled();

    const web = await controller.getWebSession(request(), USER);
    expect(web.status).toBe(200);
    expect(historySpy).toHaveBeenCalledWith('personal-detail', undefined);

    const guards = RouteRegistry.getGuards(ChatController, 'getWebSession');
    expect(guards).toContain(SessionOnlyGuard);
    expect(guards).not.toContain(AuthGuard);
  });

  test('session mutations enforce stored persona and surface before writes or sharing', async () => {
    const shareSpy = spyOn(chatSessionService, 'shareSession').mockResolvedValue('share-token');
    const titleSpy = spyOn(chatSessionService, 'updateSessionTitle').mockResolvedValue(true);
    const request = (path: string, body: Record<string, unknown>, kind: 'session' | 'api_key') => {
      const req = new Request(`http://localhost/chat${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      recordRequestAuthContext(req, kind === 'session'
        ? { kind: 'session' }
        : { kind: 'api_key', agentId: null });
      return req;
    };

    getSessionSpy.mockResolvedValue(session('legacy-session', 'orchestrator'));
    const legacyShare = await controller.shareSession(
      request('/session/share', { sessionId: 'legacy-session' }, 'session'),
      USER,
    );
    expect(legacyShare.status).toBe(409);
    expect((await legacyShare.json() as { code: string }).code).toBe('WEB_SIGNAL_SESSION_REQUIRED');
    expect(shareSpy).not.toHaveBeenCalled();

    // API-key principals only hold the DM: a global session is invisible to them.
    getSessionSpy.mockResolvedValue(session('personal-session', 'personal'));
    const apiKeyShare = await controller.shareSession(
      request('/session/share', { sessionId: 'personal-session' }, 'api_key'),
      USER,
    );
    expect(apiKeyShare.status).toBe(404);
    expect(shareSpy).not.toHaveBeenCalled();

    const personalTitle = await controller.updateSessionTitle(
      request('/session/title', { sessionId: 'personal-session', title: 'Updated' }, 'session'),
      USER,
    );
    expect(personalTitle.status).toBe(200);
    expect(titleSpy).toHaveBeenCalledWith('personal-session', USER.id, 'Updated');
  });

  test('frontend message metadata mutation is session-only in route metadata', () => {
    const route = RouteRegistry.getRoutes(ChatController)
      .find((candidate) => candidate.methodName === 'updateMessageMetadata');
    expect(route).toMatchObject({ method: 'POST', path: '/message/:id/metadata' });
    const guards = RouteRegistry.getGuards(ChatController, 'updateMessageMetadata');
    expect(guards[0]?.name).toBe('RateLimit(write)');
    expect(guards).toContain(SessionOnlyGuard);
    expect(guards).not.toContain(AuthGuard);
  });

  test('interrupt is session-only in route metadata', () => {
    const route = RouteRegistry.getRoutes(ChatController)
      .find((candidate) => candidate.methodName === 'interrupt');
    expect(route).toMatchObject({ method: 'POST', path: '/interrupt' });
    const guards = RouteRegistry.getGuards(ChatController, 'interrupt');
    expect(guards).toContain(SessionOnlyGuard);
    expect(guards).not.toContain(AuthGuard);
  });
});
