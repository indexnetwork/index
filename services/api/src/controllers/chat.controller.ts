import { z } from "zod";

import { AuthGuard, SessionOnlyGuard, type AuthenticatedUser } from "../guards/auth.guard";
import { RateLimit } from "../guards/limiter.guard";
import { requestContext } from "../lib/request-context";
import { getRequestAuthContext } from '../lib/request-auth-context';
import { log } from "../lib/log";
import { Controller, Get, Post, UseGuards } from "../lib/router/router.decorators";
import { chatSessionService, RETIRED_ORCHESTRATOR_PERSONA_ID, TELEGRAM_TRANSCRIPT_PERSONA_ID, type ChatStreamSurface } from "../services/chat.service";
import { fileService } from "../services/file.service";
import { agentService } from "../services/agent.service";
import { userService } from "../services/user.service";
import { isNegotiatorChatEnabled } from "../lib/negotiator-feature";
import { negotiationReflectQueue } from "../queues/negotiations/reflect.queue";
import { intentAgentQueue } from "../queues/intent-agent.queue";
import { subscribeIntentAgentReply } from "../lib/intent-agent/intent-agent-reply.stream";
import type { IntentAgentTurnResult, IntentAgentUserMessageEvent } from "../lib/intent-agent/intent-agent.types";
import { SuggestionGenerator, ChatInterruptClassifier, NEGOTIATOR_PERSONA_ID, ONBOARDING_PERSONA_ID, SIGNAL_PERSONA_ID } from '@indexnetwork/protocol';
import { createDoneEvent, createErrorEvent, createStatusEvent, createSteerOrQueueEvent, createTokenEvent, formatSSEEvent } from "../types/chat-streaming.types";
import { emitChatInterrupt, onChatInterrupt } from '../lib/chat-interrupt.events';

type RouteParams = Record<string, string>;
type ChatScope = { scopeType: 'network' | 'intent'; scopeId: string };

const logger = log.controller.from("chat");

/**
 * The orchestrator's event stream when it does not run: the signal's
 * IntentAgent owns every turn of this scope (phase 2 full chat ownership),
 * so the response comes from its serialized turn instead of the persona
 * graph. An empty stream rather than a branch around the loop keeps one path
 * through persistence, title, suggestions and `done` — the turn differs only
 * in where its text came from.
 */
async function* emptyEventStream(): AsyncGenerator<never, void, unknown> {}

/**
 * Server-owned copy for an intent-agent turn that failed or timed out. The
 * client's message is already persisted and its event is durable on the
 * agent's inbox, retrying in the background — nothing is lost, so the copy
 * says exactly that instead of asking them to resend.
 */
export const INTENT_AGENT_TURN_FAILURE_REPLY =
  'I hit a snag acting on that just now, but your message is saved and I will pick it up shortly — '
  + 'no need to send it again.';


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
  /** The recipient user ID for DM-style chats. */
  recipientUserId: z.string().nullish(),
  /** Explicit persona assertion for a newly bootstrapped persona chat. */
  persona: z.enum(['negotiator', 'signal']).nullish(),
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

/**
 * Required body for POST /chat/negotiator/session (P4.2 intent pinning). The
 * intent pin is the only negotiator surface, so a missing, unparseable, or
 * blank `intentId` is a 400 rather than a fallback to the removed DM.
 */
const negotiatorSessionBodySchema = z.object({
  intentId: z.string().min(1),
});

const resolveSessionBodySchema = z.object({
  scopeType: z.enum(['intent']),
  scopeId: z.string().min(1),
  persona: z.enum(['signal']).optional(),
});

const interruptBodySchema = z.object({
  sessionId: z.string(),
  message: z.string().min(1),
  messageId: z.string().uuid(),
  traceSnapshot: z.array(z.string()).max(20).default([]),
});

