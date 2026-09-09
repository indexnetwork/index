import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import { ConversationService } from '../services/conversation.service';

/**
 * The authenticated user's single realtime channel.
 *
 * It is not a conversation resource: the same stream carries conversation
 * messages and the notification frames (`opportunity.*`, `negotiation.*`,
 * `intent.lifecycle`) that agents and desktop toasts read. Consumers
 * discriminate on `type` and ignore what they do not handle.
 */
@Controller('/events')
export class EventsController {
  constructor(private readonly conversationService: ConversationService) {}

  /**
   * GET /events — open the user's SSE channel.
   *
   * @param _req - The HTTP request object (unused)
   * @param user - Authenticated user from AuthGuard
   * @returns SSE event stream
   */
  @Get('')
  @UseGuards(AuthGuard)
  async subscribe(_req: Request, user: AuthenticatedUser) {
    let subscription;
    try {
      subscription = await this.conversationService.openEventStream(user.id);
    } catch {
      return Response.json({ error: 'Event stream is temporarily unavailable' }, { status: 503 });
    }

    const encoder = new TextEncoder();
    let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

        subscription.onMessage((data) => {
          try {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch { /* stream closed */ }
        });

        keepaliveInterval = setInterval(() => {
          try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { clearInterval(keepaliveInterval!); }
        }, 15000);
      },
      async cancel() {
        if (cancelled) return;
        cancelled = true;
        if (keepaliveInterval) clearInterval(keepaliveInterval);
        await subscription.cleanup();
      },
    });

    return new Response(readableStream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
    });
  }
}
