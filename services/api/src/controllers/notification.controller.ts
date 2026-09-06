import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import type { NotificationDeliveryService } from '../services/notification-delivery.service';
import type { NotificationService } from '../services/notification.service';

/**
 * SSE and persisted catch-up endpoints for user notifications.
 */
@Controller('/notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: Pick<NotificationService, 'open'>,
    private readonly notificationDeliveryService: Pick<NotificationDeliveryService, 'snapshot'>,
  ) {}

  @Get('/stream')
  @UseGuards(RateLimit('read'), AuthGuard)
  async stream(_req: Request, user: AuthenticatedUser) {
    let subscription;
    try {
      subscription = await this.notificationService.open(user.id);
    } catch {
      return Response.json(
        { error: 'Notification stream is temporarily unavailable' },
        { status: 503 },
      );
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
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch {
            if (keepaliveInterval) clearInterval(keepaliveInterval);
          }
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
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  @Get('/snapshot')
  @UseGuards(RateLimit('read'), AuthGuard)
  async snapshot(_req: Request, user: AuthenticatedUser) {
    const events = await this.notificationDeliveryService.snapshot(user.id);
    return Response.json({ events });
  }
}
