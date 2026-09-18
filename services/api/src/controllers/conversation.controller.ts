import { z } from 'zod';

import { AuthGuard, isSessionAuthenticated, type AuthenticatedUser } from '../guards/auth.guard';
import { RuntimeConflictError } from '../lib/agent/runtime-errors';
import { Controller, Get, Post, Patch, Delete, UseGuards } from '../lib/router/router.decorators';
import { log } from '../lib/log';
import { agentService } from '../services/agent.service';
import { AgentConversationError, ConversationService } from '../services/conversation.service';
import { PersonalAgentError, PersonalAgentService } from '../services/personal-agent.service';

type RouteParams = Record<string, string>;

const logger = log.controller.from('conversation');
const answerBatchSchema = z.object({
  intentId: z.string().min(1),
  answers: z.array(z.object({ questionId: z.string().min(1), text: z.string().trim().min(1) }).strict()).min(1),
}).strict();
const h2aSchema = z.object({
  intentId: z.string().min(1),
  entries: z.array(z.object({
    id: z.string().uuid(), createdAt: z.string().datetime(), text: z.string().trim().min(1),
    kind: z.enum(['question', 'message', 'expire']), questionId: z.string().min(1).optional(), batchId: z.string().min(1).optional(),
    scope: z.enum(['intent', 'match']).optional(), options: z.array(z.string()).optional(),
    matches: z.array(z.object({ opportunityId: z.string(), counterparty: z.object({ id: z.string(), name: z.string().nullable() }).strict() }).strict()),
  }).strict().refine((entry) => entry.kind === 'message' || Boolean(entry.questionId), 'Questions and withdrawals require questionId.')),
}).strict();

/**
 * HTTP controller for conversation REST API endpoints.
 * Thin layer: parses requests, delegates to ConversationService, formats responses.
 */
