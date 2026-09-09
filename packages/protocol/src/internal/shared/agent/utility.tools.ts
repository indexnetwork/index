import { z } from "zod";

import { requestContext } from "../observability/request-context.js";
import { CANONICAL_GUIDANCE_SUMMARY, CANONICAL_GUIDANCE_TOPICS, CANONICAL_GUIDANCE_TOPICS_CONTENT } from "../../../protocol/protocol.prompt.js";

import type { DefineTool, ToolRegistryCompositionDeps } from "./tool.helpers.js";
import { success, error, normalizeUrl } from "./tool.helpers.js";

/** Host capabilities consumed by URL and profile utility tools. */
type UtilityToolDeps = Pick<ToolRegistryCompositionDeps, "scraper">;

export function createUtilityTools(
  defineTool: DefineTool,
  deps: UtilityToolDeps,
) {
  const { scraper } = deps;
  const scrapeUrl = defineTool({
    name: "scrape_url",
    description:
      "Extracts text content from a web URL — articles, LinkedIn/GitHub profiles, documentation, project pages, etc. " +
      "Returns the page's text content (up to 10,000 characters) for use in subsequent tool calls.\n\n" +
      "**When to use:**\n" +
      "- Before create_intent: when the user shares a URL and wants to create an intent from it. Scrape first, then synthesize into a description.\n" +
      "- When the user asks about content at a URL.\n\n" +
      "**URL format:** Bare domains work fine (e.g. 'github.com/user/repo') — protocol (https://) is added automatically.\n\n" +
      "**Returns:** `{ url, contentLength, content }`. Content is truncated at 10,000 chars. " +
      "Returns an error if the URL is unreachable, requires login, or has no extractable text.",
    querySchema: z.object({
      url: z.string().describe("The URL to extract content from. Protocol is optional — 'github.com/user/repo', 'linkedin.com/in/name', and 'https://example.com' all work."),
      objective: z.string().optional().describe("Why you're scraping — guides content extraction for better results. Examples: 'User wants to create an intent from this project page', 'User wants to update their profile from this LinkedIn page', 'Extract key information about this company'. Omit for generic text extraction."),
    }),
    handler: async ({ context: _context, query }) => {
      const normalizedUrl = normalizeUrl(query.url);
      if (!normalizedUrl) {
        return error("Invalid URL format. Please provide a valid URL (e.g. 'github.com/user/repo' or 'https://example.com').");
      }

      const content = await scraper.extractUrlContent(normalizedUrl, {
        objective: query.objective?.trim() || undefined,
        signal: requestContext.getStore()?.abortSignal,
      });

      if (!content) {
        return error("Couldn't extract content from that URL. It may be blocked, require login, or have no extractable text.");
      }

      const truncatedContent = content.length > 10000
        ? content.substring(0, 10000) + "\n\n[Content truncated...]"
        : content;

      return success({
        url: normalizedUrl,
        contentLength: content.length,
        content: truncatedContent,
      });
    },
  });

  const readDocs = defineTool({
    name: "read_docs",
    description:
      "Returns comprehensive documentation about the Index Network protocol — entity model, workflows, tool usage guidance, and domain concepts. " +
      "This is the primary way for an external agent to bootstrap understanding of the system.\n\n" +
      "**When to use:** Call this FIRST when starting a new session.\n" +
      "Also call when you need to understand identity, context, signals, communities, networks, opportunities, or negotiations.\n\n" +
      "**Returns:** Markdown documentation. Pass `topic` to get a specific section, or omit for the summary.\n\n" +
      `**Available canonical topics:** ${CANONICAL_GUIDANCE_TOPICS.join(", ")}`,
    querySchema: z.object({
      topic: z.string().optional().describe(`Narrow to a canonical topic: ${CANONICAL_GUIDANCE_TOPICS.join(", ")}. Omit to get the summary.`),
    }),
    handler: async ({ context: _context, query }) => {
      const topic = query.topic?.trim().toLowerCase();

      if (!topic) return success({ content: CANONICAL_GUIDANCE_SUMMARY });
      const normalizedTopic = topic.replace(/_/g, "-");
      const canonicalTopic = CANONICAL_GUIDANCE_TOPICS.find((candidate) => candidate === normalizedTopic);
      if (!canonicalTopic) return error(`Unknown topic "${topic}". Available topics: ${CANONICAL_GUIDANCE_TOPICS.join(", ")}.`);
      return success({ topic: canonicalTopic, content: CANONICAL_GUIDANCE_TOPICS_CONTENT[canonicalTopic] });
    },
  });

  return [scrapeUrl, readDocs];
}
