process.env.OPENROUTER_API_KEY = 'test-key';
process.env.NODE_ENV = 'test';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

import type { ChatGraphFactory } from '@indexnetwork/protocol';

import { ChatController } from '../chat.controller';
import type { AuthenticatedUser } from '../../guards/auth.guard';
import { chatSessionService } from '../../services/chat.service';
import { fileService } from '../../services/file.service';

const USER: AuthenticatedUser = {
  id: 'signal-user-1',
  email: 'signal@example.com',
  name: 'Signal User',
};

const signalInputs: Array<Record<string, unknown>> = [];
const orchestratorInputs: Array<Record<string, unknown>> = [];

function factoryFor(inputs: Array<Record<string, unknown>>): ChatGraphFactory {
  return {
    async *streamChatEventsWithContext(input: Record<string, unknown>) {
      inputs.push(input);
      yield { type: 'response_complete', response: 'Done.' };
    },
  } as unknown as ChatGraphFactory;
}

const signalFactory = factoryFor(signalInputs);
const orchestratorFactory = factoryFor(orchestratorInputs);

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
  surface: 'web' | 'non_web',
) {
  const abortController = new AbortController();
  const req = new Request('http://localhost/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ useCheckpointer: false, ...body }),
    signal: abortController.signal,
  });
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
  let previousFlag: string | undefined;
  let previousNegotiatorFlag: string | undefined;
  let createSessionSpy: ReturnType<typeof spyOn>;
  let getSessionSpy: ReturnType<typeof spyOn>;
  let addMessageSpy: ReturnType<typeof spyOn>;
  let getSignalFactorySpy: ReturnType<typeof spyOn>;
  let getOrchestratorFactorySpy: ReturnType<typeof spyOn>;
  let loadFilesSpy: ReturnType<typeof spyOn>;

  beforeAll(() => {
    previousFlag = process.env.WEB_SIGNAL_AGENT_ENABLED;
    previousNegotiatorFlag = process.env.NEGOTIATOR_CHAT_ENABLED;
  });

  beforeEach(() => {
    signalInputs.length = 0;
    orchestratorInputs.length = 0;
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
    getOrchestratorFactorySpy = spyOn(chatSessionService, 'getGraphFactory').mockReturnValue(orchestratorFactory);
    loadFilesSpy = spyOn(fileService, 'loadAttachedFileContent').mockResolvedValue('file contents');
  });

  afterEach(() => {
    mock.restore();
    if (previousFlag === undefined) delete process.env.WEB_SIGNAL_AGENT_ENABLED;
    else process.env.WEB_SIGNAL_AGENT_ENABLED = previousFlag;
    if (previousNegotiatorFlag === undefined) delete process.env.NEGOTIATOR_CHAT_ENABLED;
    else process.env.NEGOTIATOR_CHAT_ENABLED = previousNegotiatorFlag;
  });

  afterAll(() => {
    if (previousFlag === undefined) delete process.env.WEB_SIGNAL_AGENT_ENABLED;
    else process.env.WEB_SIGNAL_AGENT_ENABLED = previousFlag;
    if (previousNegotiatorFlag === undefined) delete process.env.NEGOTIATOR_CHAT_ENABLED;
    else process.env.NEGOTIATOR_CHAT_ENABLED = previousNegotiatorFlag;
  });

  test('flag-on web creation explicitly persists Signal and uses its factory', async () => {
    process.env.WEB_SIGNAL_AGENT_ENABLED = 'true';

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
    expect(getOrchestratorFactorySpy).not.toHaveBeenCalled();
    expect(signalInputs).toHaveLength(1);
  });

  test('persisted Signal persona is inherited when the followup omits persona', async () => {
    process.env.WEB_SIGNAL_AGENT_ENABLED = 'true';
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
    process.env.WEB_SIGNAL_AGENT_ENABLED = 'true';
    process.env.NEGOTIATOR_CHAT_ENABLED = 'true';
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
    expect(getOrchestratorFactorySpy).not.toHaveBeenCalled();
    expect(addMessageSpy).not.toHaveBeenCalled();
  });

  test('legacy orchestrator session loads but a web turn is rejected without side effects', async () => {
    process.env.WEB_SIGNAL_AGENT_ENABLED = 'true';
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
    expect(getOrchestratorFactorySpy).not.toHaveBeenCalled();
  });

  test('unknown persisted persona never falls back to orchestrator', async () => {
    process.env.WEB_SIGNAL_AGENT_ENABLED = 'true';
    getSessionSpy.mockResolvedValue(session('unknown-session', 'unknown'));

    const response = await stream(
      controller,
      { message: 'continue', sessionId: 'unknown-session' },
      'web',
    );
    const payload = await response.json() as { code: string };

    expect(response.status).toBe(409);
    expect(payload.code).toBe('CHAT_PERSONA_UNSUPPORTED');
    expect(getOrchestratorFactorySpy).not.toHaveBeenCalled();
    expect(addMessageSpy).not.toHaveBeenCalled();
  });

  test('flag off restores ordinary web orchestrator routing', async () => {
    process.env.WEB_SIGNAL_AGENT_ENABLED = 'false';

    const response = await stream(
      controller,
      { message: 'ordinary chat' },
      'web',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Chat-Persona')).toBe('orchestrator');
    expect(createSessionSpy).toHaveBeenCalledWith(
      USER.id,
      undefined,
      undefined,
      undefined,
      'orchestrator',
    );
    expect(getOrchestratorFactorySpy).toHaveBeenCalledTimes(1);
    expect(orchestratorInputs).toHaveLength(1);
  });

  test('web and compatibility intent resolvers select distinct personas', async () => {
    process.env.WEB_SIGNAL_AGENT_ENABLED = 'true';
    const resolveSpy = spyOn(chatSessionService, 'resolveSessionForScope').mockImplementation(
      async (_userId, _scope, persona) => ({
        session: session(`${persona}-intent-session`, persona ?? 'orchestrator'),
        created: true,
      }),
    );
    const request = (persona?: 'signal') => new Request('http://localhost/chat/session/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scopeType: 'intent',
        scopeId: 'intent-1',
        ...(persona ? { persona } : {}),
      }),
    });

    const webResponse = await controller.webResolveSession(request('signal'), USER);
    expect(webResponse.status).toBe(200);
    expect(resolveSpy).toHaveBeenLastCalledWith(
      USER.id,
      { scopeType: 'intent', scopeId: 'intent-1' },
      'signal',
    );

    const compatibilityResponse = await controller.resolveSession(request(), USER);
    expect(compatibilityResponse.status).toBe(200);
    expect(resolveSpy).toHaveBeenLastCalledWith(
      USER.id,
      { scopeType: 'intent', scopeId: 'intent-1' },
      'orchestrator',
    );
  });

  test('CLI/API non-web callers retain orchestrator behavior while the web flag is on', async () => {
    process.env.WEB_SIGNAL_AGENT_ENABLED = 'true';

    const response = await stream(
      controller,
      { message: 'non-web chat' },
      'non_web',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Chat-Persona')).toBe('orchestrator');
    expect(getOrchestratorFactorySpy).toHaveBeenCalledTimes(1);
    expect(getSignalFactorySpy).not.toHaveBeenCalled();
  });
});
