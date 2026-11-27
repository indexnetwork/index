import OpenAI from 'openai';
import { z } from 'zod';

import { log } from '../log';

const logger = log.lib.from('introducer/research');

const PARALLEL_URL = 'https://api.parallel.ai/v1';
const RESEARCH_TIMEOUT_MS = 180_000;

const researchSchema = z.object({
  found: z.boolean(),
  name: z.string(),
  headline: z.string(),
  socials: z.array(z.string()),
});

/** What one research try came to. */
export type ResearchOutcome =
  | { kind: 'found'; name: string; headline: string; socials: string[] }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; reason: 'no_key' | 'error' };

const format = {
  type: 'json_schema' as const,
  name: 'research_person',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      found: { type: 'boolean', description: 'True only when you are confident the pages you read are about this exact person.' },
      name: { type: 'string', description: 'The person\'s full name as their own public pages give it, copied verbatim. Never a nickname or label from the hints. Empty when not found.' },
      headline: { type: 'string', description: 'One line: role, domain and city. Empty when not found.' },
      socials: { type: 'array', items: { type: 'string' }, description: 'Public profile URLs you opened for this person (X, LinkedIn, GitHub, personal site), copied verbatim.' },
    },
    required: ['found', 'name', 'headline', 'socials'],
  },
};

/**
 * Look one person up on the public web: someone an introducer knows who is
 * not on Index. Runs once per email, before the desk, for pairs that survive
 * the screen; never while matching, so its cost grows with pairs kept.
 *
 * @param person - Who to look up, as the member's contact card has them. The
 *   card is the member's own address book: only a hint for finding the right
 *   person. Nothing from it may be copied into the answer.
 * @returns The identity found, `not_found` when the web has nothing sure, or
 *   `unavailable` when research could not run (retry later).
 */
export async function researchPerson(person: {
  name: string | null;
  email: string;
  organization: string | null;
  title: string | null;
}): Promise<ResearchOutcome> {
  const apiKey = process.env.PARALLELS_API_KEY;
  if (!apiKey) return { kind: 'unavailable', reason: 'no_key' };
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
      instructions: 'Find public information about the one person described below. The details come from someone\'s private address book: use them only as hints to find the right person, and use the email and organization to make sure it is the same person; if you cannot tell, return found=false. Everything you return must come from public pages you read, never from the hints: the name as the person\'s own pages give it, not the address-book name. Never guess.',
      input: card,
      text: { format },
    }, { timeout: RESEARCH_TIMEOUT_MS });
    const parsed = response.output_text ? researchSchema.safeParse(JSON.parse(response.output_text)) : null;
    if (!parsed?.success) return { kind: 'unavailable', reason: 'error' };
    const { found, name, headline, socials } = parsed.data;
    if (!found || (!name.trim() && !headline.trim())) return { kind: 'not_found' };
    return { kind: 'found', name, headline, socials };
  } catch (error) {
    logger.warn('Person research failed', { error: error instanceof Error ? error.message : String(error) });
    return { kind: 'unavailable', reason: 'error' };
  }
}
