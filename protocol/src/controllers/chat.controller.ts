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
   * SSE sideband streaming endpoint for chat messages.
   * Streams LLM tokens in real-time but does NOT persist messages --
   * the XMTP agent handles message persistence.
   *
   * @param req - The HTTP request object (body: { message: string, conversationId?: string, fileIds?: string[], indexId?: string })
   * @param user - The authenticated user from AuthGuard
   * @returns SSE Response stream
   */
  @Post('/stream')
  @UseGuards(AuthGuard)
  async messageStream(req: Request, user: AuthenticatedUser): Promise<Response> {
    // 1. Parse request body
    let body: { message?: string; conversationId?: string; fileIds?: string[]; indexId?: string };
    try {
      body = await req.json() as { message?: string; conversationId?: string; fileIds?: string[]; indexId?: string };
    } catch {
      return Response.json(
        { error: 'Invalid request body. Expected { message: string, conversationId?: string, fileIds?: string[], indexId?: string }' },
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

    // 2. Use conversationId as the stream identifier (fallback to a random ID)
    const conversationId = body.conversationId?.trim() || crypto.randomUUID();
    const indexId = typeof body.indexId === 'string' && body.indexId.trim() ? body.indexId.trim() : undefined;
    const factory = chatSessionService.getGraphFactory();

    // 3. Create SSE stream
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial status
          controller.enqueue(encoder.encode(
            formatSSEEvent(createStatusEvent(conversationId, 'Processing message...'))
          ));

          // Stream chat graph events
          let fullResponse = '';
          let routingDecision: Record<string, unknown> | undefined;
          let subgraphResults: Record<string, unknown> | undefined;

          for await (const event of factory.streamChatEventsWithContext(
            {
              userId: user.id,
              message: messageContent,
              sessionId: conversationId,
              maxContextMessages: 20,
              indexId,
            },
          )) {
            if (event) {
              controller.enqueue(encoder.encode(formatSSEEvent(event)));

              // Accumulate response text
              if (event.type === 'token') {
                fullResponse += event.content;
              } else if (event.type === 'routing') {
                routingDecision = { target: event.target, reasoning: event.reasoning };
              } else if (event.type === 'subgraph_result') {
                subgraphResults = { ...subgraphResults, [event.subgraph]: event.data };
              }
            }
          }

          // Generate a suggested title from the exchange
          const suggestedTitle = await chatSessionService.generateTitle(messageContent, fullResponse);

          // Send done event with the full response and suggested title
          controller.enqueue(encoder.encode(
            formatSSEEvent(createDoneEvent(conversationId, fullResponse, routingDecision, subgraphResults, suggestedTitle))
          ));

        } catch (error) {
          logger.error('Stream error', {
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          });
          controller.enqueue(encoder.encode(
            formatSSEEvent(createErrorEvent(
              conversationId,
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
        'X-Conversation-Id': conversationId,
      },
    });
  }
}
