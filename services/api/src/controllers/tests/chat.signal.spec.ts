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
import { fileService } from '../../services/file.service';
import { userService } from '../../services/user.service';

const USER: AuthenticatedUser = {
  id: 'signal-user-1',
  email: 'signal@example.com',
  name: 'Signal User',
};

const signalInputs: Array<Record<string, unknown>> = [];
const onboardingInputs: Array<Record<string, unknown>> = [];

function factoryFor(inputs: Array<Record<string, unknown>>): ChatGraphFactory {
  return {
    async *streamChatEventsWithContext(input: Record<string, unknown>) {
      inputs.push(input);
      yield { type: 'response_complete', response: 'Done.' };
    },
  } as unknown as ChatGraphFactory;
}

const signalFactory = factoryFor(signalInputs);
const onboardingFactory = factoryFor(onboardingInputs);

function session(id: string, persona: string) {
  return {
    id,
    userId: USER.id,
    title: null,
    persona,
    networkId: null,
    scopeType: null,
    scopeId: null,
    shareToken: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function stream(
  controller: ChatController,
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

describe('Signal Agent web chat routing (IND-449)', () => {
  let controller: ChatController;
  let createSessionSpy: ReturnType<typeof spyOn>;
  let getSessionSpy: ReturnType<typeof spyOn>;
  let addMessageSpy: ReturnType<typeof spyOn>;
  let getSignalFactorySpy: ReturnType<typeof spyOn>;
  let getOnboardingFactorySpy: ReturnType<typeof spyOn>;
  let loadFilesSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    signalInputs.length = 0;
    onboardingInputs.length = 0;
    controller = new ChatController();

    createSessionSpy = spyOn(chatSessionService, 'createSession').mockResolvedValue('new-session');
    getSessionSpy = spyOn(chatSessionService, 'getSession').mockResolvedValue(null);
    addMessageSpy = spyOn(chatSessionService, 'addMessage').mockResolvedValue('message-1');
    spyOn(chatSessionService, 'getCheckpointer').mockResolvedValue(undefined);
    spyOn(chatSessionService, 'generateSessionTitle').mockResolvedValue(undefined);
    spyOn(chatSessionService, 'getSessionMetadata').mockResolvedValue(undefined);
    spyOn(chatSessionService, 'upsertSessionMetadata').mockResolvedValue();
    spyOn(chatSessionService, 'saveMessageMetadata').mockResolvedValue();
    getSignalFactorySpy = spyOn(chatSessionService, 'getSignalGraphFactory').mockReturnValue(signalFactory);
    getOnboardingFactorySpy = spyOn(chatSessionService, 'getOnboardingGraphFactory').mockReturnValue(onboardingFactory);
    loadFilesSpy = spyOn(fileService, 'loadAttachedFileContent').mockResolvedValue('file contents');
  });

  afterEach(() => {
    mock.restore();
  });

  test('web creation explicitly persists Signal and uses its factory', async () => {

    const response = await stream(
      controller,
      { message: 'Help refine my signal', persona: 'signal' },
      'web',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Session-Id')).toBe('new-session');
    expect(response.headers.get('X-Chat-Persona')).toBe('signal');
    expect(createSessionSpy).toHaveBeenCalledWith(
      USER.id,
      undefined,
      undefined,
      undefined,
      'signal',
    );
    expect(getSignalFactorySpy).toHaveBeenCalledTimes(1);
    expect(signalInputs).toHaveLength(1);
  });

  test('the signals persona is named from the user own personal agent row', async () => {
    // Every persona introduces itself as the user's agent, so the restricted
    // surfaces read the same `type='personal'` row the negotiator does.
    const agentSpy = spyOn(agentService, 'getNegotiatorAgent')
      .mockResolvedValue({ id: 'agent-1', name: "Signal User's Agent" } as never);

    await stream(controller, { message: 'Draft a signal', persona: 'signal' }, 'web');
    expect(getSignalFactorySpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "Signal User's Agent" }),
    );

    // A missing row is not fatal here: the prompt falls back to a generic
    // self-description rather than failing the turn or naming a product.
    agentSpy.mockResolvedValue(null as never);
    await stream(controller, { message: 'Draft another', persona: 'signal' }, 'web');
    expect(getSignalFactorySpy).toHaveBeenLastCalledWith(null);
  });

  test('persisted Signal persona is inherited when the followup omits persona', async () => {
    getSessionSpy.mockResolvedValue(session('signal-session', 'signal'));

    const response = await stream(
      controller,
      { message: 'Now archive the older one', sessionId: 'signal-session' },
      'web',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Chat-Persona')).toBe('signal');
    expect(createSessionSpy).not.toHaveBeenCalled();
    expect(getSignalFactorySpy).toHaveBeenCalledTimes(1);
  });

  test('request/stored persona mismatch fails closed before graph or writes', async () => {
    getSessionSpy.mockResolvedValue(session('signal-session', 'signal'));

    const response = await stream(
      controller,
      { message: 'spoof', sessionId: 'signal-session', persona: 'negotiator' },
      'web',
    );
    const payload = await response.json() as { code: string };

    expect(response.status).toBe(409);
    expect(payload.code).toBe('CHAT_PERSONA_MISMATCH');
    expect(getSignalFactorySpy).not.toHaveBeenCalled();
    expect(addMessageSpy).not.toHaveBeenCalled();
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
      controller,
      { sessionId: 'legacy-session', fileIds: ['file-1'] },
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
    expect(loadFilesSpy).not.toHaveBeenCalled();
    expect(getSignalFactorySpy).not.toHaveBeenCalled();
  });

  test('unknown persisted persona never falls back to orchestrator', async () => {
    getSessionSpy.mockResolvedValue(session('unknown-session', 'unknown'));

    const response = await stream(
      controller,
      { message: 'continue', sessionId: 'unknown-session' },
      'web',
    );
    const payload = await response.json() as { code: string };

    expect(response.status).toBe(409);
    expect(payload.code).toBe('CHAT_PERSONA_UNSUPPORTED');
    expect(addMessageSpy).not.toHaveBeenCalled();
  });

  test('web stream with no persona is refused; there is no default to fall back to', async () => {
    const response = await stream(controller, { message: 'ordinary chat' }, 'web');
    const payload = await response.json() as { code: string };

    expect(response.status).toBe(409);
    expect(payload.code).toBe('WEB_SIGNAL_PERSONA_REQUIRED');
    expect(createSessionSpy).not.toHaveBeenCalled();
    expect(addMessageSpy).not.toHaveBeenCalled();
  });

  test('intent resolvers require an explicit persona off the web surface', async () => {
    const resolveSpy = spyOn(chatSessionService, 'resolveSessionForScope').mockImplementation(
      async (_userId, _scope, persona) => ({
        session: session(`${persona}-intent-session`, persona),
        created: true,
      }),
    );
    const request = (persona?: 'signal', authKind?: 'session' | 'api_key') => {
      const req = new Request('http://localhost/chat/session/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopeType: 'intent', scopeId: 'intent-1', ...(persona ? { persona } : {}) }),
      });
      if (authKind === 'session') recordRequestAuthContext(req, { kind: 'session' });
      else if (authKind === 'api_key') recordRequestAuthContext(req, { kind: 'api_key', agentId: null });
      return req;
    };

    const webResponse = await controller.webResolveSession(request('signal'), USER);
    expect(webResponse.status).toBe(200);
    expect(resolveSpy).toHaveBeenLastCalledWith(USER.id, { scopeType: 'intent', scopeId: 'intent-1' }, 'signal');

    resolveSpy.mockClear();
    const apiKeyResponse = await controller.resolveSession(request(undefined, 'api_key'), USER);
    expect(apiKeyResponse.status).toBe(409);
    expect((await apiKeyResponse.json() as { code: string }).code).toBe('CHAT_PERSONA_REQUIRED');
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  test('onboarding authoritatively persists and inherits its persona while incomplete', async () => {
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
    expect(allowed.headers.get('X-Chat-Persona')).toBe('onboarding');
    expect(createSessionSpy).toHaveBeenLastCalledWith(
      USER.id,
      undefined,
      undefined,
      undefined,
      'onboarding',
    );
    expect(getOnboardingFactorySpy).toHaveBeenCalledTimes(1);
    expect(getSignalFactorySpy).not.toHaveBeenCalled();

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
    expect(getOnboardingFactorySpy).toHaveBeenCalledTimes(1);

    getSessionSpy.mockResolvedValue(session('onboarding-session', 'onboarding'));
    const followup = await controller.onboardingMessageStream(
      request({ sessionId: 'onboarding-session' }),
      USER,
    );
    expect(followup.status).toBe(200);
    expect(followup.headers.get('X-Chat-Persona')).toBe('onboarding');
    expect(createSessionSpy).toHaveBeenCalledTimes(1);
    expect(getOnboardingFactorySpy).toHaveBeenCalledTimes(2);

    const spoofed = await controller.onboardingMessageStream(
      request({ sessionId: 'onboarding-session', persona: 'signal' }),
      USER,
    );
    expect(spoofed.status).toBe(409);
    expect(getSignalFactorySpy).not.toHaveBeenCalled();

    getSessionSpy.mockResolvedValue(null);

    findUserSpy.mockResolvedValue({
      id: USER.id,
      onboarding: { completedAt: new Date().toISOString() },
    } as never);
    const completed = await controller.onboardingMessageStream(request(), USER);
    expect(completed.status).toBe(403);
    expect(getOnboardingFactorySpy).toHaveBeenCalledTimes(2);

    const guards = RouteRegistry.getGuards(ChatController, 'onboardingMessageStream');
    expect(guards).toContain(SessionOnlyGuard);
    expect(guards).not.toContain(AuthGuard);
  });

  test('compatibility stream denies a negotiator-persona session before every side effect', async () => {
    const resolveScopeSpy = spyOn(chatSessionService, 'resolveSessionForScope');
    const updateScopeSpy = spyOn(chatSessionService, 'updateSessionScope');

    const response = await stream(
      controller,
      {
        message: 'web compatibility chat',
        fileIds: ['file-1'],
        scopeType: 'intent',
        scopeId: 'intent-1',
      },
      'dual',
      'session',
    );
    const payload = await response.json() as { code: string };

    expect(response.status).toBe(409);
    expect(payload.code).toBe('WEB_SIGNAL_PERSONA_REQUIRED');
    expect(loadFilesSpy).not.toHaveBeenCalled();
    expect(resolveScopeSpy).not.toHaveBeenCalled();
    expect(createSessionSpy).not.toHaveBeenCalled();
    expect(updateScopeSpy).not.toHaveBeenCalled();
    expect(getSignalFactorySpy).not.toHaveBeenCalled();
    expect(addMessageSpy).not.toHaveBeenCalled();
  });

  test('compatibility stream derives web policy for session auth', async () => {

    const response = await stream(
      controller,
      { message: 'web compatibility chat', persona: 'signal' },
      'dual',
      'session',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Chat-Persona')).toBe('signal');
    expect(getSignalFactorySpy).toHaveBeenCalledTimes(1);
  });

  test('API-key stream must name a persona; Signal stays web-only', async () => {
    const unnamed = await stream(controller, { message: 'agent chat' }, 'dual', 'api_key');
    expect(unnamed.status).toBe(409);
    expect((await unnamed.json() as { code: string }).code).toBe('CHAT_PERSONA_REQUIRED');
    expect(getSignalFactorySpy).not.toHaveBeenCalled();
    expect(createSessionSpy).not.toHaveBeenCalled();

    const borrowed = await stream(controller, { message: 'agent chat', persona: 'signal' }, 'dual', 'api_key');
    expect(borrowed.status).toBe(403);
    expect((await borrowed.json() as { code: string }).code).toBe('WEB_SIGNAL_PERSONA_FORBIDDEN');
    expect(getSignalFactorySpy).not.toHaveBeenCalled();
  });

  test('compatibility resolver denies a negotiator-persona session before scope resolution', async () => {
    const resolveSpy = spyOn(chatSessionService, 'resolveSessionForScope');
    const req = new Request('http://localhost/chat/session/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scopeType: 'intent', scopeId: 'intent-1' }),
    });
    recordRequestAuthContext(req, { kind: 'session' });

    const response = await controller.resolveSession(req, USER);
    const payload = await response.json() as { code: string };

    expect(response.status).toBe(409);
    expect(payload.code).toBe('WEB_SIGNAL_PERSONA_REQUIRED');
    expect(resolveSpy).not.toHaveBeenCalled();
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

    // The negotiator filter is gone with the unscoped DM it served: every
    // persona now collapses to the orchestrator compatibility history.
    await controller.getSessions(
      new Request('http://localhost/chat/sessions?persona=negotiator'),
      USER,
    );
    expect(compatibilitySpy).toHaveBeenLastCalledWith(USER.id, 10, 'orchestrator');

    await controller.getSessions(
      new Request('http://localhost/chat/sessions?persona=signal'),
      USER,
    );
    expect(compatibilitySpy).toHaveBeenLastCalledWith(USER.id, 10, 'orchestrator');

    await controller.getSessions(
      new Request('http://localhost/chat/sessions?persona=future-persona'),
      USER,
    );
    expect(compatibilitySpy).toHaveBeenLastCalledWith(USER.id, 10, 'orchestrator');
    expect(compatibilitySpy).toHaveBeenCalledTimes(4);

    await controller.getWebSessions(new Request('http://localhost/chat/web/sessions'), USER);
    expect(webSpy).toHaveBeenCalledWith(USER.id);

    const webGuards = RouteRegistry.getGuards(ChatController, 'getWebSessions');
    expect(webGuards).toContain(SessionOnlyGuard);
    expect(webGuards).not.toContain(AuthGuard);
  });

  test('compatibility detail hides Signal while the session-only web route can load it', async () => {
    getSessionSpy.mockResolvedValue(session('signal-detail', 'signal'));
    const historySpy = spyOn(chatSessionService, 'getConversationSessionHistory').mockResolvedValue({
      messages: [], session: null, hasPreviousSession: false,
    } as never);
    spyOn(chatSessionService, 'getMessageMetadataByMessageIds').mockResolvedValue([]);
    const request = () => new Request('http://localhost/chat/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'signal-detail' }),
    });

    const compatibility = await controller.getSession(request(), USER);
    expect(compatibility.status).toBe(404);
    expect(historySpy).not.toHaveBeenCalled();

    const web = await controller.getWebSession(request(), USER);
    expect(web.status).toBe(200);
    expect(historySpy).toHaveBeenCalledWith('signal-detail', undefined);

    const guards = RouteRegistry.getGuards(ChatController, 'getWebSession');
    expect(guards).toContain(SessionOnlyGuard);
    expect(guards).not.toContain(AuthGuard);
  });

  test('session mutations enforce stored persona before writes or sharing', async () => {
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

    getSessionSpy.mockResolvedValue(session('signal-session', 'signal'));
    const apiKeyShare = await controller.shareSession(
      request('/session/share', { sessionId: 'signal-session' }, 'api_key'),
      USER,
    );
    expect(apiKeyShare.status).toBe(404);
    expect(shareSpy).not.toHaveBeenCalled();

    const signalTitle = await controller.updateSessionTitle(
      request('/session/title', { sessionId: 'signal-session', title: 'Updated' }, 'session'),
      USER,
    );
    expect(signalTitle.status).toBe(200);
    expect(titleSpy).toHaveBeenCalledWith('signal-session', USER.id, 'Updated');
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
