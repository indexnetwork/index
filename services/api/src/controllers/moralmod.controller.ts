import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { log } from '../lib/log';
import { Controller, Get, Put } from '../lib/router/router.decorators';
import { moralmodConfig } from '../lib/moralmod/config';
import { upsertArms } from '../lib/moralmod/arms';
import { outcomeExport } from '../lib/moralmod/outcomes';

const logger = log.controller.from('moralmod');

const armsSchema = z.object({
  assignments: z.array(z.object({
    userId: z.string().min(1),
    arm: z.enum(['on', 'off', 'shadow']),
    experimentId: z.string().min(1),
  })).max(10_000),
});

/** Constant-time bearer comparison against the configured cp token. */
function authorized(req: Request): boolean {
  const token = moralmodConfig().cpToken;
  if (!token) return false;
  const presented = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * MoralMod control-plane integration. The lab cp is the arm's source of
 * truth and pushes assignments here; the research side pulls outcomes keyed
 * by opportunity id. Both carry the cp bearer; without MORALMOD_CP_TOKEN the
 * routes answer 404 as if absent.
 */
@Controller('/integrations/moralmod')
export class MoralmodController {
  @Put('/arms')
  async putArms(req: Request) {
    if (!moralmodConfig().cpToken) return Response.json({ error: 'Not found' }, { status: 404 });
    if (!authorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = armsSchema.safeParse(raw);
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid assignments' }, { status: 400 });
    const { updated, unknownUserIds } = await upsertArms(parsed.data.assignments);
    logger.info('MoralMod arms updated', { updated, unknown: unknownUserIds.length });
    return Response.json({ updated, unknownUserIds });
  }

  @Get('/outcomes')
  async getOutcomes(req: Request) {
    if (!moralmodConfig().cpToken) return Response.json({ error: 'Not found' }, { status: 404 });
    if (!authorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const url = new URL(req.url);
    const experimentId = url.searchParams.get('experimentId');
    if (!experimentId) return Response.json({ error: 'experimentId is required' }, { status: 400 });
    const sinceRaw = url.searchParams.get('since');
    const since = sinceRaw ? new Date(sinceRaw) : undefined;
    if (since && Number.isNaN(since.getTime())) return Response.json({ error: 'since must be an ISO date' }, { status: 400 });
    const rows = await outcomeExport(experimentId, since);
    return Response.json({
      experimentId,
      rows,
      note: 'outcome "declined" is never written by current protocol: a decline ends a round, not the negotiation. Terminal outcomes are agreed/closed; null is still in talks.',
    });
  }
}
