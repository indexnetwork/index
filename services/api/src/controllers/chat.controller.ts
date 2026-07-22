import { z } from "zod";

import { AuthGuard, SessionOnlyGuard, type AuthenticatedUser } from "../guards/auth.guard";
import { RateLimit } from "../guards/limiter.guard";
import { requestContext } from "../lib/request-context";
import { getRequestAuthContext } from '../lib/request-auth-context';
import { log } from "../lib/log";
import { deprecatedRoute } from "../lib/router/deprecated-route";
import { Controller, Get, Post, UseGuards } from "../lib/router/router.decorators";
import { chatSessionService, type ChatStreamSurface } from "../services/chat.service";
import { fileService } from "../services/file.service";
import { agentService } from "../services/agent.service";
import { userService } from "../services/user.service";
import { isNegotiatorChatEnabled } from "../lib/negotiator-feature";
import { isAgentSurfaceEnabled } from '../lib/agent-surface-feature';
import { negotiationReflectQueue } from "../queues/negotiations/reflect.queue";
import { SuggestionGenerator, ChatInterruptClassifier, NEGOTIATOR_PERSONA_ID, ONBOARDING_PERSONA_ID, ORCHESTRATOR_PERSONA_ID, REPORTER_PERSONA_ID, SIGNAL_PERSONA_ID } from '@indexnetwork/protocol';
import { createDoneEvent, createErrorEvent, createStatusEvent, createSteerOrQueueEvent, formatSSEEvent, type DebugMetaDiscoveryQuestions } from "../types/chat-streaming.types";
import { emitChatInterrupt, onChatInterrupt } from '../lib/chat-interrupt.events';

type RouteParams = Record<string, string>;
type ChatScope = { scopeType: 'network' | 'intent'; scopeId: string };

const logger = log.controller.from("chat");

function normalizeChatScope(input: {
  scopeType?: 'network' | 'intent' | null;
  scopeId?: string | null;
  networkId?: string | null;
}): ChatScope | Response | undefined {
  const explicitScopeType = input.scopeType ?? undefined;
  const explicitScopeId = input.scopeId?.trim() || undefined;
  const legacyNetworkId = input.networkId?.trim() || undefined;

  if (explicitScopeType && !explicitScopeId) {
    return Response.json({ error: 'scopeId is required when scopeType is provided' }, { status: 400 });
  }
  if (!explicitScopeType && explicitScopeId) {
    return Response.json({ error: 'scopeType is required when scopeId is provided' }, { status: 400 });
  }
  if (explicitScopeType === 'intent' && legacyNetworkId) {
    return Response.json({ error: 'networkId cannot be combined with intent scope' }, { status: 400 });
  }
  if (explicitScopeType === 'network' && legacyNetworkId && legacyNetworkId !== explicitScopeId) {
    return Response.json({ error: 'networkId must match scopeId when scopeType is network' }, { status: 400 });
  }

  if (explicitScopeType && explicitScopeId) {
    return { scopeType: explicitScopeType, scopeId: explicitScopeId };
  }
  if (legacyNetworkId) {
    return { scopeType: 'network', scopeId: legacyNetworkId };
  }
  return undefined;
}

function sessionScope(session: { scopeType?: string | null; scopeId?: string | null; networkId?: string | null } | null): ChatScope | undefined {
  if (!session) return undefined;
  if ((session.scopeType === 'network' || session.scopeType === 'intent') && session.scopeId?.trim()) {
    return { scopeType: session.scopeType, scopeId: session.scopeId.trim() };
  }
  if (session.networkId?.trim()) {
    return { scopeType: 'network', scopeId: session.networkId.trim() };
  }
  return undefined;
}

function sameScope(a: ChatScope | undefined, b: ChatScope | undefined): boolean {
  if (!a || !b) return a === b;
  return a.scopeType === b.scopeType && a.scopeId === b.scopeId;
}

const streamBodySchema = z.object({
  message: z.string().nullish(),
  sessionId: z.string().nullish(),
  useCheckpointer: z.boolean().optional(),
  fileIds: z.array(z.string().min(1)).max(20).optional(),
  /** @deprecated Use scopeType/scopeId. Retained as the REST edge alias for network-scoped sessions. */
  networkId: z.string().nullish(),
  scopeType: z.enum(['network', 'intent']).nullish(),
  scopeId: z.string().nullish(),
  /** The recipient user ID for DM-style chats (used for ghost invite emails). */
  recipientUserId: z.string().nullish(),
  /** Explicit persona assertion for a newly bootstrapped persona chat. */
  persona: z.enum(['negotiator', 'signal', 'reporter']).nullish(),
  prefillMessages: z.array(z.object({
    role: z.enum(["assistant", "user"]),
    content: z.string().max(10000),
  })).max(10).optional(),
});

let suggestionGeneratorInstance: SuggestionGenerator | null = null;
function getSuggestionGenerator(): SuggestionGenerator {
  if (!suggestionGeneratorInstance) {
    suggestionGeneratorInstance = new SuggestionGenerator();
  }
  return suggestionGeneratorInstance;
}

/** Optional body for POST /chat/negotiator/session (P4.2 intent pinning). */
const negotiatorSessionBodySchema = z.object({
  intentId: z.string().min(1).nullish(),
});

const reporterSessionBodySchema = z.object({
  forceNew: z.boolean().optional(),
}).strict();

const resolveSessionBodySchema = z.object({
  scopeType: z.enum(['intent']),
  scopeId: z.string().min(1),
  persona: z.enum(['signal', 'reporter']).optional(),
});