/**
 * Resolve the caller's personal negotiator agent row (provisioning it when
 * missing — idempotent). Returns null for missing users, which
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
  /**
   * Map dual-auth routes onto their authenticated product surface. Session
   * principals are the web app; API-key principals are agent clients, which
   * must name a surface-independent persona (there is no default).
   */
  private streamSurface(req: Request): ChatStreamSurface {
    return getRequestAuthContext(req)?.kind === 'session' ? 'web' : 'agent';
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

    const surface = this.streamSurface(req);
    // Sessions with no persona column value predate personafication: they are
    // retired-orchestrator rows, readable but never continuable.
    const storedPersona = session.persona ?? RETIRED_ORCHESTRATOR_PERSONA_ID;
    if (surface === 'agent' && storedPersona !== NEGOTIATOR_PERSONA_ID) {
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
    /** Seam for tests; production awaits the serialized inbox turn. */
    private readonly runIntentAgentUserTurn: (
      event: IntentAgentUserMessageEvent,
    ) => Promise<IntentAgentTurnResult> = (event) => intentAgentQueue.runUserMessageTurn(event),
  ) {}
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
    return this.messageStreamForSurface(req, user, this.streamSurface(req));
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
      // The intent pin is the only negotiator surface. Without the removed
      // unscoped DM there is nothing to open a new negotiator session on.
      if (requestedScope?.scopeType !== 'intent') {
        return Response.json(
          { error: "Negotiator chat requires an intent scope" },
          { status: 400 },
        );
      }
      const resolved = await chatSessionService.resolveNegotiatorIntentSession(
        user.id,
        requestedScope.scopeId,
      );
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
      if (sessionPersona === NEGOTIATOR_PERSONA_ID && !sessionScope(loadedSession)) {
        // A negotiator session with no scope is a conversation from the
        // removed unscoped DM. Those rows are deliberately preserved and stay
        // readable by id, but the surface is gone: they cannot be continued,
        // and they cannot be retroactively pinned to an intent either.
        return Response.json(
          { error: "This negotiator conversation is read-only. Open the signal to continue with your agent." },
          { status: 400 },
        );
      }
      const persistedScope = sessionScope(loadedSession);
      if (requestedScope && persistedScope && !sameScope(requestedScope, persistedScope)) {
        return Response.json({ error: "Session is already scoped differently" }, { status: 409 });
      }
      if (requestedScope && !persistedScope) {
        if (sessionPersona === SIGNAL_PERSONA_ID) {
          return Response.json(
            {
              error: 'Start a separate chat with your agent for that focus.',
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
    // ─── Phase 2 (full chat ownership): the negotiator intent DM runs no
    // persona graph at all — EVERY turn is the signal's IntentAgent's,
    // decided and executed on its serialized inbox. Negotiator sessions are
    // intent-scoped by construction (enforced above), so no negotiator
    // persona factory is derived; other personas and network scope are
    // untouched.
    const agentOwnsTurn = sessionPersona === NEGOTIATOR_PERSONA_ID
      && effectiveScope?.scopeType === 'intent';
    // The personas that DO run a graph introduce themselves as the client's
    // own agent, named from the same `type='personal'` row the IntentAgent
    // belongs to. A missing row is not fatal: the prompt falls back to a
    // generic self-description rather than a product noun, so the signal and
    // onboarding chats keep working.
    const personaNeedsIdentity = !agentOwnsTurn
      && (sessionPersona === SIGNAL_PERSONA_ID || sessionPersona === ONBOARDING_PERSONA_ID);
    const identityAgent = personaNeedsIdentity
      ? await resolveNegotiatorAgent(user.id).catch(() => null)
      : null;
    const factory = agentOwnsTurn
      ? null
      : sessionPersona === ONBOARDING_PERSONA_ID
        ? chatSessionService.getOnboardingGraphFactory(identityAgent)
        : sessionPersona === SIGNAL_PERSONA_ID
          ? chatSessionService.getSignalGraphFactory(identityAgent)
          : null;
    if (!factory && !agentOwnsTurn) {
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
    const runIntentAgentUserTurn = this.runIntentAgentUserTurn;

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
          let debugMeta: { graph: string; iterations: number; tools: unknown[]; llm?: unknown; orchestratorNegotiations?: unknown} | undefined;
          let decisionQuestions: import("@indexnetwork/protocol").Question[] | undefined;

          // ─── The IntentAgent's turn (phase 2: full chat ownership) ──────
          // EVERY turn of a negotiator intent-scoped DM belongs to the
          // signal's IntentAgent: the message is persisted, its event runs
          // on the agent's serialized inbox, and the agent's reply streams
          // back over the turn's Redis channel as token events. The persona
          // graph never runs for this scope — the 2026-08-20 incident's fix
          // is now unconditional, and the client talks to one mind. If the
          // channel yields nothing (or only a prefix) but the turn
          // completes, the completed text is emitted as a token event — a
          // turn is never lost to a dropped subscription.
          let agentTurn: IntentAgentTurnResult | null = null;
          let agentUserMessageId: string | null = null;
          let agentAssistantMessageId: string | undefined;

          if (agentOwnsTurn && effectiveScope) {
            // The conversation is the agent's memory, so the client's message
            // is persisted BEFORE the turn — the reverse of the persona path,
            // which persists after streaming to avoid duplicating the current
            // message in its loaded context.
            agentUserMessageId = await chatSessionService.addMessage({
              sessionId,
              role: 'user',
              content: messageContent,
            });
            // Subscribe BEFORE enqueueing so no chunk can be published into
            // an unwatched channel. Everything on the channel was checked
            // and persisted by the host before publishing.
            let streamedText = '';
            let lastSeq = 0;
            let unsubscribeReply: (() => void) | null = null;
            try {
              unsubscribeReply = await subscribeIntentAgentReply(agentUserMessageId, (chunk) => {
                if (chunk.seq <= lastSeq) return;
                lastSeq = chunk.seq;
                streamedText += chunk.content;
                try {
                  controller.enqueue(
                    encoder.encode(formatSSEEvent(createTokenEvent(sessionId, chunk.content))),
                  );
                } catch {
                  // Stream may have already closed.
                }
              });
            } catch (subscribeErr) {
              // Degraded to the fallback emission below, never a lost turn.
              logger.warn('Intent-agent reply subscription failed', { sessionId, error: subscribeErr });
            }
            try {
              agentTurn = await runIntentAgentUserTurn({
                kind: 'user_message',
                userId: user.id,
                intentId: effectiveScope.scopeId,
                sessionId,
                messageId: agentUserMessageId,
                text: messageContent,
              });
              fullResponse = agentTurn.messages.join('\n\n');
              for (const act of agentTurn.acts) {
                if (act.tool === 'message_user') agentAssistantMessageId = act.messageId;
              }
              // Dropped-subscription fallback: whatever the channel did not
              // deliver of the completed turn is emitted as one token event.
              // The host publishes chunks whose concatenation IS the joined
              // messages, so a healthy stream leaves no remainder.
              if (fullResponse && fullResponse !== streamedText) {
                const remainder = fullResponse.startsWith(streamedText)
                  ? fullResponse.slice(streamedText.length)
                  : null;
                if (remainder) {
                  controller.enqueue(
                    encoder.encode(formatSSEEvent(createTokenEvent(sessionId, remainder))),
                  );
                }
                // A non-prefix divergence emits nothing more: the done
                // event's response is authoritative for the final text.
              }
            } catch (agentErr) {
              // The event is durable on the inbox and retries in the
              // background; the client hears honest fixed copy rather than
              // losing the turn.
              logger.error('Intent-agent turn failed; replying with fixed copy', { sessionId, error: agentErr });
              fullResponse = INTENT_AGENT_TURN_FAILURE_REPLY;
              try {
                agentAssistantMessageId = await chatSessionService.addMessage({
                  sessionId,
                  role: 'assistant',
                  content: fullResponse,
                });
              } catch (persistErr) {
                logger.error('Failed to persist intent-agent failure copy', { sessionId, error: persistErr });
              }
              try {
                controller.enqueue(
                  encoder.encode(formatSSEEvent(createTokenEvent(sessionId, fullResponse))),
                );
              } catch {
                // Stream may have already closed.
              }
            } finally {
              unsubscribeReply?.();
            }
          }

          // Use context-aware streaming to load previous messages. An
          // agent-owned turn has no factory (checked above): its stream is
          // empty so one path runs persistence, title, suggestions and done.
          const orchestratorEvents = !factory || agentOwnsTurn
            ? emptyEventStream()
            : factory.streamChatEventsWithContext(
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
            );

          for await (const event of orchestratorEvents) {
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
                };
              } else if (event.type === "decision_questions") {
                // Event was already forwarded by the default enqueue above; just
                // capture so the final `done` event can include `decisionQuestions`.
                decisionQuestions = (event as { questions: import("@indexnetwork/protocol").Question[] }).questions;
              }
            }
          }

          // Steer-interrupted: persist partial turn and bail (no done event
          // emitted). Unreachable for an agent-owned turn — its stream is
          // empty — but guarded anyway so a racing interrupt cannot persist
          // the client's message twice.
          if (streamInterruptedBySteer) {
            try {
              if (!agentUserMessageId) {
                await chatSessionService.addMessage({ sessionId, role: 'user', content: messageContent });
              }
              // Use authoritative fullResponse when available; fall back to accumulated
              // partial tokens when the stream was cut before response_complete fired.
              const interruptedContent = (fullResponse || partialResponse).trim();
              if (interruptedContent && !agentOwnsTurn) {
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

          // Persist user message and assistant response. An agent-owned turn
          // persisted both already — the message before the turn ran, the
          // response inside the turn's own delivery — so this section is the
          // persona path's alone.
          if (!agentUserMessageId) {
            await chatSessionService.addMessage({
              sessionId,
              role: "user",
              content: messageContent,
            });
          }
          let assistantMessageId: string | undefined = agentAssistantMessageId;
          if (fullResponse && !agentOwnsTurn) {
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
  async getSessions(_req: Request, user: AuthenticatedUser) {
    // Retained read-only history for the retired orchestrator persona. The
    // negotiator filter that used to live here existed solely to look up the
    // pinned Personal Agent DM; with that surface gone its callers are too, and
    // negotiator sessions are reached through their intent. Signal history is
    // reserved for the session-only web endpoint below.
    const sessions = await chatSessionService.getUserSessions(
      user.id,
      10,
      RETIRED_ORCHESTRATOR_PERSONA_ID,
    );
    return Response.json({ sessions });
  }

  /** Main-web history including retired-orchestrator and Signal, never negotiator. */
  @Get("/web/sessions")
  @UseGuards(RateLimit('read'), SessionOnlyGuard)
  async getWebSessions(_req: Request, user: AuthenticatedUser) {
    const sessions = await chatSessionService.getWebUserSessions(user.id);
    return Response.json({ sessions });
  }

  /**
   * Get-or-create the caller's negotiator session pinned to one of their
   * intents (P4.2/IND-403). Idempotent: repeat calls for the same intent
   * return the same session, keyed by the chat_session_scopes unique index.
   * Gated by NEGOTIATOR_CHAT_ENABLED (404 when off, as if the route does not
   * exist).
   *
   * `intentId` is required. The unscoped DM variant this route also served is
   * gone, so a request without one has no session to resolve and is a 400
   * rather than a silent fallback.
   *
   * @param req - The HTTP request object (body: { intentId: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON with the session, whether it was created, and the negotiator agent identity
   */
  @Post("/negotiator/session")
  @UseGuards(RateLimit('write'), AuthGuard)
  async negotiatorSession(req: Request, user: AuthenticatedUser) {
    if (!isNegotiatorChatEnabled()) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const invalidBody = Response.json(
      { error: "Invalid request body. Expected { intentId: string }" },
      { status: 400 },
    );

    let intentId: string;
    try {
      const parsed = negotiatorSessionBodySchema.safeParse(await req.json());
      if (!parsed.success) return invalidBody;
      const requested = parsed.data.intentId.trim();
      if (!requested) return invalidBody;
      intentId = requested;
    } catch {
      // Missing or unparseable body — no intent to pin to.
      return invalidBody;
    }

    const agent = await resolveNegotiatorAgent(user.id);
    if (!agent) {
      return Response.json({ error: "Negotiator agent not available" }, { status: 404 });
    }

    const result = await chatSessionService.resolveNegotiatorIntentSession(user.id, intentId);
    if ('error' in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({
      session: result.session,
      created: result.created,
      agent: { id: agent.id, name: agent.name, description: agent.description },
      // Constant since the intent-agent collapse: the agent's asks are plain
      // messages with no regeneration pending state. Served so existing web
      // clients keep parsing the bootstrap shape.
      questionRegenerationPending: false,
    });
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
    return this.resolveSessionForSurface(req, user, this.streamSurface(req));
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
    return this.getSessionForPersonas(req, user, new Set([RETIRED_ORCHESTRATOR_PERSONA_ID]));
  }

  /** Session-only web detail across readable web and pinned chat personas. */
  @Post("/web/session")
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async getWebSession(req: Request, user: AuthenticatedUser) {
    return this.getSessionForPersonas(
      req,
      user,
      new Set([RETIRED_ORCHESTRATOR_PERSONA_ID, TELEGRAM_TRANSCRIPT_PERSONA_ID, SIGNAL_PERSONA_ID, NEGOTIATOR_PERSONA_ID]),
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
    if (!session || !allowedPersonas.has(session.persona ?? RETIRED_ORCHESTRATOR_PERSONA_ID)) {
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

    let metaMap = new Map<string, { traceEvents?: unknown; debugMeta?: unknown; streamingDrafts?: unknown; discoveries?: unknown }>();
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
        discoveries: meta?.discoveries ?? null,
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

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (Object.prototype.hasOwnProperty.call(body, 'streamingDrafts')) {
      return Response.json(
        { error: "streamingDrafts is no longer accepted" },
        { status: 400 },
      );
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

    try {
      await chatSessionService.saveMessageMetadata({
        messageId,
        userId: user.id,
        traceEvents: traceEventsParsed.data,
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
