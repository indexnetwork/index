import { CANONICAL_GUIDANCE_SUMMARY, CANONICAL_GUIDANCE_TOPICS, CANONICAL_GUIDANCE_TOPICS_CONTENT } from '@indexnetwork/protocol';

import { AuthGuard } from '../guards/auth.guard';
import { Controller, Get, UseGuards } from '../lib/router/router.decorators';

@Controller('/docs')
export class DocsController {
  /**
   * Serve the protocol's canonical guidance as markdown.
   *
   * @param req - Request with an optional `topic` query parameter.
   * @returns The requested topic, or the summary and the topic list.
   */
  @Get('')
  @UseGuards(AuthGuard)
  async read(req: Request) {
    const requested = new URL(req.url).searchParams.get('topic')?.trim().toLowerCase();
    if (!requested) {
      return Response.json({ topics: CANONICAL_GUIDANCE_TOPICS, content: CANONICAL_GUIDANCE_SUMMARY });
    }

    const normalized = requested.replace(/_/g, '-');
    const topic = CANONICAL_GUIDANCE_TOPICS.find((candidate) => candidate === normalized);
    if (!topic) {
      return Response.json(
        { error: `Unknown topic "${requested}"`, topics: CANONICAL_GUIDANCE_TOPICS },
        { status: 404 },
      );
    }

    return Response.json({ topic, content: CANONICAL_GUIDANCE_TOPICS_CONTENT[topic] });
  }
}