const interruptBodySchema = z.object({
  sessionId: z.string(),
  message: z.string().min(1),
  messageId: z.string().uuid(),
  traceSnapshot: z.array(z.string()).max(20).default([]),
});

/**
 * Resolve the caller's personal negotiator agent row (provisioning it when
 * missing — idempotent). Returns null for ghost or missing users, which
 * callers treat as 404.
 */
async function resolveNegotiatorAgent(userId: string) {
  return agentService.getNegotiatorAgent(userId);
}

let interruptClassifierInstance: ChatInterruptClassifier | null = null;
function getInterruptClassifier(): ChatInterruptClassifier {
  if (!interruptClassifierInstance) {
    interruptClassifierInstance = new ChatInterruptClassifier();
  }
  return interruptClassifierInstance;
}

@Controller("/chat")
export class ChatController {
  /** Map compatibility routes onto their authenticated product surface. */
  private compatibilitySurface(req: Request): ChatStreamSurface {
    return getRequestAuthContext(req)?.kind === 'session' ? 'web' : 'non_web';
  }

  /** Authorize an owned session mutation against its persisted persona. */
  private async authorizeSessionMutation(
    req: Request,
    user: AuthenticatedUser,
    sessionId: string,
  ): Promise<Response | { persona: string }> {
    const session = await chatSessionService.getSession(sessionId, user.id);
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const surface = this.compatibilitySurface(req);
    const storedPersona = session.persona ?? ORCHESTRATOR_PERSONA_ID;
    if (surface === 'non_web' && storedPersona !== ORCHESTRATOR_PERSONA_ID) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const policy = chatSessionService.resolveStreamPersonaPolicy({
      surface,
      storedPersona,
    });
    if (!policy.ok) {
      return Response.json({
        error: policy.error,
        code: policy.code,
        ...(policy.action ? { action: policy.action } : {}),
      }, { status: policy.status });
    }
    return { persona: policy.persona };
  }

  constructor(
    private readonly suggestionGenerator: () => Pick<SuggestionGenerator, 'generate'> = getSuggestionGenerator,
  ) {}
  /**
   * Send a message to the chat graph for processing.
   * The graph routes to appropriate subgraphs based on intent analysis.
   *
   * @param req - The HTTP request object (body: { message: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with graph execution result including responseText
   */
  @Post("/message")
  @deprecatedRoute('chat.message')
  @UseGuards(RateLimit('write'), AuthGuard)
  async message(req: Request, user: AuthenticatedUser) {
    const personaPolicy = chatSessionService.resolveStreamPersonaPolicy({
      surface: this.compatibilitySurface(req),
    });
    if (!personaPolicy.ok) {
      return Response.json(
        {
          error: personaPolicy.error,
          code: personaPolicy.code,
          ...(personaPolicy.action ? { action: personaPolicy.action } : {}),
        },
        { status: personaPolicy.status },
      );
    }

    // 1. Parse request body for message
    let messageContent: string;
    try {
      const body = (await req.json()) as { message?: string };
      messageContent = body.message || "";
    } catch {
      // No body or invalid JSON
      return Response.json(
        { error: "Invalid request body. Expected { message: string }" },
        { status: 400 },
      );
    }

    if (!messageContent.trim()) {
      return Response.json(
        { error: "Message content is required" },
        { status: 400 },
      );
    }

    // 2. Process message through service
    const result = await chatSessionService.processMessage(
      user.id,
      messageContent,
    );

    // 3. Return response
    return Response.json({
      response: result.responseText,
      error: result.error,
    });
  }

  /**
   * SSE streaming endpoint for chat messages with context support.
   * Streams graph events and LLM tokens in real-time, loading previous conversation context.
   *
   * @param req - The HTTP request object (body: { message: string, sessionId?: string, useCheckpointer?: boolean, fileIds?: string[] })
   * @param user - The authenticated user from AuthGuard
   * @returns SSE Response stream
   */
  @Post("/stream")
  @UseGuards(RateLimit('write'), AuthGuard)
  async messageStream(
    req: Request,
    user: AuthenticatedUser,
  ): Promise<Response> {
    return this.messageStreamForSurface(req, user, this.compatibilitySurface(req));
  }

  /** Main-web chat stream with server-selected Signal cutover policy. */
  @Post("/web/stream")
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async webMessageStream(
    req: Request,
    user: AuthenticatedUser,
  ): Promise<Response> {
    return this.messageStreamForSurface(req, user, 'web');
  }

  /**
   * Session-only onboarding exception. It is available only while the
   * authenticated user's authoritative onboarding record is incomplete. The
   * Signal cutover flag selects the restricted persisted onboarding persona;
   * flag-off keeps the legacy orchestrator flow.
   */
  @Post("/onboarding/stream")
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async onboardingMessageStream(
    req: Request,
    user: AuthenticatedUser,
  ): Promise<Response> {
    const currentUser = await userService.findById(user.id);
    if (!currentUser || currentUser.onboarding?.completedAt) {
      return Response.json({ error: "Onboarding chat is not available" }, { status: 403 });
    }
    return this.messageStreamForSurface(req, user, 'onboarding');
  }

  private async messageStreamForSurface(
    req: Request,
    user: AuthenticatedUser,
    surface: ChatStreamSurface,
  ): Promise<Response> {
    // 1. Parse and validate request body
    let body: z.infer<typeof streamBodySchema>;
    try {
      const raw = await req.json();
      const parsed = streamBodySchema.safeParse(raw);
      if (!parsed.success) {
        return Response.json(
          {
            error:
              "Invalid request body. Expected { message?: string | null, sessionId?: string | null, useCheckpointer?: boolean, fileIds?: string[], scopeType?: 'network' | 'intent' | null, scopeId?: string | null, networkId?: string | null }",
          },
          { status: 400 },
        );
      }
      body = parsed.data;
    } catch {
      return Response.json(
        {
          error: "Invalid JSON in request body",
        },
        { status: 400 },
      );
    }

    let messageContent = body.message?.trim() || "";
    const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];
    if (!messageContent && fileIds.length === 0) {
      return Response.json(
        { error: "Message content or file attachments are required" },
        { status: 400 },
      );
    }

