import crypto from 'crypto';
import Parallel from 'parallel-web';
import OpenAI from 'openai';
import { z } from 'zod';

import { log } from '../log';
const logger = log.lib.from("lib/parallel/parallel.ts");

const PARALLEL_API_URL = 'https://api.parallel.ai/v1beta/search';
const PARALLELS_API_KEY = process.env.PARALLELS_API_KEY || '';

/** Max retries when Parallel returns 429 Too Many Requests. */
const RATE_LIMIT_MAX_RETRIES = 3;
/** Default wait (ms) when Retry-After header is missing. 60s aligns with per-minute limits. */
const RATE_LIMIT_DEFAULT_DELAY_MS = 60_000;

function getRateLimitDelayMs(response: Response): number {
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, 300_000); // cap 5 min
  }
  return RATE_LIMIT_DEFAULT_DELAY_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) return true;
  }
  const anyErr = error as { status?: number; statusCode?: number };
  return anyErr?.status === 429 || anyErr?.statusCode === 429;
}

// Initialize Parallel client
const parallelClient = new Parallel({
  apiKey: PARALLELS_API_KEY,
});

export interface ParallelSearchResponse {
  search_id: string;
  results: {
    url: string;
    title: string;
    publish_date: null;
    excerpts: Array<string>
  }[]
}

export type ParallelSearchRequest = ParallelSearchRequestString | ParallelSearchRequestStruct;

export interface ParallelSearchRequestString {
  objective: string
}

export interface ParallelSearchRequestStruct {
  name?: string;
  email?: string;
  linkedin?: string;
  twitter?: string;
  github?: string;
  telegram?: string;
  websites?: string[];
}

/**
 * Searches for a user using Parallel.ai API.
 * @param objective The specific query, e.g. 'seren sandikci, "seren@index.network"'
 */
export async function searchUser(request: ParallelSearchRequest): Promise<ParallelSearchResponse> {
  const apiKey = process.env.PARALLELS_API_KEY;
  if (!apiKey) {
    throw new Error('PARALLELS_API_KEY is not defined');
  }

  let objective: string = '';
  if ('objective' in request) {
    objective = request.objective;
  } else {
    const name = request.name?.trim() || '';
    const email = request.email?.trim() || '';
    const isSingleName = name && !name.includes('@') && name.split(/\s+/).filter(Boolean).length < 2;

    if (isSingleName && email) {
      // Single name (e.g. "seren") — email is more identifying than the name alone
      objective = `Find information about the person with email "${email}" (name: ${name}).`;
    } else if (name) {
      objective = `Find information about the person named ${name}.`;
      if (email) objective += `\nEmail: ${email}`;
    } else if (email) {
      objective = `Find information about the person with email "${email}".`;
    } else {
      objective = 'Find information about this person.';
    }
    if (request.linkedin) objective += `\nLinkedIn: ${request.linkedin}`;
    if (request.twitter) objective += `\nTwitter: ${request.twitter}`;
    if (request.github) objective += `\nGitHub: ${request.github}`;
    if (request.websites?.length) objective += `\nWebsites: ${request.websites.join(', ')}`;
  }

  const requestBody = {
    mode: 'one-shot',
    search_queries: null,
    max_results: 20,
    objective,
  };
  logger.info('Parallel Search request', { url: PARALLEL_API_URL, body: requestBody });

  for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    const response = await fetch(PARALLEL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'parallel-beta': 'search-extract-2025-10-10'
      },
      body: JSON.stringify(requestBody)
    });

    if (response.status === 429) {
      if (attempt === RATE_LIMIT_MAX_RETRIES) {
        const errorText = await response.text();
        throw new Error(`Parallel Search API rate limited (429) after ${RATE_LIMIT_MAX_RETRIES} retries - ${errorText}`);
      }
      const delayMs = getRateLimitDelayMs(response);
      logger.warn('Parallel Search rate limited (429), retrying after delay', {
        attempt,
        maxRetries: RATE_LIMIT_MAX_RETRIES,
        delayMs,
      });
      await sleep(delayMs);
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Parallel Search API failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return await response.json() as ParallelSearchResponse;
  }

  throw new Error('Parallel Search API failed after retries');
}

/**
 * Options for URL content extraction (objective-aware scraping).
 */
export interface ExtractUrlContentOptions {
  /**
   * Optional natural-language objective (e.g. "create an intent from this project/repo",
   * "update my profile from this page"). When provided, the extract API may tailor content.
   */
  objective?: string;
}

