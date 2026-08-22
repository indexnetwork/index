/**
 * Options for URL content extraction (e.g. to tailor output for intent vs profile).
 */
export interface ExtractUrlContentOptions {
  /**
   * Optional natural-language objective describing why we're scraping.
   * Examples: "User wants to create an intent from this link (project/repo).",
   * "User wants to update their profile from this page.", or omit for generic extraction.
   */
  objective?: string;
  /** Optional cancellation signal for caller/client disconnect or runtime deadline. */
  signal?: AbortSignal;
}

/**
 * Interface for scraping web content.
 */
export interface Scraper {
  /**
   * Scrapes the content from the given URL.
   * @param url The URL to scrape.
   * @returns The scraped text content.
   */
  scrape(url: string): Promise<string>;

  /**
   * Extracts content from a URL. When `options.objective` is provided, extraction
   * may be tailored for that use (e.g. intent-focused vs profile-focused content).
   * @param url The URL to extract content from.
   * @param options Optional. Pass `objective` to get content better suited for intent creation or profile update.
   * @returns The extracted content as a string, or null if extraction failed.
   */
  extractUrlContent(url: string, options?: ExtractUrlContentOptions): Promise<string | null>;
}
