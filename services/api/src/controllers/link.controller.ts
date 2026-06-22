import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { log } from '../lib/log';
import { Controller, Delete, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { linkService } from '../services/link.service';

const logger = log.controller.from('link');

@Controller('/links')
export class LinkController {
  /**
   * List all links for the authenticated user.
   */
  @Get('')
  @UseGuards(RateLimit('read'), AuthGuard)
  async list(_req: Request, user: AuthenticatedUser) {
    const rows = await linkService.listLinks(user.id);

    return Response.json({
      links: rows.map(r => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
      })),
    });
  }

  /**
   * Create a new link.
   */
  @Post('')
  @UseGuards(RateLimit('write'), AuthGuard)
  async create(req: Request, user: AuthenticatedUser) {
    const body = await req.json().catch(() => ({})) as { url?: string };
    if (!body.url) {
      return Response.json({ error: 'url is required' }, { status: 400 });
    }

    const inserted = await linkService.createLink(user.id, body.url);

    logger.verbose('Link created', { userId: user.id, linkId: inserted.id });

    return Response.json({
      link: {
        ...inserted,
        createdAt: inserted.createdAt.toISOString(),
        lastSyncAt: inserted.lastSyncAt?.toISOString() ?? null,
      },
    });
  }

  /**
   * Delete a link.
   */
  @Delete('/:id')
  @UseGuards(RateLimit('write'), AuthGuard)
  async delete(_req: Request, user: AuthenticatedUser, params: { id: string }) {
    const deleted = await linkService.deleteLink(params.id, user.id);

    if (!deleted) {
      return Response.json({ error: 'Link not found' }, { status: 404 });
    }

    return Response.json({ success: true });
  }

  /**
   * Get link content (stub — returns stored metadata).
   */
  @Get('/:id/content')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getContent(_req: Request, user: AuthenticatedUser, params: { id: string }) {
    const link = await linkService.getLinkContent(params.id, user.id);

    if (!link) {
      return Response.json({ error: 'Link not found' }, { status: 404 });
    }

    return Response.json({
      url: link.url,
      lastSyncAt: link.lastSyncAt?.toISOString() ?? null,
      lastStatus: link.lastStatus,
      pending: link.lastStatus === null,
    });
  }
}
