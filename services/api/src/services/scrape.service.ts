import { log } from '../lib/log';
import { ScraperAdapter } from '../adapters/scraper.adapter';

const logger = log.service.from('ScrapeService');

/** Longest content body a caller gets back; the rest is dropped with a marker. */
const MAX_CONTENT_CHARS = 10_000;

/**
 * ScrapeService
 *
 * Reads the text of a public web page so a caller can turn it into a signal.
 */
export class ScrapeService {
  constructor(private scraper = new ScraperAdapter()) {}

  /**
   * Extract the text content of one URL.
   *
   * A URL without a scheme is read as `https://`, so `github.com/user/repo`
   * works as written.
   *
   * @param url - The page to read.
   * @param objective - Why it is being read; steers extraction.
   * @param signal - Cancels the fetch when the HTTP request goes away.
   * @returns The normalized url and its text, or null when nothing is readable.
   */
  async extract(
    url: string,
    objective?: string,
    signal?: AbortSignal,
  ): Promise<{ url: string; contentLength: number; content: string } | null> {
    const normalized = normalizeUrl(url);
    if (!normalized) return null;

    logger.verbose('Extracting url content', { url: normalized });

    const content = await this.scraper.extractUrlContent(normalized, {
      objective: objective?.trim() || undefined,
      signal,
    });
    if (!content) return null;

    return {
      url: normalized,
      contentLength: content.length,
      content: content.length > MAX_CONTENT_CHARS
        ? `${content.substring(0, MAX_CONTENT_CHARS)}\n\n[Content truncated...]`
        : content,
    };
  }
}

/** Prepend `https://` when a scheme is missing; null when the result is not a URL. */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.replace(/[.,;:!?)]+$/, '').trim();
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    new URL(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export const scrapeService = new ScrapeService();
