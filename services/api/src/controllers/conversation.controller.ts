import { z } from 'zod';

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { Controller, Get, Post, Patch, Delete, UseGuards } from '../lib/router/router.decorators';
import { ConversationService } from '../services/conversation.service';
import { log } from '../lib/log';

type RouteParams = Record<string, string>;

const logger = log.controller.from('conversation');

const agentMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  intentId: z.string().uuid().optional(),
});

/**
 * HTTP controller for conversation REST API endpoints.
 * Thin layer: parses requests, delegates to ConversationService, formats responses.
 */
@Controller('/conversations')
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
  ) {}

  /**
   * GET /conversations — list all conversations for the authenticated user.
   *
   * @param _req - The HTTP request object (unused)
   * @param user - Authenticated user from AuthGuard
   * @returns JSON with conversations array
   */
  @Get('')
  @UseGuards(RateLimit('read'), AuthGuard)
  async listConversations(_req: Request, user: AuthenticatedUser) {
    try {
      const conversations = await this.conversationService.getConversations(user.id);
      return Response.json({ conversations });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('listConversations failed', { userId: user.id, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * POST /conversations/agent-messages — the agent posts a question into its
   * owner's agent DM, optionally tagged with the signal it belongs to.
   *
   * @param req - Must include `text`; optional `intentId`.
   * @param user - The owner, resolved from the agent's own bound key.
   * @returns JSON with the conversation id and the created message.
   */
  @Post('/agent-messages')
  @UseGuards(RateLimit('write'), AuthGuard)
  async sendAgentMessage(req: Request, user: AuthenticatedUser) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = agentMessageSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid message' }, { status: 400 });
    }

    try {
      const result = await this.conversationService.sendAgentMessage(user.id, parsed.data.text, parsed.data.intentId);
      return Response.json(result, { status: 201 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('sendAgentMessage failed', { userId: user.id, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * POST /conversations — create a new conversation with participants.
   *
   * @param req - Must include `participants` array in JSON body
   * @param user - Authenticated user from AuthGuard
   * @returns JSON with created conversation
   */
  @Post('')
  @UseGuards(RateLimit('write'), AuthGuard)
  async createConversation(req: Request, user: AuthenticatedUser) {
    let body: { participants?: { participantId: string; participantType: 'user' | 'agent' }[] };
    try {
      body = (await req.json()) as { participants?: { participantId: string; participantType: 'user' | 'agent' }[] };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!Array.isArray(body.participants) || body.participants.length === 0) {
      return Response.json({ error: 'participants array is required' }, { status: 400 });
    }

    const callerIncluded = body.participants.some(
      (p) => p.participantId === user.id && p.participantType === 'user',
    );
    if (!callerIncluded) {
      return Response.json(
        { error: 'Authenticated user must be included in participants' },
        { status: 400 },
      );
    }

    try {
      const conversation = await this.conversationService.createConversation(body.participants);
      return Response.json({ conversation }, { status: 201 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('createConversation failed', { userId: user.id, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * GET /conversations/:id/messages — get messages for a conversation.
   * Accepts full UUID or short ID prefix.
   *
   * @param req - Optional query params: limit, before, intentId
   * @param user - Authenticated user from AuthGuard
   * @param params - Route params containing the conversation ID or prefix
   * @returns JSON with messages array
   */
  @Get('/:id/messages')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getMessages(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const rawId = params?.id;
    if (!rawId) {
      return Response.json({ error: 'Conversation ID required' }, { status: 400 });
    }

    const resolved = await this.conversationService.resolveId(rawId, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }
    const conversationId = resolved.id;

    const url = new URL(req.url);
    const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined;
    const before = url.searchParams.get('before') ?? undefined;
    const intentId = url.searchParams.get('intentId') ?? undefined;
    const beforeSessionId = url.searchParams.get('beforeSessionId') ?? undefined;
    const sessionHistory = url.searchParams.get('sessionHistory') === 'true' || beforeSessionId !== undefined;

    try {
      if (sessionHistory) {
        const history = await this.conversationService.getSessionHistory(conversationId, {
          userId: user.id,
          beforeSessionId,
        });
        return Response.json({
          messages: history.messages,
          sessionId: history.session?.id ?? null,
          hasPreviousSession: history.hasPreviousSession,
          previousSessionCursor: history.hasPreviousSession ? history.session?.id ?? null : null,
        });
      }
      const messages = await this.conversationService.getMessages(conversationId, { limit, before, intentId, userId: user.id });
      return Response.json({ messages });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('Forbidden')) {
        return Response.json({ error: message }, { status: 403 });
      }
      logger.error('getMessages failed', { userId: user.id, conversationId, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * POST /conversations/:id/read — mark a conversation read for the caller.
   * Accepts full UUID or short ID prefix.
   */
  @Post('/:id/read')
  @UseGuards(RateLimit('write'), AuthGuard)
  async markConversationRead(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const rawId = params?.id;
    if (!rawId) {
      return Response.json({ error: 'Conversation ID required' }, { status: 400 });
    }

    const resolved = await this.conversationService.resolveId(rawId, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }
    const conversationId = resolved.id;

    try {
      await this.conversationService.markConversationRead(user.id, conversationId);
      return Response.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('Forbidden')) {
        return Response.json({ error: message }, { status: 403 });
      }
      logger.error('markConversationRead failed', { userId: user.id, conversationId, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * POST /conversations/:id/messages — send a message in a conversation.
   * Accepts full UUID or short ID prefix.
   *
   * @param req - Must include `parts` array in JSON body; optional `metadata`
   * @param user - Authenticated user from AuthGuard
   * @param params - Route params containing the conversation ID or prefix
   * @returns JSON with created message
   */
  @Post('/:id/messages')
  @UseGuards(RateLimit('write'), AuthGuard)
  async sendMessage(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const rawId = params?.id;
    if (!rawId) {
      return Response.json({ error: 'Conversation ID required' }, { status: 400 });
    }

    const resolved = await this.conversationService.resolveId(rawId, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }
    const conversationId = resolved.id;

    let body: { parts?: unknown[]; metadata?: Record<string, unknown> };
    try {
      body = (await req.json()) as { parts?: unknown[]; metadata?: Record<string, unknown> };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!Array.isArray(body.parts) || body.parts.length === 0) {
      return Response.json({ error: 'parts array is required' }, { status: 400 });
    }

    try {
      const msg = await this.conversationService.sendMessage(
        conversationId, user.id, 'user', body.parts, { metadata: body.metadata }
      );
      return Response.json({ message: msg }, { status: 201 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('Forbidden')) {
        return Response.json({ error: message }, { status: 403 });
      }
      logger.error('sendMessage failed', { userId: user.id, conversationId, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * POST /conversations/dm — get or create a DM conversation with a peer.
   *
   * @param req - Must include `peerUserId` in JSON body
   * @param user - Authenticated user from AuthGuard
   * @returns JSON with conversation
   */
  @Post('/dm')
  @UseGuards(RateLimit('write'), AuthGuard)
  async getOrCreateDM(req: Request, user: AuthenticatedUser) {
    let body: { peerUserId?: string };
    try {
      body = (await req.json()) as { peerUserId?: string };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.peerUserId) {
      return Response.json({ error: 'peerUserId is required' }, { status: 400 });
    }

    try {
      const conversation = await this.conversationService.getOrCreateDM(user.id, body.peerUserId);
      // Return the same viewer-scoped summary shape as GET /conversations so
      // a thread opened directly can render match provenance immediately.
      const summary = (await this.conversationService.getConversations(user.id))
        .find((candidate) => candidate.id === conversation.id);
      return Response.json({ conversation: summary ?? conversation });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('getOrCreateDM failed', { userId: user.id, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * PATCH /conversations/:id/metadata — update metadata for a conversation.
   * Accepts full UUID or short ID prefix.
   *
   * @param req - Must include `metadata` object in JSON body
   * @param user - Authenticated user from AuthGuard
   * @param params - Route params containing the conversation ID or prefix
   * @returns JSON with success status
   */
  @Patch('/:id/metadata')
  @UseGuards(RateLimit('write'), AuthGuard)
  async updateMetadata(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const rawId = params?.id;
    if (!rawId) {
      return Response.json({ error: 'Conversation ID required' }, { status: 400 });
    }

    const resolved = await this.conversationService.resolveId(rawId, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }
    const conversationId = resolved.id;

    let body: { metadata?: Record<string, unknown> };
    try {
      body = (await req.json()) as { metadata?: Record<string, unknown> };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.metadata || typeof body.metadata !== 'object') {
      return Response.json({ error: 'metadata object is required' }, { status: 400 });
    }

    try {
      await this.conversationService.updateMetadata(conversationId, body.metadata, user.id);
      return Response.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('Forbidden')) {
        return Response.json({ error: message }, { status: 403 });
      }
      logger.error('updateMetadata failed', { userId: user.id, conversationId, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * DELETE /conversations/:id — hide a conversation for the authenticated user.
   * Accepts full UUID or short ID prefix.
   *
   * @param _req - The HTTP request object (unused)
   * @param user - Authenticated user from AuthGuard
   * @param params - Route params containing the conversation ID or prefix
   * @returns JSON with success status
   */
  @Delete('/:id')
  @UseGuards(RateLimit('write'), AuthGuard)
  async hideConversation(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const rawId = params?.id;
    if (!rawId) {
      return Response.json({ error: 'Conversation ID required' }, { status: 400 });
    }

    const resolved = await this.conversationService.resolveId(rawId, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }
    const conversationId = resolved.id;

    try {
      await this.conversationService.hideConversation(user.id, conversationId);
      return Response.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('Forbidden')) {
        return Response.json({ error: message }, { status: 403 });
      }
      logger.error('hideConversation failed', { userId: user.id, conversationId, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * GET /conversations/stream — SSE endpoint for real-time conversation events.
   * Delegates subscription to ConversationService and pipes events into SSE response.
   *
   * @param _req - The HTTP request object (unused)
   * @param user - Authenticated user from AuthGuard
   * @returns SSE event stream
   */
  @Get('/stream')
  @UseGuards(RateLimit('read'), AuthGuard)
  async stream(_req: Request, user: AuthenticatedUser) {
    const encoder = new TextEncoder();
    const { onMessage, cleanup } = this.conversationService.subscribe(user.id);
    let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

        onMessage((data) => {
          try {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch { /* stream closed */ }
        });

        keepaliveInterval = setInterval(() => {
          try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { clearInterval(keepaliveInterval!); }
        }, 15000);
      },
      cancel() {
        if (keepaliveInterval) clearInterval(keepaliveInterval);
        cleanup();
      },
    });

    return new Response(readableStream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
    });
  }
}
