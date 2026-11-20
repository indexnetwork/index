import { z } from 'zod';

import { introducerService } from '../services/introducer.service';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';

const logger = log.controller.from('introducer');

type RouteParams = Record<string, string>;

const WAKE_BODY = z.object({ context: z.string().trim().min(1).max(2000) });

const WAKE_REFUSALS = {
  not_found: { status: 404, error: 'Not found' },
  busy: { status: 409, error: 'Already woken' },
  gone: { status: 409, error: "That intent isn't public in a network you share any more" },
} as const;

const IMPORT_REFUSALS = {
  not_linked: { status: 409, error: 'Connect a Google account first' },
  missing_scope: { status: 409, error: 'Allow Index to read your Google contacts first' },
  google_error: { status: 502, error: 'Google did not return your contacts; try again' },
} as const;

/**
 * IntroducerController: the Intro Desk. A member connects Google contacts,
 * sees which of them fit what people in their networks want, wakes a pair,
 * and follows the introductions they opened (status only).
 */
@Controller('/introducer')
export class IntroducerController {
  /** GET /introducer/status — Google link, contacts scope, and contact counts. Starts a daily resync when due. */
  @Get('/status')
  @UseGuards(AuthGuard)
  async status(_req: Request, user: AuthenticatedUser) {
    const status = await introducerService.status(user.id);
    introducerService.syncIfStale(user.id, status);
    return Response.json(status);
  }

  /** POST /introducer/contacts/import — the first sync, right after Google is connected. */
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

  /** GET /introducer/pairs — stored suggestions: a member's need ⇄ one of your contacts not on Index. */
  @Get('/pairs')
  @UseGuards(AuthGuard)
  async pairs(_req: Request, user: AuthenticatedUser) {
    return Response.json({ pairs: await introducerService.suggestions(user.id) });
  }

  /** POST /introducer/pairs/:id/skip — hide a suggestion. */
  @Post('/pairs/:id/skip')
  @UseGuards(AuthGuard)
  async skip(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = z.string().uuid().safeParse(params?.id);
    if (!id.success) return Response.json({ error: 'Invalid id' }, { status: 400 });
    if (!await introducerService.skip(user.id, id.data)) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ ok: true });
  }

  /**
   * POST /introducer/pairs/:id/wake — `{ context }`. Seats the contact through
   * you and wakes both agents in the background; poll GET /introducer/pairs.
   */
  @Post('/pairs/:id/wake')
  @UseGuards(AuthGuard)
  async wake(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = z.string().uuid().safeParse(params?.id);
    if (!id.success) return Response.json({ error: 'Invalid id' }, { status: 400 });
    const body = WAKE_BODY.safeParse(await req.json().catch(() => null));
    if (!body.success) return Response.json({ error: 'Write an intro of up to 2000 characters' }, { status: 400 });
    const outcome = await introducerService.wake(user.id, id.data, body.data.context.trim());
    if (outcome.kind === 'ok') return Response.json({ ok: true }, { status: 202 });
    const refusal = WAKE_REFUSALS[outcome.kind];
    return Response.json({ error: refusal.error }, { status: refusal.status });
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
