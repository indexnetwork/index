import { Controller, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { TRANSLATION_TARGETS, translationService, type TranslationTarget } from '../services/translation.service';
import { log } from '../lib/log';

const logger = log.controller.from('translate');

const MAX_TEXTS = 50;
const MAX_TOTAL_CHARS = 20_000;

/**
 * Translates agent-written text for display. Stored records and agent prompts stay
 * in English; only what the viewer reads changes.
 */
@Controller('/translate')
export class TranslateController {
  /**
   * POST /translate — body `{ texts: string[], target: "zh-CN" }`.
   * Returns `{ translations: string[] }` in the same order.
   */
  @Post('')
  @UseGuards(AuthGuard)
  async translate(req: Request, viewer: AuthenticatedUser) {
    let body: { texts?: unknown; target?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { texts, target } = body;
    if (typeof target !== 'string' || !(target in TRANSLATION_TARGETS)) {
      return Response.json({ error: `target must be one of: ${Object.keys(TRANSLATION_TARGETS).join(', ')}` }, { status: 400 });
    }
    if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) {
      return Response.json({ error: 'texts must be an array of strings' }, { status: 400 });
    }
    if (texts.length > MAX_TEXTS) {
      return Response.json({ error: `At most ${MAX_TEXTS} texts per request` }, { status: 400 });
    }
    const total = (texts as string[]).reduce((sum, text) => sum + text.length, 0);
    if (total > MAX_TOTAL_CHARS) {
      return Response.json({ error: `At most ${MAX_TOTAL_CHARS} characters per request` }, { status: 413 });
    }

    try {
      const translations = await translationService.translate(texts as string[], target as TranslationTarget, viewer.id);
      return Response.json({ translations });
    } catch (err) {
      logger.error('translate failed', { userId: viewer.id, error: err instanceof Error ? err.message : String(err) });
      return Response.json({ error: 'Translation failed' }, { status: 500 });
    }
  }
}
