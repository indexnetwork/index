import { z } from 'zod';

import { introducerService } from '../services/introducer.service';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';

const logger = log.controller.from('introducer');

type RouteParams = Record<string, string>;

const IMPORT_REFUSALS = {
  not_linked: { status: 409, error: 'Connect a Google account first' },
  missing_scope: { status: 409, error: 'Allow Index to read your Google contacts first' },
  google_error: { status: 502, error: 'Google did not return your contacts; try again' },
} as const;

/**
 * IntroducerController: the Intro Desk. A member connects Google contacts,
 * sees pairs of people they could introduce, and follows the introductions
 * they opened. Opening one goes through POST /opportunities.
 */
@Controller('/introducer')
export class IntroducerController {
  /** GET /introducer/status — Google link, contacts scope, and import counts. */
  @Get('/status')
  @UseGuards(AuthGuard)
  async status(_req: Request, user: AuthenticatedUser) {
    return Response.json(await introducerService.status(user.id));
  }

  /** POST /introducer/contacts/import — pull Google contacts and match them to Index accounts. */
  @Post('/contacts/import')
  @UseGuards(AuthGuard)
  async importContacts(_req: Request, user: AuthenticatedUser) {
    const result = await introducerService.importContacts(user.id);
    if (result.kind !== 'ok') {
      const refusal = IMPORT_REFUSALS[result.kind];
      logger.warn('Contact import refused', { userId: user.id, kind: result.kind });
      return Response.json({ error: refusal.error, kind: result.kind }, { status: refusal.status });
    }
    return Response.json({ total: result.total, onIndex: result.onIndex });
  }

  /** GET /introducer/pairs — people the member could introduce to each other. */
  @Get('/pairs')
  @UseGuards(AuthGuard)
  async pairs(_req: Request, user: AuthenticatedUser) {
    return Response.json({ pairs: await introducerService.pairs(user.id) });
  }

  /** GET /introducer/introductions — introductions the member opened, with progress. */
  @Get('/introductions')
  @UseGuards(AuthGuard)
  async introductions(_req: Request, user: AuthenticatedUser) {
    return Response.json({ introductions: await introducerService.introductions(user.id) });
  }

  /** GET /introducer/introductions/:id — one introduction's progress. Only its introducer can read it. */
  @Get('/introductions/:id')
  @UseGuards(AuthGuard)
  async introduction(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = z.string().uuid().safeParse(params?.id);
    if (!id.success) return Response.json({ error: 'Invalid id' }, { status: 400 });
    const [introduction] = await introducerService.introductions(user.id, id.data);
    if (!introduction) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ introduction });
  }
}
