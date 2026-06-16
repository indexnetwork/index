const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Convert mention markup to markdown links for rendering with ReactMarkdown.
 * Converts @[Name](userId) to [@Name](/u/userId)
 */
export function mentionsToMarkdownLinks(text: string): string {
  return text.replace(MENTION_REGEX, '[@$1](/u/$2)');
}
