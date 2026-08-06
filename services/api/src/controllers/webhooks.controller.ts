import { RateLimit } from '../guards/limiter.guard';
import { Controller, Post, UseGuards } from '../lib/router/router.decorators';
import { handleInbound } from '../gateways/telegram.gateway';
import { isTelegramOutboundConfigured } from '../lib/telegram/bot-api';
import { log } from '../lib/log';

const logger = log.controller.from('webhooks');

/** Warn once per process that inbound updates are being dropped. */
let droppedInboundWarned = false;

/** Shape of a Telegram Update object (only fields we use). */
interface TelegramUpdate {
  message?: {
    chat: { id: number };
    from?: { username?: string };
    text?: string;
  };
}

/**
 * General-purpose webhook receiver. Not specific to Telegram — future
 * webhooks from other services can be added here as new routes.
 */
@Controller('/webhooks')
export class WebhooksController {
  /**
   * Receive updates from the Telegram Bot API.
   * Telegram calls this URL for every incoming message.
   * Validated via X-Telegram-Bot-Api-Secret-Token header.
   *
   * POST /webhooks/telegram
   */
  @Post('/telegram')
  @UseGuards(RateLimit('write'))
  async telegram(req: Request): Promise<Response> {
    const secret = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (!secret || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    let body: TelegramUpdate;
    try {
      body = (await req.json()) as TelegramUpdate;
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    // Inbound (`TELEGRAM_WEBHOOK_SECRET`) and outbound (`TELEGRAM_BOT_TOKEN`)
    // are gated separately, so a half-configured deployment authenticates
    // updates it can never answer. Without this guard the full LLM graph runs
    // — real token spend, chat session and message rows written — and every
    // reply is then discarded at the bot-api boundary. Drop early instead.
    //
    // Still 200: a non-2xx makes Telegram retry the same update indefinitely.
    if (!isTelegramOutboundConfigured()) {
      if (!droppedInboundWarned) {
        droppedInboundWarned = true;
        logger.warn(
          'Telegram inbound dropped: TELEGRAM_WEBHOOK_SECRET is set but TELEGRAM_BOT_TOKEN is not. '
          + 'Unset both to disable the gateway cleanly.',
        );
      }
      return new Response('OK', { status: 200 });
    }

    const message = body.message;
    if (message?.text) {
      const chatId = String(message.chat.id);
      handleInbound(chatId, message.text, undefined, undefined, message.from?.username).catch((err) => {
        logger.error('Telegram inbound handling failed', { chatId, error: err });
      });
    }

    // Always respond 200 immediately — Telegram resends if we take too long.
    return new Response('OK', { status: 200 });
  }
}
