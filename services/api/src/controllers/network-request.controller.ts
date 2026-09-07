import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Delete, Get, Patch, Post, UseGuards } from '../lib/router/router.decorators';
import { isStaff } from '../lib/staff';
import { networkRequestService, type NetworkRequestInput } from '../services/network-request.service';

const logger = log.controller.from('network-request');

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseInput(body: Record<string, unknown>): NetworkRequestInput | null {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const joinPolicy = body.joinPolicy === 'anyone' || body.joinPolicy === 'invite_only'
    ? body.joinPolicy
    : undefined;
  const imageUrl = body.imageUrl === null
    ? null
    : (typeof body.imageUrl === 'string' ? body.imageUrl.trim() || null : undefined);
  return {
    name,
    purpose: str(body.purpose),
    audience: str(body.audience),
    expectedSize: str(body.expectedSize),
    notes: str(body.notes),
    ...(imageUrl !== undefined ? { imageUrl } : {}),
    ...(joinPolicy ? { joinPolicy } : {}),
  };
}

@Controller('/network-requests')
export class NetworkRequestController {
  /** Submit a new "create a network" request. */
  @Post('')
  @UseGuards(AuthGuard)
  async create(req: Request, user: AuthenticatedUser) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const input = parseInput(body);
    if (!input) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }
    const request = await networkRequestService.createRequest(
      { id: user.id, name: user.name, email: user.email },
      input,
    );
    logger.verbose('Network request submitted', { networkId: request.id, userId: user.id });
    return Response.json({ request }, { status: 201 });
  }

  /**
   * List the caller's own requests. Also returns `canReview`, the server-computed
   * staff capability, so the web UI never has to guess staff status from the email
   * (which misses STAFF_EMAILS entries and mixed-case @index.network addresses).
   */
  @Get('')
  @UseGuards(AuthGuard)
  async listMine(_req: Request, user: AuthenticatedUser) {
    const requests = await networkRequestService.listMyRequests(user.id);
    return Response.json({ requests, canReview: isStaff(user) });
  }

  /** Staff-only: list all open requests awaiting review. */
  @Get('/pending')
  @UseGuards(AuthGuard)
  async listPending(_req: Request, user: AuthenticatedUser) {
    if (!isStaff(user)) {
      return Response.json({ error: 'Access denied' }, { status: 403 });
    }
    const requests = await networkRequestService.listPendingRequests();
    return Response.json({ requests });
  }

  /** Update and resubmit the caller's own request. */
  @Patch('/:id')
  @UseGuards(AuthGuard)
  async update(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const input = parseInput(body);
    if (!input) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }
    try {
      const request = await networkRequestService.updateRequest(params.id, user.id, input);
      return Response.json({ request });
    } catch (err) {
      return this.mapError(err);
    }
  }

  /** Dismiss (soft-delete) the caller's own request. */
  @Delete('/:id')
  @UseGuards(AuthGuard)
  async dismiss(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await networkRequestService.dismissRequest(params.id, user.id);
      return Response.json({ success: true });
    } catch (err) {
      return this.mapError(err);
    }
  }

  /** Staff-only: approve or request changes on a request. */
  @Post('/:id/review')
  @UseGuards(AuthGuard)
  async review(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    if (!isStaff(user)) {
      return Response.json({ error: 'Access denied' }, { status: 403 });
    }
    const body = (await req.json().catch(() => ({}))) as { decision?: string; reviewNote?: string };
    if (body.decision !== 'approve' && body.decision !== 'needs_changes') {
      return Response.json({ error: "decision must be 'approve' or 'needs_changes'" }, { status: 400 });
    }
    try {
      const request = await networkRequestService.reviewRequest(params.id, body.decision, body.reviewNote);
      logger.verbose('Network request reviewed', { networkId: params.id, decision: body.decision });
      return Response.json({ request });
    } catch (err) {
      return this.mapError(err);
    }
  }

  private mapError(err: unknown): Response {
    const msg = errorMessage(err);
    if (msg.includes('not found')) return Response.json({ error: msg }, { status: 404 });
    if (msg.includes('Access denied')) return Response.json({ error: msg }, { status: 403 });
    if (msg.includes('required')) return Response.json({ error: msg }, { status: 400 });
    throw err;
  }
}
