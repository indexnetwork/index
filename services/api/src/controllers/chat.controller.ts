import { z } from "zod";

import { AuthGuard, SessionOnlyGuard, type AuthenticatedUser } from "../guards/auth.guard";
import { RateLimit } from "../guards/limiter.guard";
import { requestContext } from "../lib/request-context";
import { getRequestAuthContext } from '../lib/request-auth-context';
import { log } from "../lib/log";
import { Controller, Get, Post, UseGuards } from "../lib/router/router.decorators";
import { chatSessionService, RETIRED_ORCHESTRATOR_PERSONA_ID, TELEGRAM_TRANSCRIPT_PERSONA_ID, type ChatStreamSurface } from "../services/chat.service";
import { agentService } from "../services/agent.service";
import { userService } from "../services/user.service";
import { negotiationReflectQueue } from "../queues/negotiations/reflect.queue";
import { personalAgentQueue } from "../queues/personal-agent.queue";
import type { PersonalAgentUserMessageEvent } from "../queues/personal-agent.queue";
import { subscribePersonalAgentReply } from "../lib/agent/personal-agent-reply.stream";
import type { PersonalAgentReplyStreamEvent } from "../lib/agent/personal-agent-reply.stream";
import { SuggestionGenerator, ChatInterruptClassifier, PERSONAL_AGENT_PERSONA_ID } from '@indexnetwork/protocol';
import type { PersonalAgentResult } from '@indexnetwork/protocol';
import { createAgentActivityEvent, createDoneEvent, createErrorEvent, createStatusEvent, createSteerOrQueueEvent, createTokenEvent, formatSSEEvent } from "../types/chat-streaming.types";
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
 * Server-owned copy for a PersonalAgent turn that failed or timed out. The
 * turn runs once, with no retry, so the copy makes no promise that it will
 * be picked up later — only that the message itself was not lost and can be
 * sent again.
 */
