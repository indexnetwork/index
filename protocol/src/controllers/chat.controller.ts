import type { ChatControllerChatProvider } from '../lib/protocol/interfaces/chat.interface';
import { getChatProvider } from '../adapters/chat.adapter';
import { getAgentAddress } from '../agent/xmtp.agent';
import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { chatSessionService } from '../services/chat.service';
import { fileService } from '../services/file.service';
import { createDoneEvent, createErrorEvent, createStatusEvent, formatSSEEvent } from '../types/chat-streaming.types';

const logger = log.controller.from("chat");

@Controller('/chat')
export class ChatController {
  private readonly chatProvider: ChatControllerChatProvider | null;

  constructor(chatProvider?: ChatControllerChatProvider | null) {
    this.chatProvider = chatProvider ?? getChatProvider();
  }

  /**
   * Get the XMTP agent's public address.
   * No auth required -- callers need this to start conversations with the agent.
   */
  @Get('/agent-address')
  async getAgentAddress(_req: Request) {
    const address = getAgentAddress();
    if (!address) {
      return Response.json({ error: 'Agent not ready' }, { status: 503 });
    }
    return Response.json({ address });
  }

  /**
   * Generate a Stream Chat token for the authenticated user.
   */
  @Post('/token')
  @UseGuards(AuthGuard)
  async token(_req: Request, user: AuthenticatedUser) {
    if (!this.chatProvider) {
      return Response.json(
        { error: 'Chat provider is not configured' },
        { status: 503 }
      );
    }
    const token = this.chatProvider.createToken(user.id);
    return Response.json({ token });
  }

  /**
   * Upsert a user in Stream Chat so they exist before creating a channel.
   * Called by the frontend when opening a DM with a user who may not yet exist in Stream.
   * Callers may only upsert their own profile (body.userId must match the authenticated user).
   */
  @Post('/user')
  @UseGuards(AuthGuard)
  async upsertStreamUser(req: Request, user: AuthenticatedUser) {
    if (!this.chatProvider) {
      return Response.json(
        { error: 'Chat provider is not configured' },
        { status: 503 }
      );
    }
    let body: { userId?: string; userName?: string; userAvatar?: string };
    try {
      body = (await req.json()) as { userId?: string; userName?: string; userAvatar?: string };
    } catch {
      return Response.json(
        { error: 'Invalid request body. Expected { userId: string, userName?: string, userAvatar?: string }' },
        { status: 400 }
      );
    }
    const userId = body.userId?.trim();
    if (!userId) {
      return Response.json({ error: 'userId is required' }, { status: 400 });
    }
    if (userId !== user.id) {
      return Response.json(
        { error: 'You may only upsert your own Stream profile' },
        { status: 403 }
      );
    }
    try {
      await this.chatProvider.upsertUsers([
        {
          id: userId,
          name: body.userName?.trim() || 'Unknown',
          image: body.userAvatar?.trim() || undefined,
        },
      ]);
      return Response.json({ success: true });
    } catch (error) {
      logger.warn('Failed to upsert Stream user', { userId, error });
      return Response.json(
        { error: error instanceof Error ? error.message : 'Failed to upsert user' },
        { status: 500 }
      );
    }
  }

