import { log } from '../lib/log';
import { emailReplyService } from '../lib/email/email-reply';
import { parseReceivedEvent } from '../lib/email/inbound-email';
import { parseResendEvent, verifyResendWebhook } from '../lib/email/resend-webhook';
import { Controller, Post } from '../lib/router/router.decorators';
import { emailEventService } from '../services/email-event.service';

const logger = log.controller.from('resend-webhook');

/**
 * Receives Resend events: delivery events for the daily send, open and click
 * counts, and received email, which may be an owner replying to their agent.
 * The Svix signature is the only credential: nothing is stored or acted on
 * unless it matches RESEND_WEBHOOK_SECRET.
 */
@Controller('/webhooks')
export class ResendWebhookController {
  @Post('/resend')
  async receive(req: Request) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return Response.json({ error: 'Webhook not configured' }, { status: 503 });

    const body = await req.text();
    const messageId = verifyResendWebhook(secret, req.headers, body);
    if (!messageId) return Response.json({ error: 'Invalid signature' }, { status: 401 });

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const received = parseReceivedEvent(payload);
    if (received) {
      try {
        const outcome = await emailReplyService.receive(received);
        logger.info('Received email handled', { emailId: received.emailId, outcome });
        return Response.json({ ok: true, outcome });
      } catch (error) {
        logger.error('Failed to handle received email', {
          emailId: received.emailId,
          error: error instanceof Error ? error.message : String(error),
        });
        return Response.json({ error: 'Failed to handle received email' }, { status: 500 });
      }
    }

    const event = parseResendEvent(payload);
    if (!event) return Response.json({ ok: true, stored: false });

    try {
      await emailEventService.record(messageId, event);
    } catch (error) {
      logger.error('Failed to store email event', {
        type: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return Response.json({ error: 'Failed to store event' }, { status: 500 });
    }
    return Response.json({ ok: true, stored: true });
  }
}
