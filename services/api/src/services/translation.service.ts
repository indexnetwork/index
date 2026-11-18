import { createHash } from 'node:crypto';

import { createModel, type Model } from '@indexnetwork/agent';
import { generateText } from 'ai';

import { cacheAdapter } from '../adapters/cache.adapter';
import { log } from '../lib/log';

const logger = log.service.from('translation');

/** Languages the web app can show agent-written text in. English needs no call. */
export const TRANSLATION_TARGETS = { 'zh-CN': 'Simplified Chinese (Mandarin, as used in mainland China)' } as const;
export type TranslationTarget = keyof typeof TRANSLATION_TARGETS;

/** Product terms, matched to the words the interface uses in that language. */
const GLOSSARY: Record<TranslationTarget, string> = {
  'zh-CN': 'agent → 智能体, personal agent → 个人智能体, intent → 意向, opportunity → 机会, match → 匹配, negotiation → 协商, network → 网络, brief → 简报, intro/introduction (a person introducing two people) → 引荐',
};

/** Stored text never changes once written, so a translation stays good for a long time. */
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_OUTPUT_TOKENS = 8192;

let model: Model | null = null;
function translationModel(): Model {
  model ??= createModel({
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: { 'HTTP-Referer': 'https://index.network/translate', 'X-Title': 'Index Translate' },
  });
  return model;
}

function cacheKey(target: TranslationTarget, text: string): string {
  return `translate:${target}:${createHash('sha256').update(text).digest('hex')}`;
}

function instructions(target: TranslationTarget): string {
  return [
    `Translate each string in the JSON array you are given into ${TRANSLATION_TARGETS[target]}.`,
    'Return only a JSON array of strings: the same length and the same order as the input, with no commentary and no code fence.',
    'Keep Markdown, line breaks, URLs, @handles, email addresses, code and numbers exactly as they are.',
    "Keep people's names, company names and product names as written; do not transliterate them.",
    'A string that is already in the target language, or has nothing to translate, comes back unchanged.',
    'The strings are messages written by AI agents that introduce people to each other. Keep their tone: plain, warm and brief.',
    `Use these terms: ${GLOSSARY[target]}.`,
  ].join('\n');
}

function parseArray(raw: string, expected: number): string[] | null {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed) || parsed.length !== expected) return null;
    return parsed.map((item) => (typeof item === 'string' ? item : String(item ?? '')));
  } catch {
    return null;
  }
}

/**
 * Translates display text for a viewer, without touching what is stored.
 * Each string is cached by its content, so the same agent message is translated once
 * however many people or pages show it.
 */
export class TranslationService {
  /**
   * @param texts - Strings to translate, in display order.
   * @param target - The viewer's language.
   * @param userId - The viewer, for usage attribution.
   * @returns One translation per input string, in the same order. A string the model
   *   could not translate comes back as the original.
   */
  async translate(texts: string[], target: TranslationTarget, userId: string): Promise<string[]> {
    const out: (string | null)[] = texts.map((text) => (text.trim() ? null : text));
    const pendingIdx = out.flatMap((value, i) => (value === null ? [i] : []));
    if (!pendingIdx.length) return out as string[];

    const keys = pendingIdx.map((i) => cacheKey(target, texts[i]!));
    let cached: (string | null)[] = [];
    try {
      cached = await cacheAdapter.mget<string>(keys);
    } catch (err) {
      logger.warn('translation cache read failed', { error: err instanceof Error ? err.message : String(err) });
    }
    const missIdx: number[] = [];
    pendingIdx.forEach((i, j) => {
      const hit = cached[j];
      if (typeof hit === 'string') out[i] = hit;
      else missIdx.push(i);
    });
    if (!missIdx.length) return out as string[];

    // One call per distinct string: the same text repeated on a page costs one translation.
    const distinct = [...new Set(missIdx.map((i) => texts[i]!))];
    let translated: string[] | null = null;
    try {
      const result = await generateText({
        model: translationModel(),
        instructions: instructions(target),
        messages: [{ role: 'user', content: JSON.stringify(distinct) }],
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        providerOptions: {
          openrouter: {
            user: userId,
            trace: { trace_name: 'translate', generation_name: target },
            metadata: { service: 'translate', operation: 'translate' },
          },
        },
        maxRetries: 1,
      });
      translated = parseArray(result.text, distinct.length);
      if (!translated) logger.warn('translation output did not parse', { target, count: distinct.length });
    } catch (err) {
      logger.error('translation call failed', { target, count: distinct.length, error: err instanceof Error ? err.message : String(err) });
    }

    const byText = new Map<string, string>();
    distinct.forEach((text, k) => byText.set(text, translated?.[k] ?? text));
    for (const i of missIdx) out[i] = byText.get(texts[i]!) ?? texts[i]!;

    if (translated) {
      await Promise.all(distinct.map((text, k) => cacheAdapter
        .set(cacheKey(target, text), translated![k], { ttl: CACHE_TTL_SECONDS })
        .catch((err: unknown) => logger.warn('translation cache write failed', { error: err instanceof Error ? err.message : String(err) }))));
    }
    return out as string[];
  }
}

export const translationService = new TranslationService();
