import { RateLimit } from '../guards/limiter.guard';
import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import { log } from '../lib/log';

import { UnsubscribeService } from '../services/unsubscribe.service';

const logger = log.controller.from('unsubscribe');

/**
 * Handles ghost user unsubscribe requests.
 * Public endpoint — no auth required (ghost users cannot log in).
 */
@Controller('/unsubscribe')
export class UnsubscribeController {
  private service = new UnsubscribeService();

  /**
   * GET /unsubscribe/:token — soft-delete a ghost user to opt out of emails.
   * The token is the unsubscribeToken from userNotificationSettings, included in invite email unsubscribe links.
   * @param _req - Unused request object
   * @param _user - Unused (no auth guard)
   * @param params - Route params containing the unsubscribe token
   * @returns HTML response confirming unsubscribe or indicating not found
   */
  @Get('/:token')
  @UseGuards(RateLimit('read'))
  async unsubscribe(_req: Request, _user: unknown, params?: Record<string, string>) {
    const token = params?.token;
    if (!token) {
      return Response.json({ error: 'Missing token' }, { status: 400 });
    }

    try {
      const result = await this.service.softDeleteGhostByToken(token);
      if (!result) {
        return new Response(
          '<html><body style="font-family:Arial,sans-serif;text-align:center;padding:60px"><h2>Not Found</h2><p>This unsubscribe link is no longer valid.</p></body></html>',
          { status: 404, headers: { 'Content-Type': 'text/html' } }
        );
      }

      return new Response(
        '<html><body style="font-family:Arial,sans-serif;text-align:center;padding:60px"><h2>Unsubscribed</h2><p>You will no longer receive emails from Index.</p></body></html>',
        { headers: { 'Content-Type': 'text/html' } }
      );
    } catch (err) {
      logger.error('Unsubscribe failed', { error: err });
      return Response.json({ error: 'Internal error' }, { status: 500 });
    }
  }
}
