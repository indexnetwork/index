import { Controller, Post } from '../lib/router/router.decorators';
import { log } from '../lib/log';

const logger = log.controller.from('subscribe');

/**
 * Handles newsletter and waitlist subscriptions via Loops.so.
 */
@Controller('/subscribe')
export class SubscribeController {
  @Post('')
  async subscribe(req: Request) {
    let body: {
      email: string;
      type?: 'newsletter' | 'waitlist';
      name?: string;
      whatYouDo?: string;
      whoToMeet?: string;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { email, type = 'newsletter', name, whatYouDo, whoToMeet } = body;

    if (!email) {
      return Response.json({ error: 'Email is required' }, { status: 400 });
    }

    logger.info('Processing subscription', { type });

    const res = await fetch(
      'https://app.loops.so/api/newsletter-form/cmkq2slhq0aii0iuf7jigfxos',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          source: type,
          firstName: name,
          whatYouDo,
          whoToMeet,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!res.ok) {
      logger.error('Subscription failed', { status: res.status });
      return Response.json({ error: 'Subscription failed' }, { status: res.status });
    }

    return Response.json({ success: true });
  }
}
