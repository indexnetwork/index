import OpenAI from 'openai';
import { z } from 'zod';

const PARALLEL_CHAT_URL = 'https://api.parallel.ai';
const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_DELAY_MS = 60_000;

const foundPersonSchema = z.object({
  name: z.string(),
  headline: z.string(),
  email: z.string().nullable(),
  signals: z.array(z.string()),
  sources: z.array(z.string()),
});

/** A person found on the public web who could serve a signal. */
export type FoundPerson = z.infer<typeof foundPersonSchema>;

const findPeopleSchema = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'find_people',
    schema: {
      type: 'object',
      properties: {
        people: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Full name' },
              headline: { type: 'string', description: 'Anonymous one-line description: role, domain and city. Never the name, employer name or any identifier.' },
              email: { type: ['string', 'null'], description: 'A publicly listed email address for this person, or null' },
              signals: { type: 'array', items: { type: 'string' }, maxItems: 3, description: '1-3 first-person statements of what this person is likely working on, looking for or open to, grounded in the sources' },
              sources: { type: 'array', items: { type: 'string' }, description: 'Public URLs the profile is based on' },
            },
            required: ['name', 'headline', 'email', 'signals', 'sources'],
          },
        },
      },
      required: ['people'],
    },
  },
};

/** @param error - What the call threw. @returns Whether Parallel rate limited it. */
function isRateLimited(error: unknown): boolean {
  return (error as { status?: number })?.status === 429;
}

/**
 * Find real individuals on the public web who could serve a signal.
 *
 * @param query - The signal, in its owner's words.
 * @param limit - How many people to return at most.
 * @returns The people found; empty when the response is unusable.
 */
export async function findPeople(query: string, limit: number): Promise<FoundPerson[]> {
  const apiKey = process.env.PARALLELS_API_KEY;
  if (!apiKey) throw new Error('PARALLELS_API_KEY is not defined');

  const client = new OpenAI({ apiKey, baseURL: PARALLEL_CHAT_URL });
  for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: 'speed',
        messages: [
          {
            role: 'system',
            content: `Find up to ${limit} real individuals (not companies) on the public web who would be a strong mutual fit for the signal below. Prefer people with a publicly listed email. Use only public information.`,
          },
          { role: 'user', content: query },
        ],
        response_format: findPeopleSchema,
      });
      const content = response.choices[0]?.message?.content;
      const parsed = content ? z.object({ people: z.array(foundPersonSchema) }).safeParse(JSON.parse(content)) : null;
      return parsed?.success ? parsed.data.people.slice(0, limit) : [];
    } catch (error) {
      if (!isRateLimited(error) || attempt === RATE_LIMIT_MAX_RETRIES) throw error;
      await Bun.sleep(RATE_LIMIT_DELAY_MS);
    }
  }
  return [];
}
