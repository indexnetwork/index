/**
 * Scraper adapter for web search and URL extraction.
 * Only imports from lib/parallel/.
 *
 * For profile URLs (especially LinkedIn, which requires login when hit directly),
 * uses Parallel's search API (searchUser) so content can be retrieved without
 * direct page fetch. For other URLs or intent/general objective, uses extract API.
 */

import { searchUser, extractUrlContent } from '../lib/parallel/parallel';
import { log } from '../lib/log';

const logger = log.lib.from('scraper.adapter');

/** Hostnames that typically require login for direct fetch; use Parallel search instead. */
const PROFILE_SEARCH_DOMAINS = ['linkedin.com', 'www.linkedin.com'];

function isProfileSearchUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PROFILE_SEARCH_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

function isProfileObjective(objective?: string): boolean {
  if (!objective?.trim()) return false;
  const o = objective.toLowerCase();
  return o.includes('profile') || o.includes('update their profile') || o.includes('update my profile');
}

/** Repeated sign-in/join boilerplate to collapse so profile-relevant text is clearer. */
const LINKEDIN_NOISE_PATTERNS = [
  /Continue with Google\s*Continue with Google/gi,
  /Sign in\s*\.\.\.\s*Section Title:/gi,
  /New to LinkedIn\? \[Join now\]\([^)]+\)/gi,
  /By clicking Continue to join or sign in, you agree to LinkedIn's [^.]+\.[^.]+\.[^.]+\./gi,
  /Email or phone\s*Password\s*Show\s*\[Forgot password\?\]/gi,
];

function reduceLinkedInNoise(text: string): string {
  let out = text;
  for (const p of LINKEDIN_NOISE_PATTERNS) {
    out = out.replace(p, ' ');
  }
  return out.replace(/\n{3,}/g, '\n\n').replace(/  +/g, ' ').trim();
}

/**
 * Format Parallel search results into a single string suitable for profile building.
 * For LinkedIn-style content, reduces repetitive sign-in boilerplate so name/company/projects stand out.
 */
function formatSearchResultsForContent(
  results: Array<{ url: string; title: string; excerpts: string[] }>,
  isLinkedIn = false
): string {
  const raw = results
    .map((r) => `Title: ${r.title}\nURL: ${r.url}\nExcerpts:\n${(r.excerpts || []).join('\n')}`)
    .join('\n\n');
  return isLinkedIn ? reduceLinkedInNoise(raw) : raw;
}

/**
 * Scraper adapter for web search and URL extraction.
 * Used for profile enrichment (e.g. Chat Graph, Profile Graph).
 */
export class ScraperAdapter {
  /**
   * Scrapes the web for information related to the given objective.
   * @param objective - The search objective/query
   * @returns Formatted search results as a string
   */
  async scrape(objective: string): Promise<string> {
    try {
      const response = await searchUser({ objective });
      const formattedResults = formatSearchResultsForContent(response.results);
      if (!formattedResults) {
        return `No information found for objective: ${objective}`;
      }
      return `Objective: ${objective}\n\nSearch Results:\n${formattedResults}`;
    } catch (error: unknown) {
      logger.error('Search failed', { objective, error: error instanceof Error ? error.message : String(error) });
      return `Objective: ${objective}\n\n(Search failed: ${error instanceof Error ? error.message : String(error)})`;
    }
  }

  /**
   * Extracts content from a URL. For profile-related objectives or login-walled
   * profile URLs (e.g. LinkedIn), uses Parallel's search API so content can be
   * retrieved. Otherwise uses the extract API.
   * @param url - The URL to extract content from
   * @param options - Optional. objective: natural-language reason (intent/profile/general).
   * @returns The extracted content as a string, or null if extraction failed
   */
  async extractUrlContent(url: string, options?: { objective?: string }): Promise<string | null> {
    const useSearch =
      isProfileSearchUrl(url) ||
      (isProfileObjective(options?.objective) && url.startsWith('http'));
    if (useSearch) {
      try {
        const objective =
          options?.objective?.trim() ||
          `Find information about the person from this profile page: ${url}`;
        const response = await searchUser({ objective: `${objective}\nURL: ${url}` });
        if (response.results?.length) {
          return formatSearchResultsForContent(response.results, true);
        }
      } catch (error) {
        logger.warn('searchUser failed for URL, falling back to extract', {
          url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return extractUrlContent(url, options);
  }
}

/**
 * Singleton instance of ScraperAdapter used throughout the protocol stack.
 */
export const scraperAdapter = new ScraperAdapter();
