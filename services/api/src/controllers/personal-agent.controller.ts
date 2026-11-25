import { SessionOnlyGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { HISTORY_TURNS, messageText, runPersonalAgent } from '../lib/personal-agent/personal-agent';
import { PERSONAL_PAST_SCOPE, PERSONAL_SCOPE } from '../lib/personal-agent/personal-agent.instructions';
import { log } from '../lib/log';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { AGENT_DM_ID, ConversationService } from '../services/conversation.service';
import { intentService } from '../services/intent.service';

const logger = log.controller.from('personal-agent');

const MAX_TEXT = 4000;
const PAGE = 60;
/** Words of an intent kept in the agent's "started …" line. */
const LABEL_WORDS = 6;

/** A short label for an intent: its summary (or text), cut to a few words. */
function intentLabel(intent: { summary?: string | null; payload?: string | null }): string {
  const words = (intent.summary?.trim() || intent.payload?.trim() || 'your intent').replace(/[[\]]/g, '').split(/\s+/);
  return words.length > LABEL_WORDS ? `${words.slice(0, LABEL_WORDS).join(' ')}…` : words.join(' ');
}

/**
 * The personal agent's chat: one conversation where the owner's agent
 * creates and manages intents, reviews matches and updates the profile with
 * the Index MCP tools. Messages are stored in the owner's agent DM tagged
 * `scope: 'home'` (PERSONAL_SCOPE), which never wakes an intent agent.
 */
@Controller('/personal-agent')
export class PersonalAgentController {
  /** Owners with a turn running; a second send waits for the first. */
  private readonly busy = new Set<string>();

  constructor(private readonly conversationService: ConversationService) {}

  /** The chat so far, oldest first. */
  @Get('/messages')
  @UseGuards(SessionOnlyGuard)
  async getMessages(_req: Request, user: AuthenticatedUser) {
    try {
      const resolved = await this.conversationService.resolveId(AGENT_DM_ID, user.id);
      if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });
      const messages = await this.conversationService.getMessages(resolved.id, { userId: user.id, scope: PERSONAL_SCOPE, limit: PAGE });
      return Response.json({ messages, busy: this.busy.has(user.id) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('getMessages failed', { userId: user.id, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * The questions Home shows: one card per question group your agent has on
   * screen. A question nothing has grouped yet gets a group of its own here,
   * with no model call, so Home never waits on one.
   */
  @Get('/questions')
  @UseGuards(SessionOnlyGuard)
  async getQuestions(_req: Request, user: AuthenticatedUser) {
    try {
      return Response.json({ groups: await this.conversationService.questionCards(user.id) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('getQuestions failed', { userId: user.id, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /** Start a new chat: the current one is set aside and the agent starts fresh. */
  @Post('/new')
  @UseGuards(SessionOnlyGuard)
  async newChat(_req: Request, user: AuthenticatedUser) {
    if (this.busy.has(user.id)) return Response.json({ error: 'Your agent is still working on your last message.' }, { status: 409 });
    try {
      const resolved = await this.conversationService.resolveId(AGENT_DM_ID, user.id);
      if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });
      const moved = await this.conversationService.rescopeMessages(resolved.id, user.id, PERSONAL_SCOPE, PERSONAL_PAST_SCOPE);
      return Response.json({ ok: true, moved });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('newChat failed', { userId: user.id, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * Record an intent the owner just created with the new intent flow inside
   * the chat, so the chat (and the agent, on later turns) remembers it.
   * The agent's line is written here from the stored intent, never from the client.
   *
   * @returns The stored owner line (when `asked` was sent) and the agent's line.
   */
  @Post('/intent-created')
  @UseGuards(SessionOnlyGuard)
  async intentCreated(req: Request, user: AuthenticatedUser) {
    let body: { intentId?: unknown; asked?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const intentId = typeof body.intentId === 'string' ? body.intentId : '';
    const asked = typeof body.asked === 'string' ? body.asked.trim().slice(0, MAX_TEXT) : '';
    if (!intentId) return Response.json({ error: 'intentId is required' }, { status: 400 });
    try {
      const intent = await intentService.getById(intentId, user.id);
      if (!intent) return Response.json({ error: 'Intent not found' }, { status: 404 });
      const resolved = await this.conversationService.resolveId(AGENT_DM_ID, user.id);
      if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });

      const message = asked
        ? await this.conversationService.sendMessage(resolved.id, user.id, 'user', [{ kind: 'text', text: `start a new intent: ${asked}` }], { metadata: { scope: PERSONAL_SCOPE } })
        : null;
      const text = `started [${intentLabel(intent)}](https://index.network/i/${intentId}). i'll start looking for people now.`;
      const reply = await this.conversationService.sendAgentMessage(resolved.id, [{ kind: 'text', text }], {
        metadata: { scope: PERSONAL_SCOPE, changed: ['create_intent'], intentCreated: intentId },
      });
      return Response.json({ message, reply }, { status: 201 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('intentCreated failed', { userId: user.id, intentId, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * Send the owner's message and run one agent turn.
   *
   * @returns The stored owner message, the agent's reply, and which tools changed something.
   */
  @Post('/messages')
  @UseGuards(SessionOnlyGuard)
  async sendMessage(req: Request, user: AuthenticatedUser) {
    let body: { text?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return Response.json({ error: 'text is required' }, { status: 400 });
    if (text.length > MAX_TEXT) return Response.json({ error: `text must be at most ${MAX_TEXT} characters` }, { status: 400 });
    if (this.busy.has(user.id)) return Response.json({ error: 'Your agent is still working on your last message.' }, { status: 409 });

    this.busy.add(user.id);
    try {
      const resolved = await this.conversationService.resolveId(AGENT_DM_ID, user.id);
      if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });
      const conversationId = resolved.id;

      const history = await this.conversationService.getMessages(conversationId, { userId: user.id, scope: PERSONAL_SCOPE, limit: HISTORY_TURNS });
      const message = await this.conversationService.sendMessage(conversationId, user.id, 'user', [{ kind: 'text', text }], { metadata: { scope: PERSONAL_SCOPE } });

      let reply;
      try {
        reply = await runPersonalAgent({
          userId: user.id,
          userName: user.name,
          turns: [
            ...history.map((entry) => ({ role: entry.role, text: messageText(entry.parts) })),
            { role: 'user' as const, text },
          ],
        });
      } catch (err: unknown) {
        logger.error('personal agent turn failed', { userId: user.id, error: err instanceof Error ? err.message : String(err) });
        return Response.json({ message, error: "I couldn't finish that. Try again in a moment." }, { status: 502 });
      }

      const answer = await this.conversationService.sendAgentMessage(conversationId, [{ kind: 'text', text: reply.text }], {
        metadata: { scope: PERSONAL_SCOPE, ...(reply.changed.length ? { changed: reply.changed } : {}) },
      });
      return Response.json({ message, reply: answer, changed: reply.changed }, { status: 201 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('sendMessage failed', { userId: user.id, error: message });
      return Response.json({ error: message }, { status: 500 });
    } finally {
      this.busy.delete(user.id);
    }
  }
}
