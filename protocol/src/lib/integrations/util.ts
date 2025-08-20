import { z } from 'zod';
import type { IntegrationFile } from './index';

export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  retryOn?: (err: unknown) => boolean;
};

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    retries = 3,
    baseDelayMs = 500,
    maxDelayMs = 8000,
    jitter = true,
    retryOn = defaultRetryOn,
  } = opts;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !retryOn(err)) throw err;
      const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const sleep = jitter ? Math.random() * delay : delay;
      attempt += 1;
      await new Promise((r) => setTimeout(r, sleep));
    }
  }
}

function defaultRetryOn(err: unknown) {
  const msg = (err as any)?.message || '';
  return (
    (err as any)?.status === 429 ||
    msg.includes('rate') ||
    msg.includes('Rate') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT')
  );
}

export async function* paginate<TArgs, TResp>(
  executor: (args: TArgs) => Promise<TResp>,
  initialArgs: TArgs,
  getCursor: (resp: TResp) => string | undefined,
  setCursor: (args: TArgs, cursor?: string) => TArgs,
  options?: RetryOptions
): AsyncGenerator<TResp, void, unknown> {
  let cursor: string | undefined = undefined;
  let args = initialArgs;
  do {
    const resp = await withRetry(() => executor(args), options);
    yield resp;
    cursor = getCursor(resp);
    args = setCursor(args, cursor);
  } while (cursor);
}

export function concurrencyLimit(n: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };
  return async function <T>(task: () => Promise<T>): Promise<T> {
    if (active >= n) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      const res = await task();
      return res;
    } finally {
      next();
    }
  };
}

// Zod schemas for minimal fields we use
export const SlackChannel = z.object({ id: z.string(), name: z.string().optional() });
export const SlackChannelsResponse = z.object({
  data: z.object({
    channels: z.array(SlackChannel).default([]),
    response_metadata: z.object({ next_cursor: z.string().optional() }).partial().optional(),
  }),
});

export const SlackMessage = z.object({ ts: z.string(), user: z.string().optional(), username: z.string().optional(), text: z.string().optional() });
export const SlackHistoryResponse = z.object({
  data: z.object({ messages: z.array(SlackMessage).default([]) }).partial().passthrough(),
});

export const NotionSearchItem = z.object({ id: z.string(), created_time: z.string().or(z.date()), last_edited_time: z.string().or(z.date()), properties: z.any().optional(), title: z.any().optional() });
export const NotionSearchResponse = z.object({
  data: z.object({ response_data: z.object({ results: z.array(NotionSearchItem).default([]) }).partial() }).partial(),
});

export const NotionBlocksResponse = z.object({
  data: z.object({ block_child_data: z.object({ results: z.array(z.any()).default([]) }).partial() }).partial(),
});

// Formatting helpers
export function mapSlackMessageToFile(channelId: string, channelName: string, message: z.infer<typeof SlackMessage>): IntegrationFile {
  const tsMillis = parseFloat(message.ts) * 1000;
  const lastModified = new Date(Number.isFinite(tsMillis) ? tsMillis : Date.now());
  const sender = message.user || message.username || 'unknown';
  const text = message.text || '';
  const content = `# ${channelName}\n\n**From:** ${sender}\n\n**Sent:** ${lastModified.toISOString()}\n\n${text}`;
  return {
    id: `${channelId}-${message.ts}`,
    name: `${channelName}-${message.ts}.md`,
    content,
    lastModified,
    type: 'text/markdown',
    size: content.length,
  };
}

export function blocksToMarkdown(blocks: any[]): string {
  let markdown = '';
  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph': {
        const text = block.paragraph?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        markdown += `${text}\n\n`; break;
      }
      case 'heading_1': {
        const h1Text = block.heading_1?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        markdown += `# ${h1Text}\n\n`; break;
      }
      case 'heading_2': {
        const h2Text = block.heading_2?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        markdown += `## ${h2Text}\n\n`; break;
      }
      case 'heading_3': {
        const h3Text = block.heading_3?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        markdown += `### ${h3Text}\n\n`; break;
      }
      case 'bulleted_list_item': {
        const bulletText = block.bulleted_list_item?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        markdown += `- ${bulletText}\n`; break;
      }
      case 'numbered_list_item': {
        const numberText = block.numbered_list_item?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        markdown += `1. ${numberText}\n`; break;
      }
      case 'to_do': {
        const todoText = block.to_do?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        const checked = block.to_do?.checked ? '[x]' : '[ ]';
        markdown += `${checked} ${todoText}\n`; break;
      }
      case 'code': {
        const codeText = block.code?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        const language = block.code?.language || '';
        markdown += `\`\`\`${language}\n${codeText}\n\`\`\`\n\n`; break;
      }
      case 'quote': {
        const quoteText = block.quote?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        markdown += `> ${quoteText}\n\n`; break;
      }
      case 'divider':
        markdown += `---\n\n`; break;
      default: {
        const blockText = block[block.type]?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        if (blockText) markdown += `${blockText}\n\n`;
      }
    }
  }
  return markdown.trim();
}

export function mapNotionToFile(item: z.infer<typeof NotionSearchItem>, blocks: any[]): IntegrationFile {
  const lastModified = new Date(item.last_edited_time as any);
  const title = (item as any).properties?.title?.title?.[0]?.plain_text || (item as any).title?.[0]?.plain_text || `Notion Page ${item.id}`;
  let content = `# ${title}\n\n`;
  const created = new Date(item.created_time as any);
  content += `*Created: ${created.toISOString()}*\n`;
  content += `*Last edited: ${lastModified.toISOString()}*\n\n`;
  content += `---\n\n`;
  content += blocks.length ? blocksToMarkdown(blocks) : '*This page has no content blocks.*\n';
  return {
    id: item.id,
    name: `${item.id}.md`,
    content,
    lastModified,
    type: 'text/markdown',
    size: content.length,
  };
}
