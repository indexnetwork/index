import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { log } from '../lib/log';
import { enrichmentService, type SyncEnrichmentResult } from '../services/enrichment.service';
import { Controller, Post, UseGuards } from '../lib/router/router.decorators';

const logger = log.controller.from('enrichment');

/** Synchronous enrichment surface (injectable for tests). */
interface SyncEnricher {
  enrichNow(userId: string): Promise<SyncEnrichmentResult>;
}

@Controller('/enrichment')
export class EnrichmentController {
  constructor(private syncEnricher?: SyncEnricher) {}

  /**
   * Syncs/Generates a profile for the given user.
   * This is the main entry point to trigger the enrichment graph.
   */
  @Post('/sync')
  @UseGuards(RateLimit('write'), AuthGuard)
  async sync(req: Request, user: AuthenticatedUser) {
    logger.verbose('Profile sync requested', { userId: user.id });

    const result = await enrichmentService.syncProfile(user.id);

    return Response.json(result);
  }

  /**
   * Runs the full public-research enrichment for the authenticated user inline
   * and returns the resolved identity + discovered socials.
   *
   * This is the only enrichment trigger a client needs. Every other enrichment
   * happens automatically (profile save -> `socials_updated`, experiment signup,
   * contact/integration imports), so there is no async "manual trigger" — it had
   * no consumer. Onboarding calls this synchronously to show discovered socials
   * in the profile review; the heavier premise/HyDE work still runs afterward via
   * the normal profile-save cascade.
   */
  @Post('/enrich')
  @UseGuards(RateLimit('write'), AuthGuard)
  async enrich(_req: Request, user: AuthenticatedUser) {
    logger.verbose('Synchronous enrichment requested', { userId: user.id });
    const runner = this.syncEnricher ?? enrichmentService;
    const profile = await runner.enrichNow(user.id);
    return Response.json({ enriched: true, profile });
  }
}