    // 2. Validate or create session
    const requestedScope = normalizeChatScope(body);
    if (requestedScope instanceof Response) return requestedScope;

    // Captured by validateScope when an intent scope validates — used to pin
    // the signal by name in the negotiator prompt (P4.2) without re-fetching.
    let pinnedIntentLabel: string | undefined;

    const validateScope = async (scope: ChatScope | undefined) => {
      if (!scope) return undefined;
      if (scope.scopeType === 'network') {
        const validation = await chatSessionService.validateIndexScope(user.id, scope.scopeId);
        if (!validation.ok) {
          return Response.json({ error: validation.error }, { status: validation.status });
        }
        return undefined;
      }
      const validation = await chatSessionService.validateIntentScope(user.id, scope.scopeId);
      if (!validation.ok) {
        return Response.json({ error: validation.error }, { status: validation.status });
      }
      pinnedIntentLabel = validation.title;
      return undefined;
    };

    const requestedPersona = body.persona ?? undefined;
    if (requestedPersona === NEGOTIATOR_PERSONA_ID) {
      if (!isNegotiatorChatEnabled()) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      if (requestedScope?.scopeType === 'network') {
        return Response.json({ error: "Negotiator chat cannot be network-scoped" }, { status: 400 });
      }
    }

    let currentSessionId = body.sessionId;
    let loadedSession = currentSessionId
      ? await chatSessionService.getSession(currentSessionId, user.id)
      : null;
    if (currentSessionId && !loadedSession) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const personaPolicy = chatSessionService.resolveStreamPersonaPolicy({
      surface,
      requestedPersona,
      ...(loadedSession ? { storedPersona: loadedSession.persona } : {}),
    });
    if (!personaPolicy.ok) {
      return Response.json(
        {
          error: personaPolicy.error,
          code: personaPolicy.code,
          ...(personaPolicy.action ? { action: personaPolicy.action } : {}),
        },
        { status: personaPolicy.status },
      );
    }

    const sessionPersona = personaPolicy.persona;
    if (
      sessionPersona === ONBOARDING_PERSONA_ID
      && (requestedScope || sessionScope(loadedSession) || body.prefillMessages?.length)
    ) {
      return Response.json(
        { error: 'Restricted onboarding chats cannot be scoped or client-prefilled.' },
        { status: 400 },
      );
    }
    if (fileIds.length > 0) {
      const fileContent = await fileService.loadAttachedFileContent(
        user.id,
        fileIds,
      );
      if (fileContent) {
        messageContent = messageContent
          ? `${messageContent}\n\n[Attached files]\n${fileContent}`
          : `[Attached files]\n${fileContent}`;
      }
    }
    if (!messageContent) {
      return Response.json(
        { error: "Message content or file attachments are required" },
        { status: 400 },
      );
    }

    if (sessionPersona === NEGOTIATOR_PERSONA_ID) {
      if (!isNegotiatorChatEnabled()) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      if (requestedScope?.scopeType === 'network') {
        return Response.json({ error: "Negotiator chat cannot be network-scoped" }, { status: 400 });
      }
    }

    const requestScopeError = await validateScope(requestedScope);
    if (requestScopeError) return requestScopeError;

    let effectiveScope = requestedScope;
    let negotiatorAgent: Awaited<ReturnType<typeof resolveNegotiatorAgent>> = null;
    if (!currentSessionId && sessionPersona === NEGOTIATOR_PERSONA_ID) {
      negotiatorAgent = await resolveNegotiatorAgent(user.id);
      if (!negotiatorAgent) {
        return Response.json({ error: "Negotiator agent not available" }, { status: 404 });
      }
      const resolved = requestedScope?.scopeType === 'intent'
        ? await chatSessionService.resolveNegotiatorIntentSession(user.id, requestedScope.scopeId)
        : await chatSessionService.resolveNegotiatorSession(user.id, negotiatorAgent.name);
      if ('error' in resolved) {
        return Response.json({ error: resolved.error }, { status: resolved.status });
      }
      currentSessionId = resolved.session.id;
    } else if (!currentSessionId) {
      const initialTitle = body.prefillMessages?.length
        ? "Set Up Your Social Agent"
        : undefined;
      if (requestedScope?.scopeType === 'intent') {
        const resolved = await chatSessionService.resolveSessionForScope(
          user.id,
          requestedScope,
          sessionPersona,
        );
        if ('error' in resolved) {
          return Response.json({ error: resolved.error }, { status: resolved.status });
        }
        currentSessionId = resolved.session.id;
      } else {
        currentSessionId = await chatSessionService.createSession(
          user.id,
          initialTitle,
          requestedScope?.scopeType === 'network' ? requestedScope.scopeId : undefined,
          requestedScope,
          sessionPersona,
        );
      }
    } else if (loadedSession) {
      if (sessionPersona === NEGOTIATOR_PERSONA_ID) {
        if (requestedScope && !sessionScope(loadedSession)) {
          return Response.json({ error: "Negotiator DM cannot be scoped" }, { status: 400 });
        }
      }
      const persistedScope = sessionScope(loadedSession);
      if (requestedScope && persistedScope && !sameScope(requestedScope, persistedScope)) {
        return Response.json({ error: "Session is already scoped differently" }, { status: 409 });
      }
      if (requestedScope && !persistedScope) {
        if (sessionPersona === SIGNAL_PERSONA_ID) {
          return Response.json(
            {
              error: 'Start a separate Signal Agent chat for that focus.',
              code: 'CHAT_SCOPE_REQUIRES_NEW_SESSION',
              action: { type: 'start_signal_session', href: '/' },
            },
            { status: 409 },
          );
        }
        await chatSessionService.updateSessionScope(currentSessionId, user.id, requestedScope);
        loadedSession = await chatSessionService.getSession(currentSessionId, user.id);
      }
      effectiveScope = requestedScope ?? sessionScope(loadedSession);
    }

