import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import { NotificationService } from '../services/notification.service';

/**
 * SSE endpoint for realtime user notifications (questions, opportunities).
 */
@Controller('/notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('/stream')
  @UseGuards(RateLimit('read'), AuthGuard)
  async stream(_req: Request, user: AuthenticatedUser) {
    const encoder = new TextEncoder();
    const { onMessage, cleanup } = this.notificationService.subscribe(user.id);
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