/**
 * Extracts content from a URL using Parallel.ai API.
 * @param url The URL to extract content from
 * @param options Optional. Pass objective to get content tailored for intent or profile use.
 * @returns The extracted content as a string, or null if extraction failed
 */
export async function extractUrlContent(url: string, options?: ExtractUrlContentOptions): Promise<string | null> {
  if (!PARALLELS_API_KEY) {
    throw new Error('PARALLELS_API_KEY not configured');
  }

  const objective = options?.objective?.trim() || 'all';

  try {
    logger.verbose('Extracting URL content', { url, hasObjective: !!options?.objective });

    for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
      try {
        const extract = await parallelClient.beta.extract({
          urls: [url],
          excerpts: true,
          full_content: true,
          objective,
          fetch_policy: {
            disable_cache_fallback: false,
            max_age_seconds: 5184000, // 60 days
            timeout_seconds: 30,
          },
        });

        logger.verbose('Parallel extract response received', { url, resultsCount: extract.results?.length || 0 });

        if (extract.results && extract.results.length > 0) {
          const result = extract.results[0] as unknown as Record<string, unknown>;
          // Access content from result - check common property names
          const excerpts = result.excerpts as string[] | undefined;
          const content = (result.content as string) || excerpts?.[0] || (result.excerpt as string) || (result.markdown as string) || null;
          logger.verbose('Extracted content', { url, contentLength: content?.length || 0, resultKeys: Object.keys(result) });
          return content;
        }

        logger.warn('No results in extract response', { url, extract });
        return null;
      } catch (extractError) {
        if (isRateLimitError(extractError) && attempt < RATE_LIMIT_MAX_RETRIES) {
          const delayMs = RATE_LIMIT_DEFAULT_DELAY_MS;
          logger.warn('Parallel Extract rate limited, retrying after delay', {
            url,
            attempt,
            maxRetries: RATE_LIMIT_MAX_RETRIES,
            delayMs,
          });
          await sleep(delayMs);
          continue;
        }
        throw extractError;
      }
    }
    return null;
  } catch (error) {
    const errorDetails = error instanceof Error ? {
      message: error.message,
      name: error.name,
      stack: error.stack,
    } : { error };
    logger.error('Failed to extract URL content', { url, error: errorDetails });
    return null;
  }
}

/**
 * Represents a file produced by crawling or extracting an external source.
 */
export interface IntegrationFile {
  id: string;
  name: string;
  content: string;
  lastModified: Date;
  type: string;
  size: number;
  sourceId?: string;
  metadata?: unknown;
}

type CrawlResult = {
  files: IntegrationFile[];
  urlMap: Record<string, { url: string; contentHash: string; lastModified: Date }>;
  pagesVisited: number;
};

function sha1(s: string | Buffer) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function sanitizeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\n\r\t]/g, '-').slice(0, 120);
}

/**
 * Crawls a list of URLs and returns their content as markdown files.
 * @param urls - The URLs to crawl and extract content from.
 * @returns A {@link CrawlResult} containing extracted files, a URL-to-hash map, and the number of pages visited.
 */
export async function crawlLinksForIndex(urls: string[]): Promise<CrawlResult> {
  const now = new Date();
  const files: IntegrationFile[] = [];
  const urlMap: Record<string, { url: string; contentHash: string; lastModified: Date }> = {};

  const contentPromises = urls.map(async (url) => {
    try {
      const content = await extractUrlContent(url);
      return { url, content };
    } catch (error) {
      logger.warn('Failed to extract URL content', { url, error: (error as Error).message });
      return { url, content: null };
    }
  });

  const results = await Promise.all(contentPromises);

  for (const { url, content } of results) {
    if (!url || !content || content.length < 10) {
      logger.warn('Skipping result: URL or content missing', { url, contentLength: content?.length || 0 });
      continue;
    }

    try {
      const id = sha1(url);
      const parsed = new URL(url);
      const name = sanitizeName(parsed.hostname + parsed.pathname) || id;
      files.push({
        id,
        name: `${name}.md`,
        content,
        lastModified: now,
        type: 'text/markdown',
        size: content.length,
      });
      urlMap[id] = { url, contentHash: sha1(content), lastModified: now };
    } catch (e) {
      logger.warn('Extract result skipped', { url, error: (e as Error).message });
    }
  }

  return { files, urlMap, pagesVisited: files.length };
}

// Export the parallel client for direct access if needed
export { parallelClient };

// ─────────────────────────────────────────────────────────────────────────────
// Chat API for Profile Enrichment
// ─────────────────────────────────────────────────────────────────────────────

