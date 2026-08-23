import { z } from 'zod';

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { log } from '../lib/log';
import { enrichmentService } from '../services/enrichment.service';
import { Controller, Post, UseGuards } from '../lib/router/router.decorators';

const logger = log.controller.from('enrichment');

const enrichBodySchema = z.object({
  name: z.string().optional(),
  linkedin: z.string().optional(),
  twitter: z.string().optional(),
  github: z.string().optional(),
  telegram: z.string().optional(),
  websites: z.array(z.string()).optional(),
}).strict();

@Controller('/enrichment')
export class EnrichmentController {
  @Post('/enrich')
  @UseGuards(RateLimit('write'), AuthGuard)
  async enrich(req: Request, user: AuthenticatedUser) {
    const parsed = enrichBodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ error: 'Invalid enrich payload' }, { status: 400 });
    }

    logger.verbose('Profile prefill requested', { userId: user.id });
    const result = await enrichmentService.prefillPublicProfile(user.id, parsed.data);
    return Response.json(result);
  }
}
