interface NetworkForRendering {
  title: string;
  prompt?: string | null;
}

/**
 * Render a network as structured markdown for LLM context.
 */
export function renderNetworkContext(network: NetworkForRendering): string {
  const lines: string[] = [`## ${network.title}`];
  if (network.prompt) {
    lines.push('', network.prompt);
  }
  return lines.join('\n');
}