const PARALLEL_CHAT_URL = 'https://api.parallel.ai';

/** Zod schema for validating Parallel Chat API enrichment responses. */
const enrichmentResultSchema = z.object({
  identity: z.object({
    name: z.string(),
    bio: z.string(),
    location: z.string(),
  }),
  narrative: z.object({
    context: z.string(),
  }),
  attributes: z.object({
    skills: z.array(z.string()),
    interests: z.array(z.string()),
  }),
  socials: z.object({
    linkedin: z.string().optional(),
    twitter: z.string().optional(),
    github: z.string().optional(),
    websites: z.array(z.string()).optional(),
  }),
  confidentMatch: z.boolean(),
  isHuman: z.boolean(),
});

/** Structured profile enrichment result from Parallel Chat API. */
export type ParallelEnrichmentResult = z.infer<typeof enrichmentResultSchema>;

/** JSON schema for profile enrichment response format. */
const profileEnrichmentSchema = {
  type: "json_schema" as const,
  json_schema: {
    name: "profile_enrichment",
    schema: {
      type: "object",
      properties: {
        identity: {
          type: "object",
          properties: {
            name: { type: "string", description: "The person's full name" },
            bio: {
              type: "string",
              description:
                "Professional summary (2-3 sentences): role, domain, and trajectory only. Never include email addresses, phone numbers, mailing/physical addresses, government IDs, or other contact identifiers — even if they appear in sources.",
            },
            location: { type: "string", description: "City, Country or 'Remote' if unknown" },
          },
          required: ["name", "bio", "location"],
        },
        narrative: {
          type: "object",
          properties: {
            context: {
              type: "string",
              description:
                "Rich narrative: background and current focus in natural language. Do not include email addresses, phone numbers, mailing/physical addresses, government IDs, or other contact identifiers.",
            },
          },
          required: ["context"],
        },
        attributes: {
          type: "object",
          properties: {
            skills: { type: "array", items: { type: "string" }, description: "Professional skills" },
            interests: { type: "array", items: { type: "string" }, description: "Inferred or explicit interests" },
          },
          required: ["skills", "interests"],
        },
        socials: {
          type: "object",
          properties: {
            linkedin: { type: "string", description: "LinkedIn username only (the part after /in/ in the URL). NOT the full URL." },
            twitter: { type: "string", description: "Twitter/X username only (without @ symbol). NOT the full URL, NOT tweet URLs." },
            github: { type: "string", description: "GitHub username only. NOT the full URL." },
            websites: { type: "array", items: { type: "string" }, maxItems: 2, description: "At most 2 personal websites OWNED/CONTROLLED by this person (personal site, portfolio, blog they run). Pick the most confident/representative ones. Exclude any third-party sites that merely mention them (news, company pages, aggregators, profiles on other platforms)." },
          },
        },
        confidentMatch: {
          type: "boolean",
          description: "true when public sources clearly identify this person and the profile data is reliable; false when the person could not be found or data is too thin/ambiguous.",
        },
        isHuman: {
          type: "boolean",
          description: "true when this is an individual person; false when this is a company, team, service account, mailing list, bot, or automated sender.",
        },
      },
      required: ["identity", "narrative", "attributes", "socials", "confidentMatch", "isHuman"],
    },
  },
};

/**
 * Extracts a username/handle from a value that may be a URL or already a handle.
 * Falls back to returning the cleaned value if URL parsing fails.
 */
export function extractHandle(value: string, platform: 'x' | 'linkedin' | 'github'): string | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;

  // Already a handle (no URL characters)
  if (!normalized.includes('/') && !normalized.includes('.')) {
    return normalized.replace(/^@/, '');
  }

  // Extract from URL (prepend scheme if missing so new URL() doesn't throw)
  try {
    const candidate = /^[a-z]+:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
    const path = new URL(candidate).pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (platform === 'linkedin') {
      return path[0] === 'in' ? path[1] || undefined : undefined;
    }
    return path[0] || undefined;
  } catch {
    return normalized.replace(/^@/, '');
  }
}

/**
 * Enriches a user profile using Parallel Chat API.
 * Returns structured profile data including identity, narrative, attributes, and social links.
 * @param request - User identifiers (name, email, social URLs)
 * @returns Structured profile enrichment result, or null if enrichment failed
 * @throws {Error} If `PARALLELS_API_KEY` is not defined.
 * @throws {Error} If the chat request fails with a non-retryable error.
 */
