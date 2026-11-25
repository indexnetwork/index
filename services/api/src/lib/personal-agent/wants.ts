import { createHash } from 'node:crypto';

import { createModel, type Model } from '@indexnetwork/agent';
import { generateText, jsonSchema, Output } from 'ai';

import { cacheAdapter } from '../../adapters/cache.adapter';
import { background } from '../background';
import { log } from '../log';

const logger = log.lib.from('wants');

/** Rewritten only when the intent's words change, so a long life is safe. */
const WANTS_TTL_S = 60 * 60 * 24 * 30;
const MAX_BATCH = 20;

let wantsModel: Model | null = null;
function model(): Model {
  wantsModel ??= createModel({
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: { 'HTTP-Referer': 'https://index.network/personal-agent', 'X-Title': 'Index Question Cards' },
  });
  return wantsModel;
}

const schema = jsonSchema<{ items: { i: number; wants: string }[] }>({
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer', description: 'The number of the statement.' },
          wants: { type: 'string', description: 'At most 8 words completing "looking for …".' },
        },
        required: ['i', 'wants'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
});

const PROMPT = [
  'Each numbered line is what one person said they want to find on Index, a network where agents introduce people.',
  'For each, write the words that complete "looking for …", at most 8 words.',
  'Pick the most specific and distinctive part: the named field, technology, method, event, place, stage or thinker that sets this person apart from everyone else.',
  'Never stop at a generic group ("people", "builders", "founders", "collaborators", "peers", "connections", "investors") without what makes them specific.',
  'Keep their own terms, but never "I", "my", "our" or why they want it. Lowercase except proper nouns and acronyms. No ending punctuation, no quotes.',
  '',
  'Examples:',
  '"Meet curious makers and tinkerers who are into analog synthesizers, generative music, and Max/MSP patching" → "makers into generative music and Max/MSP"',
  '"Looking to connect with investors, especially climate-focused angels who back hardware at pre-seed" → "climate angels backing pre-seed hardware"',
  '"New in Lisbon and want to meet people working on zero-knowledge proofs and privacy-preserving identity" → "zero-knowledge and private identity people in Lisbon"',
].join('\n');

const keyOf = (intentId: string, text: string) =>
  `intent-wants:v1:${intentId}:${createHash('sha1').update(text).digest('hex').slice(0, 12)}`;

/** Intents being written now, so a poll doesn't start a second call for them. */
const writing = new Set<string>();

/**
 * @param texts - What each person said they want.
 * @returns A short, distinctive "looking for …" completion per text, by index; missing where the model gave none.
 */
export async function writeWants(texts: string[], using: Model = model()): Promise<Map<number, string>> {
  const { output } = await generateText({
    model: using,
    output: Output.object({ schema }),
    prompt: `${PROMPT}\n\n${texts.map((text, i) => `${i}. ${text.replace(/\s+/g, ' ').slice(0, 600)}`).join('\n')}`,
  });
  const phrases = new Map<number, string>();
  for (const { i, wants } of output?.items ?? []) {
    const phrase = wants?.trim().replace(/^looking for\s+/i, '').replace(/[.!"]+$/, '');
    if (i >= 0 && i < texts.length && phrase && phrase.split(/\s+/).length <= 10) phrases.set(i, phrase);
  }
  return phrases;
}

async function write(batch: { intentId: string; text: string }[]): Promise<void> {
  const phrases = await writeWants(batch.map((item) => item.text));
  for (const [i, phrase] of phrases) {
    const item = batch[i]!;
    await cacheAdapter.set(keyOf(item.intentId, item.text), phrase, { ttl: WANTS_TTL_S });
  }
}

/**
 * The most distinctive part of what each person is after, short enough for a
 * card: "people into active inference and AI orchestration". Written once per
 * intent by a model, in the background, and kept until the intent's words change.
 *
 * @param statements - Each intent and its words.
 * @returns The phrases already written; the rest are being written for the next read.
 */
export async function distinctiveWants(statements: { intentId: string; text: string }[]): Promise<Map<string, string>> {
  const unique = [...new Map(statements.filter((s) => s.text.trim()).map((s) => [s.intentId, s])).values()];
  if (!unique.length) return new Map();
  const cached = await cacheAdapter.mget<string>(unique.map((s) => keyOf(s.intentId, s.text))).catch(() => unique.map(() => null));
  const found = new Map<string, string>();
  const missing: typeof unique = [];
  unique.forEach((s, i) => {
    const phrase = cached[i];
    if (phrase) found.set(s.intentId, phrase);
    else if (!writing.has(s.intentId)) missing.push(s);
  });
  if (missing.length && process.env.OPENROUTER_API_KEY) {
    const batch = missing.slice(0, MAX_BATCH);
    for (const s of batch) writing.add(s.intentId);
    background('intent-wants', async () => {
      try {
        await write(batch);
      } catch (error) {
        logger.warn('Writing wants failed', { error: error instanceof Error ? error.message : String(error) });
      } finally {
        for (const s of batch) writing.delete(s.intentId);
      }
    });
  }
  return found;
}
