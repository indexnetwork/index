import { z } from 'zod';

import { AuthGuard } from '../guards/auth.guard';
import { Controller, Post, UseGuards } from '../lib/router/router.decorators';
import { scrapeService } from '../services/scrape.service';

const ScrapeSchema = z.object({
  url: z.string().trim().min(1, 'url is required'),
  objective: z.string().trim().max(1_000).optional(),
}).strict();

@Controller('/scrape')
export class ScrapeController {
  /**
   * Read the text of one public web page.
   *
   * @param req - Request with body `{ url: string; objective?: string }`.
   * @returns The normalized url and its extracted text.
   */
  @Post('')
  @UseGuards(AuthGuard)
  async scrape(req: Request) {
    const raw = await req.json().catch(() => ({}));
    const parsed = ScrapeSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await scrapeService.extract(parsed.data.url, parsed.data.objective, req.signal);
    if (!result) {
      return Response.json(
        { error: 'Nothing readable at that URL. It may be blocked, require login, or have no text.' },
        { status: 422 },
      );
    }

    return Response.json(result);
  }
}
