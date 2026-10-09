import OpenAI from 'openai';
import { z } from 'zod';

const PARALLEL_URL = 'https://api.parallel.ai/v1';
const RESEARCH_TIMEOUT_MS = 180_000;
const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_DELAY_MS = 60_000;

const foundPersonSchema = z.object({
  name: z.string(),
  headline: z.string(),
  email: z.string(),
  socials: z.array(z.string()),
  signals: z.array(z.string()),
  sources: z.array(z.string()),
});

/** A person found on the public web who could serve a signal. */
export type FoundPerson = z.infer<typeof foundPersonSchema>;

const findPeopleSchema = {
  type: 'json_schema' as const,
  name: 'find_people',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      people: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'Full name' },
            headline: { type: 'string', description: 'One-line description: role, domain and city' },
            email: { type: 'string', description: 'Email address copied verbatim from a public page you visited' },
            socials: { type: 'array', items: { type: 'string' }, description: 'Public profile URLs you visited for this person: X, LinkedIn, GitHub, or their personal site. Copy each URL verbatim. Empty if you opened none.' },
            signals: { type: 'array', items: { type: 'string' }, description: '1-3 first-person statements of what this person is likely working on, looking for or open to, grounded in the sources' },
            sources: { type: 'array', items: { type: 'string' }, description: 'Public URLs the profile is based on, including the page that lists the email' },
          },
            required: ['name', 'headline', 'email', 'socials', 'signals', 'sources'],
        },
      },
    },
    required: ['people'],
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

  const client = new OpenAI({ apiKey, baseURL: PARALLEL_URL });
  for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      const response = await client.responses.create({
        model: 'parallel',
        reasoning: { effort: 'high' },
        instructions: `Find up to ${limit} real individuals (not companies) on the public web who would be a strong mutual fit for the signal below. Only include people whose email address is publicly listed on a page you visited (personal site, blog, GitHub profile, talk or paper page, team page). Copy the email verbatim; never guess or construct one. For each person, socials are the public profile URLs you opened (X, LinkedIn, GitHub, personal site), copied verbatim. Use only public information.`,
        input: query,
        text: { format: findPeopleSchema },
      }, { timeout: RESEARCH_TIMEOUT_MS });
      const content = response.output_text;
      const parsed = content ? z.object({ people: z.array(foundPersonSchema) }).safeParse(JSON.parse(content)) : null;
      return parsed?.success ? parsed.data.people.slice(0, limit) : [];
    } catch (error) {
      if (!isRateLimited(error) || attempt === RATE_LIMIT_MAX_RETRIES) throw error;
      await Bun.sleep(RATE_LIMIT_DELAY_MS);
    }
  }
  return [];
}
