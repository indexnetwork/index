import type { IntegrationHandler, IntegrationFile } from './index';

let composio: any;
const initComposio = async () => {
  if (!composio) {
    const { Composio } = await import('@composio/core');
    composio = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY,
    });
  }
  return composio;
};

function blocksToMarkdown(blocks: any[]): string {
  let markdown = '';

  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
        const text = block.paragraph?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        markdown += `${text}\n\n`;
        break;
      case 'heading_1':
        const h1Text = block.heading_1?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        markdown += `# ${h1Text}\n\n`;
        break;
      case 'heading_2':
        const h2Text = block.heading_2?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        markdown += `## ${h2Text}\n\n`;
        break;
      case 'heading_3':
        const h3Text = block.heading_3?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        markdown += `### ${h3Text}\n\n`;
        break;
      case 'bulleted_list_item':
        const bulletText = block.bulleted_list_item?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        markdown += `- ${bulletText}\n`;
        break;
      case 'numbered_list_item':
        const numberText = block.numbered_list_item?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        markdown += `1. ${numberText}\n`;
        break;
      case 'to_do':
        const todoText = block.to_do?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        const checked = block.to_do?.checked ? '[x]' : '[ ]';
        markdown += `${checked} ${todoText}\n`;
        break;
      case 'code':
        const codeText = block.code?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        const language = block.code?.language || '';
        markdown += `\`\`\`${language}\n${codeText}\n\`\`\`\n\n`;
        break;
      case 'quote':
        const quoteText = block.quote?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        markdown += `> ${quoteText}\n\n`;
        break;
      case 'divider':
        markdown += `---\n\n`;
        break;
      default:
        const blockText = block[block.type]?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        if (blockText) {
          markdown += `${blockText}\n\n`;
        }
        break;
    }
  }

  return markdown.trim();
}

async function fetchFiles(userId: string, lastSyncAt?: Date): Promise<IntegrationFile[]> {
  try {
    console.log(`[Integration Sync] Fetching Notion files for user ${userId}. Last sync: ${lastSyncAt?.toISOString() ?? 'never'}`);
    const composio = await initComposio();

    const connectedAccounts = await composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: ['notion']
    });
    console.log(`[Integration Sync] Connected Notion accounts: ${connectedAccounts.items.length}`);

    if (!connectedAccounts || connectedAccounts.items.length === 0) {
      console.warn('No connected Notion accounts found for user');
      return [];
    }

    const connectedAccountId = connectedAccounts.items[0]?.id;
    const files: IntegrationFile[] = [];

    try {
      const response = await composio.tools.execute("NOTION_SEARCH_NOTION_PAGE", {
        userId: userId,
        connectedAccountId,
        arguments: {
          query: "",
          sort: {
            timestamp: "last_edited_time",
            direction: "descending"
          },
          page_size: 100
        }
      });

      const results = response.data?.response_data?.results;
      console.log(`[Integration Sync] Notion search returned ${Array.isArray(results) ? results.length : 0} pages`);

      if (Array.isArray(results)) {
        for (const item of results) {
          const lastModified = new Date(item.last_edited_time || new Date());
          console.log(`[Integration Sync] Processing page ${item.id} last edited ${lastModified.toISOString()}`);

          if (lastSyncAt && lastModified <= lastSyncAt) {
            console.log(`[Integration Sync] Skipping page ${item.id} - not modified since last sync`);
            continue;
          }

          try {
            const blocksResponse = await composio.tools.execute("NOTION_FETCH_BLOCK_CONTENTS", {
              userId: userId,
              connectedAccountId,
              arguments: {
                block_id: item.id,
                page_size: 100
              }
            });

            const blocks = blocksResponse.data?.block_child_data?.results || [];
            console.log(`[Integration Sync] Retrieved ${blocks.length} blocks for page ${item.id}`);

            let markdownContent = '';

            const pageTitle = item.properties?.title?.title?.[0]?.plain_text ||
              item.title?.[0]?.plain_text ||
              `Notion Page ${item.id}`;
            markdownContent += `# ${pageTitle}\n\n`;

            markdownContent += `*Created: ${new Date(item.created_time).toLocaleDateString()}*\n`;
            markdownContent += `*Last edited: ${new Date(item.last_edited_time).toLocaleDateString()}*\n\n`;
            markdownContent += `---\n\n`;

            if (blocks.length > 0) {
              markdownContent += blocksToMarkdown(blocks);
            } else {
              markdownContent += '*This page has no content blocks.*\n';
            }

            files.push({
              id: item.id || `item-${Date.now()}`,
              name: `${item.id}.md`,
              content: markdownContent,
              lastModified,
              type: 'text/markdown',
              size: markdownContent.length
            });
            console.log(`[Integration Sync] Added file ${item.id}.md (${markdownContent.length} chars)`);

          } catch (blockError) {
            console.warn(`[Integration Sync] Error fetching blocks for page ${item.id}`, blockError);
          }
        }
      }

    } catch (error) {
      console.warn('Error executing Notion action:', error);
    }
    console.log(`[Integration Sync] Total Notion files fetched: ${files.length}`);
    return files;

  } catch (error) {
    console.error('Error fetching Notion files:', error);
    return [];
  }
}

export const notionHandler: IntegrationHandler = {
  fetchFiles,
};

