/**
 * Scrape command handler for the Index CLI.
 *
 * Extracts content from a URL through POST /api/scrape.
 */
import type { ApiClient } from "./api.client";
import * as output from "./output";

/**
 * Handle the scrape command — extract content from a URL.
 *
 * @param client - Authenticated API client.
 * @param positionals - Positional arguments (first is the URL).
 * @param options - Additional options (json, objective).
 */
export async function handleScrape(
  client: ApiClient,
  positionals: string[],
  options: { json?: boolean; objective?: string },
): Promise<void> {
  const url = positionals[0];
  if (!url) { output.error("Usage: index scrape <url> [--objective <text>]", 1); return; }
  if (!options.json) output.info(`Scraping ${url}...`);
  const result = await client.scrapeUrl(url, options.objective);
  if (options.json) { console.log(JSON.stringify(result)); return; }
  output.heading(`Content from ${result.url}`);
  console.log(result.content);
  output.dim(`\n  ${result.contentLength} characters extracted`);
  console.log();
}