export async function enrichUserProfile(request: ParallelSearchRequestStruct): Promise<ParallelEnrichmentResult | null> {
  const apiKey = process.env.PARALLELS_API_KEY;
  if (!apiKey) {
    throw new Error('PARALLELS_API_KEY is not defined');
  }

  const name = request.name?.trim() || '';
  const email = request.email?.trim() || '';
  const hasSocialIdentifiers = !!(
    request.twitter ||
    request.linkedin ||
    request.github ||
    request.websites?.length
  );

  if (!name && !email && !hasSocialIdentifiers) {
    logger.warn('enrichUserProfile called without usable identifiers, skipping');
    return null;
  }

  // Build the prompt for profile enrichment
  const promptParts: string[] = [];
  if (name) promptParts.push(`Find information about the person named ${name}.`);
  else if (email) promptParts.push(`Find information about the person with email "${email}".`);
  else promptParts.push('Find information about this person.');

  if (name && email) promptParts.push(`Email: ${email}`);
  if (request.twitter) promptParts.push(`Twitter: ${request.twitter}`);
  if (request.linkedin) promptParts.push(`LinkedIn: ${request.linkedin}`);
  if (request.github) promptParts.push(`GitHub: ${request.github}`);
  if (request.websites?.length) promptParts.push(`Websites: ${request.websites.join(', ')}`);

  const userMessage = promptParts.join('\n');

  logger.info('Parallel Chat API enrichment request', {
    hasName: !!name,
    hasEmail: !!email,
    hasTwitter: !!request.twitter,
    hasLinkedin: !!request.linkedin,
    hasGithub: !!request.github,
    websitesCount: request.websites?.length ?? 0,
  });

  const client = new OpenAI({
    apiKey,
    baseURL: PARALLEL_CHAT_URL,
  });

  for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: 'speed',
        messages: [
          {
            role: 'system',
            content: [
              'You are an expert profiler. Your task is to research and synthesize a structured User Profile from public information about a person.',
              'Extract their professional background, skills, interests, and social links. Be thorough but concise.',
              '',
              'CONFIDENCE: Set confidentMatch to true only when you can clearly identify the person from public sources and the profile data is reliable.',
              'Set it to false when the person cannot be found, the match is ambiguous, or data is too thin to produce a meaningful profile.',
              '',
              'IS_HUMAN: Set isHuman to true if this is an individual person. Set it to false if this is a company, team, service account, mailing list, bot, or automated sender.',
              '',
              'PRIVACY: Never include email addresses, phone numbers, physical addresses, or government IDs in bio or narrative fields.',
              'Social links belong in the socials fields only.',
            ].join('\n'),
          },
          { role: 'user', content: userMessage },
        ],
        response_format: profileEnrichmentSchema,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        logger.warn('Parallel Chat API returned empty content', { hasName: !!name, hasEmail: !!email });
        return null;
      }

      const parsed = JSON.parse(content);
      const validation = enrichmentResultSchema.safeParse(parsed);
      if (!validation.success) {
        logger.warn('Parallel Chat API returned invalid profile structure', {
          hasName: !!name, hasEmail: !!email, errors: validation.error.issues,
        });
        return null;
      }
      const result = validation.data;

      // Normalize socials to handles (in case LLM returned URLs)
      if (result.socials.twitter) {
        result.socials.twitter = extractHandle(result.socials.twitter, 'x');
      }
      if (result.socials.linkedin) {
        result.socials.linkedin = extractHandle(result.socials.linkedin, 'linkedin');
      }
      if (result.socials.github) {
        result.socials.github = extractHandle(result.socials.github, 'github');
      }
      if (result.socials.websites && result.socials.websites.length > 2) {
        result.socials.websites = result.socials.websites.slice(0, 2);
      }

      logger.info('Parallel Chat API enrichment completed', {
        skillsCount: result.attributes.skills.length,
        interestsCount: result.attributes.interests.length,
        hasSocials: !!(result.socials.linkedin || result.socials.twitter || result.socials.github),
      });

      return result;
    } catch (err) {
      if (isRateLimitError(err) && attempt < RATE_LIMIT_MAX_RETRIES) {
        const delayMs = RATE_LIMIT_DEFAULT_DELAY_MS;
        logger.warn('Parallel Chat API rate limited, retrying after delay', {
          attempt,
          maxRetries: RATE_LIMIT_MAX_RETRIES,
          delayMs,
        });
        await sleep(delayMs);
        continue;
      }
      logger.error('Parallel Chat API enrichment failed', {
        hasName: !!name,
        hasEmail: !!email,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  return null;
}