@Controller('/conversations')
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly personalAgents: PersonalAgentService,
  ) {}

  /**
   * GET /conversations — list all conversations for the authenticated user.
   *
   * @param _req - The HTTP request object (unused)
   * @param user - Authenticated user from AuthGuard
   * @returns JSON with conversations array
   */
  @Get('')
  @UseGuards(AuthGuard)
  async getConversations(_req: Request, user: AuthenticatedUser) {
    try {
      const conversations = await this.conversationService.getConversations(user.id);
      return Response.json({ conversations });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('getConversations failed', { userId: user.id, error: message });
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
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
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
      const [messages, agent] = await Promise.all([
        this.conversationService.getMessages(conversationId, { limit, before, intentId, userId: user.id }),
        this.readAgentState(conversationId, user.id, intentId),
      ]);
      // The id is echoed because `agent` resolves to a conversation the caller
      // has no other way to name.
      return Response.json({ conversationId, messages, agent });
    } catch (err: unknown) {
      if (err instanceof PersonalAgentError || err instanceof AgentConversationError) return Response.json({ error: err.message }, { status: err.status });
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('Forbidden')) {
        return Response.json({ error: message }, { status: 403 });
      }
      logger.error('getMessages failed', { userId: user.id, conversationId, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  private async readAgentState(conversationId: string, userId: string, intentId?: string) {
    if (!intentId || !await this.conversationService.isAgentDm(conversationId)) return undefined;
    const agent = await this.personalAgents.state(userId, intentId);
    return agent.status === 'external' ? this.conversationService.agentState(userId, intentId) : agent;
  }

  /**
   * POST /conversations/:id/read — mark a conversation read for the caller.
   * Accepts full UUID or short ID prefix.
   */
  @Post('/:id/read')
  @UseGuards(AuthGuard)
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
   * Accepts `agent`, a full UUID, or a short ID prefix.
   *
   * An agent-bound API key writing into its owner's agent DM speaks as the
   * agent, and must say which signal it is speaking about; every other
   * credential speaks as the authenticated user. A session token therefore
   * cannot post as the agent.
   *
   * @param req - Must include `parts` array in JSON body; optional `metadata`
   * @param user - Authenticated user from AuthGuard
   * @param params - Route params containing the conversation ID or prefix
   * @returns JSON with created message
   */
  @Post('/:id/messages')
  @UseGuards(AuthGuard)
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
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!Array.isArray(body.parts) || body.parts.length === 0) {
      return Response.json({ error: 'parts array is required' }, { status: 400 });
    }

    // A key-authenticated caller writing into an agent DM writes as the
    // owner's negotiator. The key names no agent, so the selection is what
    // decides — with no negotiator chosen, the write stays a user message.
    const agentDm = await this.conversationService.isAgentDm(conversationId);
    const asAgent = !isSessionAuthenticated(req)
      && agentDm
      && await agentService.getSelectedNegotiator(user.id) !== null;

    if (asAgent && typeof body.metadata?.intentId !== 'string') {
      return Response.json({ error: 'metadata.intentId is required' }, { status: 400 });
    }

    try {
      if (agentDm && !asAgent) {
        if (typeof body.metadata?.intentId !== 'string') throw new PersonalAgentError('metadata.intentId is required.', 400);
        if (Object.keys(body).some((key) => !['parts', 'metadata'].includes(key))) throw new PersonalAgentError('Direct messages accept parts and metadata. Submit answer batches to /answers.', 400);
        const parts = body.parts as { kind?: string; text?: string }[];
        if (!parts.every((part) => part && part.kind === 'text' && typeof part.text === 'string')) throw new AgentConversationError('Personal-agent messages must contain text.', 400);
        const text = parts.map((part) => part.text).join('\n').trim();
        if (!text) throw new PersonalAgentError('Message text is required.', 400);
        const messages = await this.personalAgents.send({ userId: user.id, intentId: body.metadata.intentId, conversationId, text });
        if (messages) return Response.json({ message: messages[0] }, { status: 201 });
        const message = await this.conversationService.sendOwnerInput({ userId: user.id, intentId: body.metadata.intentId, conversationId, text, questionId: null });
        return Response.json({ message }, { status: 201 });
      }
      if (asAgent) throw new AgentConversationError('Publish external-agent entries through /conversations/agent/h2a with executorId.', 400);
      const msg = await this.conversationService.sendMessage(
        conversationId, user.id, 'user', body.parts, { metadata: body.metadata }
      );
      return Response.json({ message: msg }, { status: 201 });
    } catch (err: unknown) {
      if (err instanceof PersonalAgentError || err instanceof AgentConversationError) return Response.json({ error: err.message }, { status: err.status });
      if (err instanceof RuntimeConflictError) return Response.json({ error: 'The selected executor changed. Refresh and try again.' }, { status: 409 });
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('Forbidden')) {
        return Response.json({ error: message }, { status: 403 });
      }
      logger.error('sendMessage failed', { userId: user.id, conversationId, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * Submit the complete current H2A answer batch in one transaction.
   * @param req - Intent ID and exact question ID/text pairs.
   * @param user - Authenticated principal, never an external agent speaking for them.
   * @param params - Canonical agent DM or its alias.
   * @returns All committed answer messages, or an error with no partial acceptance.
   */
  @Post('/:id/answers')
  @UseGuards(AuthGuard)
  async answerQuestions(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    if (!params?.id) return Response.json({ error: 'Conversation ID required' }, { status: 400 });
    const resolved = await this.conversationService.resolveId(params.id, user.id);
    if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });
    let body: unknown;
    try { body = await req.json(); }
    catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }); }
    const parsed = answerBatchSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: 'Provide intentId and nonempty questionId/text answers.' }, { status: 400 });
    try {
      if (!await this.conversationService.isAgentDm(resolved.id)) throw new PersonalAgentError('Answers belong in your agent conversation.', 400);
      if (!isSessionAuthenticated(req) && await agentService.getSelectedNegotiator(user.id)) throw new PersonalAgentError('Only the principal can answer the selected external agent.', 400);
      const input = { userId: user.id, conversationId: resolved.id, ...parsed.data };
      const messages = await this.personalAgents.send(input) ?? await this.conversationService.answerQuestions(input);
      return Response.json({ messages }, { status: 201 });
    } catch (err: unknown) {
      if (err instanceof PersonalAgentError || err instanceof AgentConversationError) return Response.json({ error: err.message }, { status: err.status });
      if (err instanceof RuntimeConflictError) return Response.json({ error: 'The selected executor changed. Refresh and try again.' }, { status: 409 });
      const message = err instanceof Error ? err.message : String(err);
      logger.error('answerQuestions failed', { userId: user.id, conversationId: resolved.id, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * Request the same explicit H2A review as the TUI's Wake action.
   * @param req - The owned intent ID, without new evidence or permission.
   * @param user - Authenticated principal.
   * @param params - Canonical agent DM or its alias.
   * @returns Acceptance of a private wake receipt, never a claim of completed reasoning.
   */
  @Post('/:id/wake')
  @UseGuards(AuthGuard)
  async wakeAgent(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    if (!params?.id) return Response.json({ error: 'Conversation ID required' }, { status: 400 });
    const parsed = z.object({ intentId: z.string().min(1) }).strict().safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: 'Provide intentId only.' }, { status: 400 });
    const resolved = await this.conversationService.resolveId(params.id, user.id);
    if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });
    try {
      await this.personalAgents.wake({ userId: user.id, conversationId: resolved.id, intentId: parsed.data.intentId });
      return Response.json({ accepted: true }, { status: 202 });
    } catch (err: unknown) {
      if (err instanceof PersonalAgentError) return Response.json({ error: err.message }, { status: err.status });
      const message = err instanceof Error ? err.message : String(err);
      logger.error('wakeAgent failed', { userId: user.id, intentId: parsed.data.intentId, error: message });
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
  @UseGuards(AuthGuard)
  async getOrCreateDm(req: Request, user: AuthenticatedUser) {
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
      const conversation = await this.conversationService.getOrCreateDm(user.id, body.peerUserId);
      // Return the same viewer-scoped summary shape as GET /conversations so
      // a thread opened directly can render match provenance immediately.
      const summary = (await this.conversationService.getConversations(user.id))
        .find((candidate) => candidate.id === conversation.id);
      return Response.json({ conversation: summary ?? conversation });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('getOrCreateDm failed', { userId: user.id, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * POST /conversations/agent/h2a — an external executor publishes questions and messages.
   *
   * @param req - `executorId` query fence plus `{ intentId, entries }`.
   * @param user - Authenticated owner (session token).
   * @returns Success when the entries are on the agent DM.
   */
  @Post('/agent/h2a')
  @UseGuards(AuthGuard)
  async publishH2A(req: Request, user: AuthenticatedUser) {
    const executorId = new URL(req.url).searchParams.get('executorId');
    if (!executorId || !z.string().uuid().safeParse(executorId).success) {
      return Response.json({ error: 'executorId must be a UUID' }, { status: 400 });
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const parsed = h2aSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: 'Provide intentId and valid public H2A entries.' }, { status: 400 });
    try {
      await this.conversationService.publishH2A({ userId: user.id, executorId, ...parsed.data });
      return Response.json({ ok: true });
    } catch (err: unknown) {
      if (err instanceof AgentConversationError) return Response.json({ error: err.message }, { status: err.status });
      if (err instanceof RuntimeConflictError) {
        return Response.json({ error: 'The selected negotiation executor changed; stop this work' }, { status: 409 });
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error('publishH2A failed', { userId: user.id, error: message });
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
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
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

}