    const effectiveScopeError = await validateScope(effectiveScope);
    if (effectiveScopeError) return effectiveScopeError;

    if (sessionPersona === NEGOTIATOR_PERSONA_ID && !negotiatorAgent) {
      negotiatorAgent = await resolveNegotiatorAgent(user.id);
      if (!negotiatorAgent) {
        return Response.json({ error: "Negotiator agent not available" }, { status: 404 });
      }
    }

    const sessionId = currentSessionId;
    const factory = sessionPersona === ONBOARDING_PERSONA_ID
      ? chatSessionService.getOnboardingGraphFactory()
      : sessionPersona === SIGNAL_PERSONA_ID
        ? chatSessionService.getSignalGraphFactory()
      : sessionPersona === REPORTER_PERSONA_ID
        ? chatSessionService.getReporterGraphFactory()
        : sessionPersona === NEGOTIATOR_PERSONA_ID && negotiatorAgent
        ? await chatSessionService.getNegotiatorGraphFactory(
            negotiatorAgent,
            user.id,
            effectiveScope?.scopeType === 'intent' && pinnedIntentLabel
              ? { label: pinnedIntentLabel }
              : undefined,
          )
        : sessionPersona === ORCHESTRATOR_PERSONA_ID
          ? chatSessionService.getGraphFactory()
          : null;
    if (!factory) {
      return Response.json(
        { error: 'This chat cannot be continued safely.', code: 'CHAT_PERSONA_UNSUPPORTED' },
        { status: 409 },
      );
    }
    const useCheckpointer = body.useCheckpointer ?? true;
    const runId = crypto.randomUUID();
    const streamAbortController = new AbortController();
    // Forward HTTP client disconnect into the stream abort controller
    req.signal.addEventListener('abort', () => {
      if (!streamAbortController.signal.aborted) streamAbortController.abort('client_disconnect');
    }, { once: true });

    // User message is persisted after the stream completes (with the assistant response) so that
    // loadSessionContext during streaming does not include it and the current message is not
    // duplicated in the conversation context (which caused "You've listed the same project twice!").

    // 3. Get checkpointer if requested
    const checkpointer = useCheckpointer
      ? await chatSessionService.getCheckpointer()
      : undefined;
    if (useCheckpointer && checkpointer) {
      logger.verbose("PostgresSaver checkpointer initialized", { sessionId });
    }

