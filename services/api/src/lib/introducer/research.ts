import OpenAI from 'openai';
import { z } from 'zod';

import { log } from '../log';

const logger = log.lib.from('introducer/research');

const PARALLEL_URL = 'https://api.parallel.ai/v1';
const RESEARCH_TIMEOUT_MS = 180_000;

const researchSchema = z.object({
  found: z.boolean(),
  headline: z.string(),
  socials: z.array(z.string()),
  intents: z.array(z.string()),
});

/** What the public web says about one known person. */
export type PersonResearch = z.infer<typeof researchSchema>;

const format = {
  type: 'json_schema' as const,
  name: 'research_person',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      found: { type: 'boolean', description: 'True only when you are confident the pages you read are about this exact person.' },
      headline: { type: 'string', description: 'One line: role, domain and city. Empty when not found.' },
      socials: { type: 'array', items: { type: 'string' }, description: 'Public profile URLs you opened for this person (X, LinkedIn, GitHub, personal site), copied verbatim.' },
      intents: { type: 'array', items: { type: 'string' }, description: '1-3 first-person statements of what this person is working on, looking for or open to, grounded in what you read. Empty when not found.' },
    },
    required: ['found', 'headline', 'socials', 'intents'],
  },
};

/**
 * Look one person up on the public web: someone a member knows and is about
 * to introduce. Only runs when the member wakes the introduction, never while
 * matching, so its cost grows with introductions made.
 *
 * @param person - Who to look up, as the member's contact card has them.
 * @returns What was found, or null when research is unavailable or unsure.
 */
export async function researchPerson(person: {
  name: string | null;
  email: string;
  organization: string | null;
  title: string | null;
}): Promise<PersonResearch | null> {
  const apiKey = process.env.PARALLELS_API_KEY;
  if (!apiKey) return null;
  const card = [
    person.name ? `Name: ${person.name}` : null,
    `Email: ${person.email}`,
    person.title ? `Title: ${person.title}` : null,
    person.organization ? `Organization: ${person.organization}` : null,
  ].filter(Boolean).join('\n');

  try {
    const client = new OpenAI({ apiKey, baseURL: PARALLEL_URL });
    const response = await client.responses.create({
      model: 'parallel',
      reasoning: { effort: 'low' },
      instructions: 'Find public information about the one person described below. Use the email and organization to make sure it is the same person; if you cannot tell, return found=false. Use only public information. Never guess.',
      input: card,
      text: { format },
    }, { timeout: RESEARCH_TIMEOUT_MS });
    const parsed = response.output_text ? researchSchema.safeParse(JSON.parse(response.output_text)) : null;
    if (!parsed?.success || !parsed.data.found) return null;
    return parsed.data;
  } catch (error) {
    logger.warn('Person research failed', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
