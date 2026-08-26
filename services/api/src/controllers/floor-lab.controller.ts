import { z } from 'zod';

import { DebugGuard } from '../guards/debug.guard';
import { RateLimit } from '../guards/limiter.guard';
import { log } from '../lib/log';
import { Controller, Post, UseGuards } from '../lib/router/router.decorators';
import { floorLabService } from '../services/floor-lab.service';

const logger = log.controller.from('floor-lab');

const SeatSchema = z.object({
  name: z.string().default(''),
  intent: z.string().trim().min(1, 'intent is required'),
  profile: z.string().optional(),
  location: z.string().optional(),
});

const StartSchema = z.object({
  seats: z.array(SeatSchema).length(2, 'exactly two seats are required'),
}).strict();

@Controller('/dev/floor')
export class FloorLabController {
  /** Provision a fresh two-person floor scenario and return seat JWTs. */
  @Post('/runs')
  @UseGuards(RateLimit('write'), DebugGuard)
  async start(req: Request) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = StartSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
    }

    try {
      const run = await floorLabService.start(parsed.data.seats);
      return Response.json(run);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Floor lab start failed', { error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }
}