    // 4. Create SSE stream
    const encoder = new TextEncoder();
    const rawOrigin = req.headers.get("origin");
    const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? "").split(",").map(o => o.trim()).filter(Boolean);
    const originUrl = rawOrigin && trustedOrigins.includes(rawOrigin) ? rawOrigin : undefined;
    const suggestionGenerator = this.suggestionGenerator;

    const stream = new ReadableStream({
      start(controller) {
        return requestContext.run({ originUrl }, async () => {
        let streamInterruptedBySteer = false;
        let unsubscribeInterrupt: (() => void) | null = null;
        try {
          // Subscribe to interrupt bus — one listener per stream, cleaned in finally
          unsubscribeInterrupt = onChatInterrupt(sessionId, ({ decision, messageId }) => {
            try {
              controller.enqueue(
                encoder.encode(
                  formatSSEEvent(createSteerOrQueueEvent(sessionId, decision, messageId)),
                ),
              );
            } catch {
              // Stream may have already closed
            }
            if (decision === 'steer') {
              streamInterruptedBySteer = true;
              streamAbortController.abort('steer');
            }
          });

          // Send initial status
          controller.enqueue(
            encoder.encode(
              formatSSEEvent(
                createStatusEvent(sessionId, "Processing message..."),
              ),
            ),
          );

          // Stream chat graph events with context
          let fullResponse = "";
          // Accumulates token events as a fallback for steer-interrupted streams where
          // response_complete may never fire. Cleared on response_reset (agent retry).
          let partialResponse = "";
          let routingDecision: Record<string, unknown> | undefined;
          let subgraphResults: Record<string, unknown> | undefined;
          let debugMeta: { graph: string; iterations: number; tools: unknown[]; llm?: unknown; orchestratorNegotiations?: unknown; discoveryQuestions?: DebugMetaDiscoveryQuestions } | undefined;
          let decisionQuestions: import("@indexnetwork/protocol").Question[] | undefined;

          // Use context-aware streaming to load previous messages

          for await (const event of factory.streamChatEventsWithContext(
            {
              userId: user.id,
              message: messageContent,
              sessionId,
              maxContextMessages: 20,
              ...(effectiveScope ? { scopeType: effectiveScope.scopeType, scopeId: effectiveScope.scopeId } : {}),
              prefillMessages: body.prefillMessages,
              runId,
            },
            checkpointer,
            streamAbortController.signal,
          )) {
            if (streamInterruptedBySteer) break;
            if (event) {
              // response_complete is an internal event carrying the agent's
              // authoritative final text — don't forward it to the SSE client.
              if (event.type === "response_complete") {
                fullResponse = event.response;
                partialResponse = ""; // authoritative text is now in fullResponse
              } else {
                controller.enqueue(encoder.encode(formatSSEEvent(event)));
                if (event.type === "token") {
                  partialResponse += (event as { content: string }).content;
                } else if (event.type === "response_reset") {
                  partialResponse = ""; // agent retrying — discard accumulated partial
                }
              }

              if (event.type === "routing") {
                routingDecision = {
                  target: event.target,
                  reasoning: event.reasoning,
                };
              } else if (event.type === "subgraph_result") {
                subgraphResults = {
                  ...subgraphResults,
                  [event.subgraph]: event.data,
                };
              } else if (event.type === "debug_meta") {
                debugMeta = {
                  graph: event.graph,
                  iterations: event.iterations,
                  tools: event.tools,
                  llm: event.llm,
                  ...(event.orchestratorNegotiations !== undefined && { orchestratorNegotiations: event.orchestratorNegotiations }),
                  ...(event.discoveryQuestions !== undefined && { discoveryQuestions: event.discoveryQuestions as DebugMetaDiscoveryQuestions }),
                };
              } else if (event.type === "decision_questions") {
                // Event was already forwarded by the default enqueue above; just
                // capture so the final `done` event can include `decisionQuestions`.
                decisionQuestions = (event as { questions: import("@indexnetwork/protocol").Question[] }).questions;
              }
            }
          }

          // Steer-interrupted: persist partial turn and bail (no done event emitted)
          if (streamInterruptedBySteer) {
            try {
              await chatSessionService.addMessage({ sessionId, role: 'user', content: messageContent });
              // Use authoritative fullResponse when available; fall back to accumulated
              // partial tokens when the stream was cut before response_complete fired.
              const interruptedContent = (fullResponse || partialResponse).trim();
              if (interruptedContent) {
                await chatSessionService.addMessage({
                  sessionId,
                  role: 'assistant',
                  content: interruptedContent,
                  interrupted: true,
                });
              }
            } catch (persistErr) {
              logger.error('Failed to persist interrupted turn', { sessionId, error: persistErr });
            }
            return; // finally block still runs → unsubscribeInterrupt + controller.close()
          }

          // Persist prefill messages (e.g. onboarding greeting) only for newly created sessions
          if (body.prefillMessages?.length && !body.sessionId) {
            for (const pm of body.prefillMessages) {
              await chatSessionService.addMessage({
                sessionId,
                role: pm.role,
                content: pm.content,
              });
            }
          }

          // Persist user message and assistant response
          await chatSessionService.addMessage({
            sessionId,
            role: "user",
            content: messageContent,
          });
          let assistantMessageId: string | undefined;
          if (fullResponse) {
            assistantMessageId = await chatSessionService.addMessage({
              sessionId,
              role: "assistant",
              content: fullResponse,
              routingDecision,
              subgraphResults,
            });
          }

          // Negotiator DM turns debounce-schedule a chat reflection (P5.2):
          // the job fires once the session has been idle for the delay window,
          // distilling stated preferences into negotiator memories. No-op when
          // NEGOTIATOR_MEMORY_WRITE_ENABLED is off; never blocks the stream.
          if (sessionPersona === NEGOTIATOR_PERSONA_ID && fullResponse) {
            negotiationReflectQueue.scheduleChatReflect({ sessionId, userId: user.id })
              .catch((err) => logger.error("Failed to schedule negotiator chat reflection", { sessionId, error: err }));
          }

          // Persist debug metadata (non-blocking for user experience)
          if (assistantMessageId && debugMeta) {
            try {
              // Save per-message metadata
              await chatSessionService.saveMessageMetadata({
                messageId: assistantMessageId,
                debugMeta,
              });

              // Accumulate session-level metadata
              const existingSessionMeta = await chatSessionService.getSessionMetadata(sessionId);
              const existingTurns = Array.isArray(
                (existingSessionMeta?.metadata as Record<string, unknown> | null)?.turns
              )
                ? (existingSessionMeta!.metadata as { turns: unknown[] }).turns
                : [];

              await chatSessionService.upsertSessionMetadata({
                sessionId,
                metadata: {
                  lastUpdated: new Date().toISOString(),
                  turns: [
                    ...existingTurns,
                    {
                      messageId: assistantMessageId,
                      graph: debugMeta.graph,
                      iterations: debugMeta.iterations,
                      toolCount: Array.isArray(debugMeta.tools) ? debugMeta.tools.length : 0,
                    },
                  ],
                },
              });
            } catch (metaError) {
              logger.error("Failed to persist debug metadata", { sessionId, error: metaError });
            }
          }

          // Skip title/suggestions generation if client disconnected or stream was aborted
          if (!req.signal.aborted && !streamAbortController.signal.aborted) {
            // Generate session title and suggestions in parallel
            const [sessionTitle, suggestions] = await Promise.all([
              chatSessionService.generateSessionTitle(sessionId, user.id),
              suggestionGenerator()
                .generate({
                  messages: [
                    { role: "user", content: messageContent },
                    { role: "assistant", content: fullResponse },
                  ],
                })
                .catch(() => []),
            ]);

            // Send done event with title and suggestions
            controller.enqueue(
              encoder.encode(
                formatSSEEvent(
                  createDoneEvent(sessionId, fullResponse, {
                    messageId: assistantMessageId,
                    routingDecision,
                    subgraphResults,
                    title: sessionTitle,
                    suggestions,
                    ...(decisionQuestions !== undefined ? { decisionQuestions } : {}),
                  }),
                ),
              ),
            );
          }
        } catch (error) {
          // AbortError is expected when the stream is intentionally stopped (steer
          // interrupt, client disconnect, or stopStream). Don't surface as STREAM_ERROR.
          if (!(error instanceof Error && error.name === 'AbortError')) {
            controller.enqueue(
              encoder.encode(
                formatSSEEvent(
                  createErrorEvent(
                    sessionId,
                    error instanceof Error ? error.message : "Unknown error",
                    "STREAM_ERROR",
                  ),
                ),
              ),
            );
          }
        } finally {
          unsubscribeInterrupt?.();
          controller.close();
        }
        }); // requestContext.run
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Session-Id": sessionId,
        "X-Chat-Persona": sessionPersona,
      },
    });
  }

  /**
   * Get all chat sessions for the authenticated user.
   *
   * @param req - The HTTP request object
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with list of sessions
   */
  @Get("/sessions")
  @UseGuards(RateLimit('read'), AuthGuard)
  async getSessions(req: Request, user: AuthenticatedUser) {
    // Compatibility history is orchestrator-only. The explicit negotiator
    // filter remains available for the pinned Personal Agent lookup, while
    // Signal history is reserved for the session-only web endpoint below.
    const personaParam = new URL(req.url).searchParams.get("persona")?.trim();
    const compatibilityPersona = personaParam === NEGOTIATOR_PERSONA_ID
      ? NEGOTIATOR_PERSONA_ID
      : ORCHESTRATOR_PERSONA_ID;
    const sessions = await chatSessionService.getUserSessions(
      user.id,
      undefined,
      compatibilityPersona,
    );
    return Response.json({ sessions });
  }

  /** Main-web history including orchestrator and Signal, but never negotiator. */
  @Get("/web/sessions")
  @UseGuards(RateLimit('read'), SessionOnlyGuard)
  async getWebSessions(_req: Request, user: AuthenticatedUser) {
    const sessions = await chatSessionService.getWebUserSessions(user.id);
    return Response.json({ sessions });
  }

  /**
   * Get-or-create the user's stable negotiator DM session (P4.1).
   * Idempotent: repeat calls return the same session — one persistent DM per
   * user, keyed by the chat_session_scopes unique index. Gated by
   * NEGOTIATOR_CHAT_ENABLED (404 when off, as if the route does not exist).
   *
   * @param _req - The HTTP request object (no body)
   * @param user - The authenticated user from AuthGuard
   * @returns JSON with the session, whether it was created, and the negotiator agent identity
   */
  @Post("/negotiator/session")
  @UseGuards(RateLimit('write'), AuthGuard)
  async negotiatorSession(req: Request, user: AuthenticatedUser) {
    if (!isNegotiatorChatEnabled()) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    // Body is optional (the sidebar posts none). `intentId` selects the
    // per-intent pinned session (P4.2) instead of the DM.
    let intentId: string | undefined;
    try {
      const raw: unknown = await req.json();
      const parsed = negotiatorSessionBodySchema.safeParse(raw);
      if (!parsed.success) {
        return Response.json(
          { error: "Invalid request body. Expected { intentId?: string }" },
          { status: 400 },
        );
      }
      intentId = parsed.data.intentId?.trim() || undefined;
    } catch {
      // No body / empty body — DM variant.
    }

    const agent = await resolveNegotiatorAgent(user.id);
    if (!agent) {
      return Response.json({ error: "Negotiator agent not available" }, { status: 404 });
    }

    const result = intentId
      ? await chatSessionService.resolveNegotiatorIntentSession(user.id, intentId)
      : await chatSessionService.resolveNegotiatorSession(user.id, agent.name);
    if ('error' in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({
      session: result.session,
      created: result.created,
      agent: { id: agent.id, name: agent.name, description: agent.description },
    });
  }

  /**
   * Resolve the current Reporter opening briefing for the authenticated web session.
   *
   * The route never accepts a persona. It returns the adapter's atomic creation
   * claim so only one tab sends the hidden opening marker. `forceNew` is reserved
   * for the explicit New conversation action and bypasses normal TTL reuse.
   *
   * @param req - Body `{ forceNew?: boolean }`
   * @param user - Session-authenticated user
   * @returns The authoritative reporter session and creation claim
   */
  @Post("/reporter/session")
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async reporterSession(req: Request, user: AuthenticatedUser) {
    if (!isAgentSurfaceEnabled()) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    let body: z.infer<typeof reporterSessionBodySchema>;
    try {
      const parsed = reporterSessionBodySchema.safeParse(await req.json());
      if (!parsed.success) {
        return Response.json(
          { error: "Invalid request body. Expected { forceNew?: boolean }" },
          { status: 400 },
        );
      }
      body = parsed.data;
    } catch {
      return Response.json(
        { error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    const result = await chatSessionService.resolveReporterSession(
      user.id,
      body.forceNew ?? false,
    );
    return Response.json(result);
  }

  /**
   * Resolve or create the stable orchestrator chat session for a selected intent.
   *
   * @param req - The HTTP request object (body: { scopeType: 'intent', scopeId: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with the resolved session and whether it was created
   */
  /** Resolve an intent-scoped session for the dedicated main-web surface. */
  @Post("/web/session/resolve")
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async webResolveSession(req: Request, user: AuthenticatedUser) {
    return this.resolveSessionForSurface(req, user, 'web');
  }

  @Post("/session/resolve")
  @UseGuards(RateLimit('write'), AuthGuard)
  async resolveSession(req: Request, user: AuthenticatedUser) {
    return this.resolveSessionForSurface(req, user, this.compatibilitySurface(req));
  }

  private async resolveSessionForSurface(
    req: Request,
    user: AuthenticatedUser,
    surface: ChatStreamSurface,
  ) {
    let body: z.infer<typeof resolveSessionBodySchema>;
    try {
      const raw = await req.json();
      const parsed = resolveSessionBodySchema.safeParse(raw);
      if (!parsed.success) {
        return Response.json(
          { error: "Invalid request body. Expected { scopeType: 'intent', scopeId: string }" },
          { status: 400 },
        );
      }
      body = parsed.data;
    } catch {
      return Response.json(
        { error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    const personaPolicy = chatSessionService.resolveStreamPersonaPolicy({
      surface,
      requestedPersona: body.persona,
    });
    if (!personaPolicy.ok) {
      return Response.json(
        {
          error: personaPolicy.error,
          code: personaPolicy.code,
          ...(personaPolicy.action ? { action: personaPolicy.action } : {}),
        },
        { status: personaPolicy.status },
      );
    }

    const result = await chatSessionService.resolveSessionForScope(user.id, {
      scopeType: body.scopeType,
      scopeId: body.scopeId,
    }, personaPolicy.persona);
    if ('error' in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ session: result.session, created: result.created });
  }

  /**
   * Get a specific session with its messages.
   * Uses POST with sessionId in body due to router limitations with path params.
   *
   * @param req - The HTTP request object (body: { sessionId: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with session and messages
   */
  @Post("/session")
  @UseGuards(RateLimit('write'), AuthGuard)
  async getSession(req: Request, user: AuthenticatedUser) {
    return this.getSessionForPersonas(req, user, new Set([ORCHESTRATOR_PERSONA_ID]));
  }

  /** Session-only web detail across readable web and pinned chat personas. */
  @Post("/web/session")
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async getWebSession(req: Request, user: AuthenticatedUser) {
    return this.getSessionForPersonas(
      req,
      user,
      new Set([ORCHESTRATOR_PERSONA_ID, SIGNAL_PERSONA_ID, REPORTER_PERSONA_ID, NEGOTIATOR_PERSONA_ID]),
    );
  }

  private async getSessionForPersonas(
    req: Request,
    user: AuthenticatedUser,
    allowedPersonas: ReadonlySet<string>,
  ) {
    let body: { sessionId?: string; beforeSessionId?: string };
    try {
      body = (await req.json()) as { sessionId?: string; beforeSessionId?: string };
    } catch {
      return Response.json(
        { error: "Invalid request body. Expected { sessionId: string }" },
        { status: 400 },
      );
    }

    if (!body.sessionId) {
      return Response.json({ error: "sessionId is required" }, { status: 400 });
    }

    const session = await chatSessionService.getSession(
      body.sessionId,
      user.id,
    );
    if (!session || !allowedPersonas.has(session.persona ?? ORCHESTRATOR_PERSONA_ID)) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const history = await chatSessionService.getConversationSessionHistory(
      body.sessionId,
      body.beforeSessionId,
    );
    const messages = history.messages;

    // Fetch metadata for assistant messages (traceEvents, debugMeta)
    const assistantIds = messages
      .filter((m: { role: string }) => m.role === 'assistant')
      .map((m: { id: string }) => m.id);

    let metaMap = new Map<string, { traceEvents?: unknown; debugMeta?: unknown; streamingDrafts?: unknown }>();
    if (assistantIds.length > 0) {
      const metadataRows = await chatSessionService.getMessageMetadataByMessageIds(assistantIds);
      metaMap = new Map(metadataRows.map((m) => [m.messageId, m]));
    }

    const enrichedMessages = messages.map((m) => {
      if (m.role !== 'assistant') return m;
      const meta = metaMap.get(m.id);
      return {
        ...m,
        traceEvents: meta?.traceEvents ?? null,
        debugMeta: meta?.debugMeta ?? null,
        streamingDrafts: meta?.streamingDrafts ?? null,
      };
    });

    return Response.json({
      session,
      messages: enrichedMessages,
      sessionId: history.session?.id ?? null,
      hasPreviousSession: history.hasPreviousSession,
      previousSessionCursor: history.hasPreviousSession ? history.session?.id ?? null : null,
    });
  }

  /**
   * Delete a chat session.
   * Uses POST with sessionId in body due to router limitations with path params.
   *
   * @param req - The HTTP request object (body: { sessionId: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with success status
   */
  @Post("/session/delete")
  @UseGuards(RateLimit('write'), AuthGuard)
  async deleteSession(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string };
    try {
      body = (await req.json()) as { sessionId?: string };
    } catch {
      return Response.json(
        { error: "Invalid request body. Expected { sessionId: string }" },
        { status: 400 },
      );
    }

    if (!body.sessionId) {
      return Response.json({ error: "sessionId is required" }, { status: 400 });
    }

    const authorization = await this.authorizeSessionMutation(req, user, body.sessionId);
    if (authorization instanceof Response) return authorization;

    const deleted = await chatSessionService.deleteSession(
      body.sessionId,
      user.id,
    );
    if (!deleted) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    return Response.json({ success: true });
  }

  /**
   * Update a chat session title (rename).
   *
   * @param req - The HTTP request object (body: { sessionId: string, title: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with updated session or error
   */
  @Post("/session/title")
  @UseGuards(RateLimit('write'), AuthGuard)
  async updateSessionTitle(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string; title?: string };
    try {
      body = (await req.json()) as { sessionId?: string; title?: string };
    } catch {
      return Response.json(
        {
          error:
            "Invalid request body. Expected { sessionId: string, title: string }",
        },
        { status: 400 },
      );
    }

    if (!body.sessionId || body.title === undefined) {
      return Response.json(
        { error: "sessionId and title are required" },
        { status: 400 },
      );
    }

    const title = String(body.title).trim();
    if (!title) {
      return Response.json({ error: "title cannot be empty" }, { status: 400 });
    }

    const authorization = await this.authorizeSessionMutation(req, user, body.sessionId);
    if (authorization instanceof Response) return authorization;

    const updated = await chatSessionService.updateSessionTitle(
      body.sessionId,
      user.id,
      title,
    );
    if (!updated) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    return Response.json({ success: true, title });
  }

  @Post("/session/share")
  @UseGuards(RateLimit('write'), AuthGuard)
  async shareSession(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string };
    try {
      body = (await req.json()) as { sessionId?: string };
    } catch {
      return Response.json(
        { error: "Invalid request body. Expected { sessionId: string }" },
        { status: 400 },
      );
    }

    if (!body.sessionId) {
      return Response.json({ error: "sessionId is required" }, { status: 400 });
    }

    const authorization = await this.authorizeSessionMutation(req, user, body.sessionId);
    if (authorization instanceof Response) return authorization;

    const shareToken = await chatSessionService.shareSession(
      body.sessionId,
      user.id,
    );
    if (!shareToken) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    return Response.json({ shareToken });
  }

  @Post("/session/unshare")
  @UseGuards(RateLimit('write'), AuthGuard)
  async unshareSession(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string };
    try {
      body = (await req.json()) as { sessionId?: string };
    } catch {
      return Response.json(
        { error: "Invalid request body. Expected { sessionId: string }" },
        { status: 400 },
      );
    }

    if (!body.sessionId) {
      return Response.json({ error: "sessionId is required" }, { status: 400 });
    }

    const authorization = await this.authorizeSessionMutation(req, user, body.sessionId);
    if (authorization instanceof Response) return authorization;

    const unshared = await chatSessionService.unshareSession(
      body.sessionId,
      user.id,
    );
    if (!unshared) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    return Response.json({ success: true });
  }

  /**
   * Update message metadata with frontend trace events.
   * Called after streaming completes to persist timing data collected client-side.
   *
   * @param req - The HTTP request object (body: { traceEvents: TraceEvent[] })
   * @param user - The session-authenticated user
   * @param params - Route params containing the message ID
   * @returns JSON response with success status
   */
  @Post("/message/:id/metadata")
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async updateMessageMetadata(
    req: Request,
    user: AuthenticatedUser,
    params?: RouteParams,
  ) {
    const messageId = params?.id;
    if (!messageId) {
      return Response.json({ error: "Message ID required" }, { status: 400 });
    }

    let body: { traceEvents?: unknown; streamingDrafts?: unknown };
    try {
      body = (await req.json()) as { traceEvents?: unknown; streamingDrafts?: unknown };
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    const traceEventsSchema = z.array(z.unknown()).max(2000);
    const traceEventsParsed =
      body.traceEvents === undefined
        ? { success: true as const, data: undefined }
        : traceEventsSchema.safeParse(body.traceEvents);
    if (!traceEventsParsed.success) {
      return Response.json(
        { error: "Invalid traceEvents payload" },
        { status: 400 },
      );
    }

    const streamingDraftsSchema = z.array(z.unknown()).max(200);
    const draftsParsed =
      body.streamingDrafts === undefined
        ? { success: true as const, data: undefined }
        : streamingDraftsSchema.safeParse(body.streamingDrafts);
    if (!draftsParsed.success) {
      return Response.json(
        { error: "Invalid streamingDrafts payload" },
        { status: 400 },
      );
    }

    try {
      await chatSessionService.saveMessageMetadata({
        messageId,
        userId: user.id,
        traceEvents: traceEventsParsed.data,
        streamingDrafts: draftsParsed.data,
      });
      return Response.json({ success: true });
    } catch (error) {
      logger.error("Failed to save message metadata", { messageId, error });
      return Response.json(
        { error: "Failed to save metadata" },
        { status: 500 },
      );
    }
  }

  /**
   * Accept a mid-stream interrupt from the frontend, classify it (steer vs. queue),
   * and emit the result onto the active SSE stream for this session.
   *
   * @param req - Body: { sessionId, message, messageId, traceSnapshot }
   * @param user - The authenticated user
   * @returns JSON `{ decision: 'steer' | 'queue', messageId }`
   */
  @Post("/interrupt")
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async interrupt(req: Request, user: AuthenticatedUser): Promise<Response> {
    let body: z.infer<typeof interruptBodySchema>;
    try {
      const raw = await req.json();
      const parsed = interruptBodySchema.safeParse(raw);
      if (!parsed.success) {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }
      body = parsed.data;
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { sessionId, message, messageId, traceSnapshot } = body;

    const session = await chatSessionService.getSession(sessionId, user.id);
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const agentState = traceSnapshot.slice(-5).join(', ');
    const classifier = getInterruptClassifier();
    const decision = await classifier.classify({ message, agentState });

    emitChatInterrupt(sessionId, { decision, messageId });

    return Response.json({ decision, messageId });
  }

  @Get("/shared/:token")
  @UseGuards(RateLimit('read'))
  async getSharedSession(
    _req: Request,
    _user: unknown,
    params: { token: string },
  ) {
    const result = await chatSessionService.getSharedSession(params.token);
    if (!result) {
      return Response.json(
        { error: "Shared session not found" },
        { status: 404 },
      );
    }

    return Response.json({
      session: {
        id: result.session.id,
        title: result.session.title,
        createdAt: result.session.createdAt,
      },
      messages: result.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    });
  }
}
