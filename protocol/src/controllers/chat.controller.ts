import { z } from "zod";

import { AuthGuard, type AuthenticatedUser } from "../guards/auth.guard";
import { requestContext } from "../lib/request-context";
import { log } from "../lib/log";
import {
  Controller,
  Get,
  Post,
  UseGuards,
} from "../lib/router/router.decorators";
import { chatSessionService } from "../services/chat.service";
import { fileService } from "../services/file.service";
// TODO: fix layering violation — controller should not import protocol directly
// eslint-disable-next-line boundaries/dependencies
import { SuggestionGenerator } from "../lib/protocol/agents/suggestion.generator";
import {
  createDoneEvent,
  createErrorEvent,
  createStatusEvent,
  formatSSEEvent,
} from "../types/chat-streaming.types";

type RouteParams = Record<string, string>;

const logger = log.controller.from("chat");

const streamBodySchema = z.object({
  message: z.string().nullish(),
  sessionId: z.string().nullish(),
  useCheckpointer: z.boolean().optional(),
  fileIds: z.array(z.string()).optional(),
  indexId: z.string().nullish(),
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

@Controller("/chat")
export class ChatController {
  /**
   * Send a message to the chat graph for processing.
   * The graph routes to appropriate subgraphs based on intent analysis.
   *
   * @param req - The HTTP request object (body: { message: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with graph execution result including responseText
   */
  @Post("/message")
  @UseGuards(AuthGuard)
  async message(req: Request, user: AuthenticatedUser) {
    // 1. Parse request body for message
    let messageContent: string = "";
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
  @UseGuards(AuthGuard)
  async messageStream(
    req: Request,
    user: AuthenticatedUser,
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
              "Invalid request body. Expected { message?: string | null, sessionId?: string | null, useCheckpointer?: boolean, fileIds?: string[], indexId?: string | null }",
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

    // 2. Validate or create session
    const requestIndexId =
      typeof body.indexId === "string" && body.indexId.trim()
        ? body.indexId.trim()
        : undefined;
    if (requestIndexId) {
      const requestScopeValidation =
        await chatSessionService.validateIndexScope(user.id, requestIndexId);
      if (!requestScopeValidation.ok) {
        return Response.json(
          { error: requestScopeValidation.error },
          { status: requestScopeValidation.status },
        );
      }
    }

    let currentSessionId = body.sessionId;
    let session: Awaited<
      ReturnType<typeof chatSessionService.getSession>
    > | null = null;
    if (!currentSessionId) {
      const initialTitle = body.prefillMessages?.length
        ? "Set Up Your Social Agent"
        : undefined;
      currentSessionId = await chatSessionService.createSession(
        user.id,
        initialTitle,
        requestIndexId,
      );
    } else {
      session = await chatSessionService.getSession(
        currentSessionId,
        user.id,
      );
      if (!session) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }
      if (requestIndexId !== undefined) {
        await chatSessionService.updateSessionIndex(
          currentSessionId,
          user.id,
          requestIndexId,
        );
      }
    }

    // Effective index for this run: request body overrides; otherwise use session's persisted index
    const effectiveIndexId = requestIndexId ?? session?.indexId ?? undefined;
    if (effectiveIndexId) {
      const effectiveScopeValidation =
        await chatSessionService.validateIndexScope(user.id, effectiveIndexId);
      if (!effectiveScopeValidation.ok) {
        return Response.json(
          { error: effectiveScopeValidation.error },
          { status: effectiveScopeValidation.status },
        );
      }
    }

    // Capture for closure
    const sessionId = currentSessionId;
    const factory = chatSessionService.getGraphFactory();
    const useCheckpointer = body.useCheckpointer ?? true;
    const indexIdForStream = effectiveIndexId;

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

    const stream = new ReadableStream({
      start(controller) {
        return requestContext.run({ originUrl }, async () => {
        try {
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
          let routingDecision: Record<string, unknown> | undefined;
          let subgraphResults: Record<string, unknown> | undefined;
          let debugMeta: { graph: string; iterations: number; tools: unknown[] } | undefined;

          // Use context-aware streaming to load previous messages
          for await (const event of factory.streamChatEventsWithContext(
            {
              userId: user.id,
              message: messageContent,
              sessionId,
              maxContextMessages: 20,
              indexId: indexIdForStream,
              prefillMessages: body.prefillMessages,
            },
            checkpointer,
            req.signal,
          )) {
            if (event) {
              // response_complete is an internal event carrying the agent's
              // authoritative final text — don't forward it to the SSE client.
              if (event.type === "response_complete") {
                fullResponse = event.response;
              } else {
                controller.enqueue(encoder.encode(formatSSEEvent(event)));
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
                };
              }
            }
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

          // Skip title/suggestions generation if client disconnected
          if (!req.signal.aborted) {
            // Generate session title and suggestions in parallel
            const [sessionTitle, suggestions] = await Promise.all([
              chatSessionService.generateSessionTitle(sessionId, user.id),
              getSuggestionGenerator()
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
                  }),
                ),
              ),
            );
          }
        } catch (error) {
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
        } finally {
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
  @UseGuards(AuthGuard)
  async getSessions(req: Request, user: AuthenticatedUser) {
    const sessions = await chatSessionService.getUserSessions(user.id);
    return Response.json({ sessions });
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
  @UseGuards(AuthGuard)
  async getSession(req: Request, user: AuthenticatedUser) {
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

    const session = await chatSessionService.getSession(
      body.sessionId,
      user.id,
    );
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const messages = await chatSessionService.getSessionMessages(
      body.sessionId,
    );

    // Fetch metadata for assistant messages (traceEvents, debugMeta)
    const assistantIds = messages
      .filter((m: { role: string }) => m.role === 'assistant')
      .map((m: { id: string }) => m.id);

    let metaMap = new Map<string, { traceEvents?: unknown; debugMeta?: unknown }>();
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
      };
    });

    return Response.json({ session, messages: enrichedMessages });
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
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
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
   * @param user - The authenticated user from AuthGuard
   * @param params - Route params containing the message ID
   * @returns JSON response with success status
   */
  @Post("/message/:id/metadata")
  @UseGuards(AuthGuard)
  async updateMessageMetadata(
    req: Request,
    user: AuthenticatedUser,
    params?: RouteParams,
  ) {
    const messageId = params?.id;
    if (!messageId) {
      return Response.json({ error: "Message ID required" }, { status: 400 });
    }

    let body: { traceEvents?: unknown };
    try {
      body = (await req.json()) as { traceEvents?: unknown };
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    const traceEventsSchema = z.array(z.unknown()).max(2000);
    const parsed = traceEventsSchema.safeParse(body.traceEvents);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid traceEvents payload" },
        { status: 400 },
      );
    }

    try {
      await chatSessionService.saveMessageMetadata({
        messageId,
        userId: user.id,
        traceEvents: parsed.data,
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

  @Get("/shared/:token")
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