export const PERSONAL_AGENT_TURN_FAILURE_REPLY =
  'I hit a snag acting on that just now, but your message is saved. '
  + 'Feel free to try again.';


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
  /** @deprecated Use scopeType/scopeId. Retained as the REST edge alias for network-scoped sessions. */
  networkId: z.string().nullish(),
  scopeType: z.enum(['network', 'intent']).nullish(),
  scopeId: z.string().nullish(),
  /** The recipient user ID for DM-style chats. */
  recipientUserId: z.string().nullish(),
  prefillMessages: z.array(z.object({
    role: z.enum(["assistant", "user"]),
    content: z.string().max(10000),
  })).max(10).optional(),
  /** Question messages explicitly answered by this principal turn. */
  decisionQuestionMessageIds: z.array(z.string().min(1)).min(1).max(20).optional(),
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
    // API-key clients only ever hold a signal's DM; every other session —
    // pre-collapse pinned chats that lost the DM fold-in included — is
    // invisible to them. The canonical ('personal-intent', intentId) registry
    // row is the authority, never the metadata scope echo.
    if (surface === 'agent') {
      const scope = sessionScope(session);
      const canonicalId = scope?.scopeType === 'intent'
        ? await chatSessionService.findNegotiatorIntentSessionId(user.id, scope.scopeId)
        : null;
      if (canonicalId !== sessionId) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }
    }

    const policy = chatSessionService.resolveStreamPersonaPolicy({
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
    private readonly runPersonalAgentUserTurn: (
      event: PersonalAgentUserMessageEvent,
    ) => Promise<PersonalAgentResult> = (event) => personalAgentQueue.runUserMessageTurn(event),
  ) {}
  /**
   * SSE streaming endpoint for chat messages with context support.
   * Streams graph events and LLM tokens in real-time, loading previous conversation context.
   *
   * @param req - The HTTP request object (body: { message: string, sessionId?: string, useCheckpointer?: boolean })
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
              "Invalid request body. Expected { message?: string | null, sessionId?: string | null, useCheckpointer?: boolean, scopeType?: 'network' | 'intent' | null, scopeId?: string | null, networkId?: string | null }",
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

    const messageContent = body.message?.trim() || "";
    if (!messageContent) {
      return Response.json(
        { error: "Message content is required" },
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

    let currentSessionId = body.sessionId;
    const loadedSession = currentSessionId
      ? await chatSessionService.getSession(currentSessionId, user.id)
      : null;
    if (currentSessionId && !loadedSession) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const personaPolicy = chatSessionService.resolveStreamPersonaPolicy(
      loadedSession ? { storedPersona: loadedSession.persona } : {},
    );
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
      surface === 'onboarding'
      && (requestedScope || sessionScope(loadedSession) || body.prefillMessages?.length)
    ) {
      return Response.json(
        { error: 'Restricted onboarding chats cannot be scoped or client-prefilled.' },
        { status: 400 },
      );
    }
    // API-key clients only ever drive a signal's DM (the mac app's per-signal
    // chat); the global chat stays a web surface, exactly as when persona ids
    // encoded the split.
    if (surface === 'agent') {
      const scopeForTurn = currentSessionId ? sessionScope(loadedSession) : requestedScope;
      if (scopeForTurn?.scopeType !== 'intent') {
        return Response.json(
          { error: "Chats with your agent require an intent scope" },
          { status: 403 },
        );
      }
    }

    const requestScopeError = await validateScope(requestedScope);
    if (requestScopeError) return requestScopeError;

    let effectiveScope = requestedScope;
    if (!currentSessionId && requestedScope?.scopeType === 'intent') {
      // Intent scope is the signal's DM: one session per (user, intent),
      // driven by the IntentAgent, introduced by the user's personal agent
      // row — which therefore must exist.
      const personalAgent = await resolveNegotiatorAgent(user.id);
      if (!personalAgent) {
        return Response.json({ error: "Personal agent not available" }, { status: 404 });
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
      currentSessionId = await chatSessionService.createSession(
        user.id,
        initialTitle,
        requestedScope?.scopeType === 'network' ? requestedScope.scopeId : undefined,
        requestedScope,
        sessionPersona,
      );
    } else if (loadedSession) {
      const persistedScope = sessionScope(loadedSession);
      if (requestedScope && persistedScope && !sameScope(requestedScope, persistedScope)) {
        return Response.json({ error: "Session is already scoped differently" }, { status: 409 });
      }
      if (requestedScope && !persistedScope) {
        // Sessions never gain a scope retroactively: an intent focus opens
        // the signal's own DM, a network focus opens its own chat.
        return Response.json(
          {
            error: 'Start a separate chat with your agent for that focus.',
            code: 'CHAT_SCOPE_REQUIRES_NEW_SESSION',
            action: { type: 'start_signal_session', href: '/' },
          },
          { status: 409 },
        );
      }
      effectiveScope = requestedScope ?? persistedScope;
      if (effectiveScope?.scopeType === 'intent') {
        // Only the signal's one canonical DM can drive intent-scoped turns.
        // Anything else with an intent scope (e.g. a pre-collapse pinned chat
        // that lost the fold-in to the DM — archived by migration, this guard
        // is the backstop) stays readable but never streams: an agent turn
        // here would deliver into the canonical DM instead. One registry
        // select; same typed nudge the other read-only rows answer with.
        const canonicalId = await chatSessionService.findNegotiatorIntentSessionId(user.id, effectiveScope.scopeId);
        if (canonicalId !== currentSessionId) {
          return Response.json(
            {
              error: "This conversation is read-only. Open the signal to continue with your agent.",
              code: 'WEB_SIGNAL_SESSION_REQUIRED',
              action: { type: 'start_signal_session', href: '/' },
            },
            { status: 409 },
          );
        }
      }
    }

    const effectiveScopeError = await validateScope(effectiveScope);
    if (effectiveScopeError) return effectiveScopeError;

    const sessionId = currentSessionId;
    if (body.decisionQuestionMessageIds) {
      const marked = await chatSessionService.markDecisionQuestionsSubmitted(
        sessionId,
        body.decisionQuestionMessageIds,
      );
      if (!marked) {
        return Response.json(
          { error: 'Decision questions are no longer awaiting an answer.' },
          { status: 409 },
        );
      }
    }
    // ─── Phase 2 (full chat ownership): a signal's DM runs no persona graph
    // at all — EVERY intent-scoped turn is the signal's IntentAgent's,
    // decided and executed on its serialized inbox. Global and network-scoped
    // chats run the PersonalAgent graph persona.
    const agentOwnsTurn = effectiveScope?.scopeType === 'intent';
    // The graph persona introduces itself as the client's own agent, named
    // from the same `type='personal'` row the IntentAgent belongs to. A
    // missing row is not fatal: the prompt falls back to a generic
    // self-description rather than a product noun, so the chat keeps working.
    const identityAgent = agentOwnsTurn
      ? null
      : await resolveNegotiatorAgent(user.id).catch(() => null);
    const factory = agentOwnsTurn
      ? null
      : chatSessionService.getPersonalAgentGraphFactory(identityAgent, { onboarding: surface === 'onboarding' });
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
    const runPersonalAgentUserTurn = this.runPersonalAgentUserTurn;

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
          // signal's IntentAgent: the message is persisted, its turn runs
          // directly on the agent's serialized inbox lane, and the agent's
          // reply streams back over the turn's in-process channel as token
          // events. The persona
          // graph never runs for this scope — the 2026-08-20 incident's fix
          // is now unconditional, and the client talks to one mind. If the
          // channel yields nothing (or only a prefix) but the turn
          // completes, the completed text is emitted as a token event — a
          // turn is never lost to a dropped subscription.
          let agentTurn: PersonalAgentResult | null = null;
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
            // Subscribe BEFORE invoking the turn so no chunk can be published
            // into an unwatched channel. Everything on the channel was
            // checked and persisted by the host before publishing.
            let streamedText = '';
            let lastSeq = 0;
            let unsubscribeReply: (() => void) | null = null;
            try {
              unsubscribeReply = await subscribePersonalAgentReply(agentUserMessageId, (event: PersonalAgentReplyStreamEvent) => {
                try {
                  if (event.type === 'activity') {
                    controller.enqueue(
                      encoder.encode(formatSSEEvent(createAgentActivityEvent(sessionId, event.label))),
                    );
                    return;
                  }
                  if (event.seq <= lastSeq) return;
                  lastSeq = event.seq;
                  streamedText += event.content;
                  controller.enqueue(
                    encoder.encode(formatSSEEvent(createTokenEvent(sessionId, event.content))),
                  );
                } catch {
                  // Stream may have already closed.
                }
              });
            } catch (subscribeErr) {
              // Degraded to the fallback emission below, never a lost turn.
              logger.warn('PersonalAgent reply subscription failed', { sessionId, error: subscribeErr });
            }
            try {
              agentTurn = await runPersonalAgentUserTurn({
                event: 'user_message',
                userId: user.id,
                intentId: effectiveScope.scopeId,
                sessionId,
                messageId: agentUserMessageId,
                text: messageContent,
              });
              fullResponse = agentTurn.messages.join('\n\n');
              for (const act of agentTurn.acts) {
                if (act.tool !== 'message_user') continue;
                agentAssistantMessageId = act.messageId;
                // Questions belong to the last delivered message named by
                // `agentAssistantMessageId`. They are already persisted on
                // it; done only spares the client a reload.
                decisionQuestions = act.questions;
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
              // The client's message is already persisted; the turn itself
              // ran once and failed, so the client hears honest fixed copy
              // rather than a dropped stream.
              logger.error('PersonalAgent turn failed; replying with fixed copy', { sessionId, error: agentErr });
              fullResponse = PERSONAL_AGENT_TURN_FAILURE_REPLY;
              try {
                agentAssistantMessageId = await chatSessionService.addMessage({
                  sessionId,
                  role: 'assistant',
                  content: fullResponse,
                });
              } catch (persistErr) {
                logger.error('Failed to persist PersonalAgent failure copy', { sessionId, error: persistErr });
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

          // Signal-DM turns debounce-schedule a chat reflection (P5.2):
          // the job fires once the session has been idle for the delay window,
          // distilling stated preferences into negotiator memories. Never
          // blocks the stream.
          if (agentOwnsTurn && fullResponse) {
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
   * Resolve or create the stable intent-scoped chat session — the signal's
   * DM — for the main-web surface.
   *
   * @param req - The HTTP request object (body: { scopeType: 'intent', scopeId: string })
   * @param user - The authenticated user from SessionOnlyGuard
   * @returns JSON response with the resolved session and whether it was created
   */
  @Post("/web/session/resolve")
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async webResolveSession(req: Request, user: AuthenticatedUser) {
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

    // An intent scope names exactly one session: the signal's DM.
    const result = await chatSessionService.resolveNegotiatorIntentSession(user.id, body.scopeId);
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
      new Set([RETIRED_ORCHESTRATOR_PERSONA_ID, TELEGRAM_TRANSCRIPT_PERSONA_ID, PERSONAL_AGENT_PERSONA_ID]),
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
