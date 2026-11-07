import { SessionOnlyGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { HISTORY_TURNS, messageText, runHomeAgent } from '../lib/home-agent/home-agent';
import { log } from '../lib/log';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { AGENT_DM_ID, ConversationService } from '../services/conversation.service';

const logger = log.controller.from('home-agent');

/** Tag on every home chat message: it lives in the agent DM but belongs to no intent. */
const HOME_SCOPE = 'home';
const MAX_TEXT = 4000;
const PAGE = 60;

/**
 * The home screen's agent chat: one conversation where the owner's agent
 * creates and manages intents, reviews matches and updates the profile with
 * the Index MCP tools. Messages are stored in the owner's agent DM tagged
 * `scope: 'home'`, which never wakes the hosted intent agent.
 */
@Controller('/home-agent')
export class HomeAgentController {
  /** Owners with a turn running; a second send waits for the first. */
  private readonly busy = new Set<string>();

  constructor(private readonly conversationService: ConversationService) {}

  /** The home conversation so far, oldest first. */
  @Get('/messages')
  @UseGuards(SessionOnlyGuard)
  async getMessages(_req: Request, user: AuthenticatedUser) {
    try {
      const resolved = await this.conversationService.resolveId(AGENT_DM_ID, user.id);
      if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });
      const messages = await this.conversationService.getMessages(resolved.id, { userId: user.id, scope: HOME_SCOPE, limit: PAGE });
      return Response.json({ messages, busy: this.busy.has(user.id) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('getMessages failed', { userId: user.id, error: message });
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

      const history = await this.conversationService.getMessages(conversationId, { userId: user.id, scope: HOME_SCOPE, limit: HISTORY_TURNS });
      const message = await this.conversationService.sendMessage(conversationId, user.id, 'user', [{ kind: 'text', text }], { metadata: { scope: HOME_SCOPE } });

      let reply;
      try {
        reply = await runHomeAgent({
          userId: user.id,
          userName: user.name,
          turns: [
            ...history.map((entry) => ({ role: entry.role, text: messageText(entry.parts) })),
            { role: 'user' as const, text },
          ],
        });
      } catch (err: unknown) {
        logger.error('home agent turn failed', { userId: user.id, error: err instanceof Error ? err.message : String(err) });
        return Response.json({ message, error: "I couldn't finish that. Try again in a moment." }, { status: 502 });
      }

      const answer = await this.conversationService.sendAgentMessage(conversationId, [{ kind: 'text', text: reply.text }], {
        metadata: { scope: HOME_SCOPE, ...(reply.changed.length ? { changed: reply.changed } : {}) },
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