  /**
   * Send a message to the chat graph for processing.
   * The graph routes to appropriate subgraphs based on intent analysis.
   *
   * @param req - The HTTP request object (body: { message: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with graph execution result including responseText
   */
  @Post('/message')
  @UseGuards(AuthGuard)
  async message(req: Request, user: AuthenticatedUser) {
    // 1. Parse request body for message
    let messageContent: string = '';
    try {
      const body = await req.json() as { message?: string };
      messageContent = body.message || '';
    } catch {
      // No body or invalid JSON
      return Response.json(
        { error: 'Invalid request body. Expected { message: string }' },
        { status: 400 }
      );
    }

    if (!messageContent.trim()) {
      return Response.json(
        { error: 'Message content is required' },
        { status: 400 }
      );
    }

    // 2. Process message through service
    const result = await chatSessionService.processMessage(user.id, messageContent);

    // 3. Return response
    return Response.json({
      response: result.responseText,
      error: result.error
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
  @Post('/stream')
  @UseGuards(AuthGuard)
  async messageStream(req: Request, user: AuthenticatedUser): Promise<Response> {
    // 1. Parse request body
    let body: { message?: string; sessionId?: string; useCheckpointer?: boolean; fileIds?: string[]; indexId?: string };
    try {
      body = await req.json() as { message?: string; sessionId?: string; useCheckpointer?: boolean; fileIds?: string[]; indexId?: string };
    } catch {
      return Response.json(
        { error: 'Invalid request body. Expected { message: string, sessionId?: string, useCheckpointer?: boolean, fileIds?: string[] }' },
        { status: 400 }
      );
    }

    let messageContent = body.message?.trim() || '';
    const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];
    if (fileIds.length > 0) {
      const fileContent = await fileService.loadAttachedFileContent(user.id, fileIds);
      if (fileContent) {
        messageContent = messageContent
          ? `${messageContent}\n\n[Attached files]\n${fileContent}`
          : `[Attached files]\n${fileContent}`;
      }
    }
    if (!messageContent) {
      return Response.json(
        { error: 'Message content or file attachments are required' },
        { status: 400 }
      );
    }

    // 2. Validate or create session
    const requestIndexId =
      typeof body.indexId === 'string' && body.indexId.trim() ? body.indexId.trim() : undefined;

    let currentSessionId = body.sessionId;
    if (!currentSessionId) {
      currentSessionId = await chatSessionService.createSession(user.id, undefined, requestIndexId);
    } else {
      const session = await chatSessionService.getSession(currentSessionId, user.id);
      if (!session) {
        return Response.json({ error: 'Session not found' }, { status: 404 });
      }
      if (requestIndexId !== undefined) {
        await chatSessionService.updateSessionIndex(currentSessionId, user.id, requestIndexId);
      }
    }

    // Effective index for this run: request body overrides; otherwise use session's persisted index
    const sessionForIndex = await chatSessionService.getSession(currentSessionId, user.id);
    const effectiveIndexId = requestIndexId ?? sessionForIndex?.indexId ?? undefined;

    // Capture for closure
    const sessionId = currentSessionId;
    const factory = chatSessionService.getGraphFactory();
    const useCheckpointer = body.useCheckpointer ?? true;
    const indexIdForStream = effectiveIndexId;

    // User message is persisted after the stream completes (with the assistant response) so that
    // loadSessionContext during streaming does not include it and the current message is not
    // duplicated in the conversation context (which caused "You've listed the same project twice!").

    // 3. Get checkpointer if requested
    const checkpointer = useCheckpointer ? await chatSessionService.getCheckpointer() : undefined;
    if (useCheckpointer && checkpointer) {
      logger.info('PostgresSaver checkpointer initialized', { sessionId });
    }

    // 4. Create SSE stream
    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial status
          controller.enqueue(encoder.encode(
            formatSSEEvent(createStatusEvent(sessionId, 'Processing message...'))
          ));

          // Stream chat graph events with context
          let fullResponse = '';
          let routingDecision: Record<string, unknown> | undefined;
          let subgraphResults: Record<string, unknown> | undefined;

          // Use context-aware streaming to load previous messages
          for await (const event of factory.streamChatEventsWithContext(
            {
              userId: user.id,
              message: messageContent,
              sessionId,
              maxContextMessages: 20,
              indexId: indexIdForStream,
            },
            checkpointer
          )) {
            if (event) {
              controller.enqueue(encoder.encode(formatSSEEvent(event)));

              // Accumulate response for persistence
              if (event.type === 'token') {
                fullResponse += event.content;
              } else if (event.type === 'routing') {
                routingDecision = { target: event.target, reasoning: event.reasoning };
              } else if (event.type === 'subgraph_result') {
                subgraphResults = { ...subgraphResults, [event.subgraph]: event.data };
              }
            }
          }

          // Persist user message and assistant response so loadSessionContext on the next turn sees them
          await chatSessionService.addMessage({
            sessionId,
            role: 'user',
            content: messageContent,
          });
          await chatSessionService.addMessage({
            sessionId,
            role: 'assistant',
            content: fullResponse,
            routingDecision,
            subgraphResults,
          });

          // Auto-generate session title
          const sessionTitle = await chatSessionService.generateSessionTitle(sessionId, user.id);

          // Send done event with title
          controller.enqueue(encoder.encode(
            formatSSEEvent(createDoneEvent(sessionId, fullResponse, routingDecision, subgraphResults, sessionTitle))
          ));

        } catch (error) {
          controller.enqueue(encoder.encode(
            formatSSEEvent(createErrorEvent(
              sessionId,
              error instanceof Error ? error.message : 'Unknown error',
              'STREAM_ERROR'
            ))
          ));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Session-Id': sessionId,
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
  @Get('/sessions')
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
  @Post('/session')
  @UseGuards(AuthGuard)
  async getSession(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string };
    try {
      body = await req.json() as { sessionId?: string };
    } catch {
      return Response.json(
        { error: 'Invalid request body. Expected { sessionId: string }' },
        { status: 400 }
      );
    }

    if (!body.sessionId) {
      return Response.json(
        { error: 'sessionId is required' },
        { status: 400 }
      );
    }

    const session = await chatSessionService.getSession(body.sessionId, user.id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const messages = await chatSessionService.getSessionMessages(body.sessionId);
    return Response.json({ session, messages });
  }

  /**
   * Delete a chat session.
   * Uses POST with sessionId in body due to router limitations with path params.
   *
   * @param req - The HTTP request object (body: { sessionId: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with success status
   */
  @Post('/session/delete')
  @UseGuards(AuthGuard)
  async deleteSession(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string };
    try {
      body = await req.json() as { sessionId?: string };
    } catch {
      return Response.json(
        { error: 'Invalid request body. Expected { sessionId: string }' },
        { status: 400 }
      );
    }

    if (!body.sessionId) {
      return Response.json(
        { error: 'sessionId is required' },
        { status: 400 }
      );
    }

    const deleted = await chatSessionService.deleteSession(body.sessionId, user.id);
    if (!deleted) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
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
  @Post('/session/title')
  @UseGuards(AuthGuard)
  async updateSessionTitle(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string; title?: string };
    try {
      body = await req.json() as { sessionId?: string; title?: string };
    } catch {
      return Response.json(
        { error: 'Invalid request body. Expected { sessionId: string, title: string }' },
        { status: 400 }
      );
    }

    if (!body.sessionId || body.title === undefined) {
      return Response.json(
        { error: 'sessionId and title are required' },
        { status: 400 }
      );
    }

    const title = String(body.title).trim();
    if (!title) {
      return Response.json(
        { error: 'title cannot be empty' },
        { status: 400 }
      );
    }

    const updated = await chatSessionService.updateSessionTitle(body.sessionId, user.id, title);
    if (!updated) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    return Response.json({ success: true, title });
  }
}
