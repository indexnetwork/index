import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import type { NotificationDeliveryService } from '../services/notification-delivery.service';

/**
 * Persisted catch-up for user notifications. Live frames arrive on the user's
 * single SSE channel, `GET /conversations/stream`.
 */
@Controller('/notifications')
export class NotificationController {
  constructor(
    private readonly notificationDeliveryService: Pick<NotificationDeliveryService, 'snapshot'>,
  ) {}

  @Get('/snapshot')
  @UseGuards(AuthGuard)
  async snapshot(_req: Request, user: AuthenticatedUser) {
    const events = await this.notificationDeliveryService.snapshot(user.id);
    return Response.json({ events });
  }
}
