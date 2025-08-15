import fs from 'fs';
import path from 'path';
import db from './db';
import { userIntegrations, intents, intentIndexes, files } from './schema';
import { eq, and, isNull, gte, desc } from 'drizzle-orm';
import { analyzeFolder } from '../agents/core/intent_inferrer';

// Initialize Composio SDK
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


interface SyncResult {
  success: boolean;
  filesImported: number;
  intentsGenerated: number;
  error?: string;
}

interface IntegrationFile {
  id: string;
  name: string;
  content: string;
  lastModified: Date;
  type: string;
  size: number;
}

// Convert Notion blocks to markdown
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
        // For other block types, try to extract text content
        const blockText = block[block.type]?.rich_text?.map((t: any) => t.plain_text).join('') || '';
        if (blockText) {
          markdown += `${blockText}\n\n`;
        }
        break;
    }
  }

  return markdown.trim();
}

async function fetchNotionFiles(userId: string, lastSyncAt?: Date): Promise<IntegrationFile[]> {
  try {
    console.log(`[Integration Sync] Fetching Notion files for user ${userId}. Last sync: ${lastSyncAt?.toISOString() ?? 'never'}`);
    const composio = await initComposio();

    // Get connected accounts for this user and Notion toolkit
    const connectedAccounts = await composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: ['notion']
    });
    console.log(`[Integration Sync] Connected Notion accounts: ${connectedAccounts?.length ?? 0}`);

    if (!connectedAccounts || connectedAccounts.length === 0) {
      console.warn('No connected Notion accounts found for user');
      return [];
    }

    const connectedAccountId = connectedAccounts[0]?.id;
    const files: IntegrationFile[] = [];

    try {
      // Execute Notion search action to get pages
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

      // Parse results
      const results = response.data?.response_data?.results;
      console.log(`[Integration Sync] Notion search returned ${Array.isArray(results) ? results.length : 0} pages`);

      if (Array.isArray(results)) {
        for (const item of results) {
          const lastModified = new Date(item.last_edited_time || new Date());
          console.log(`[Integration Sync] Processing page ${item.id} last edited ${lastModified.toISOString()}`);

          // Skip if not modified since last sync
          if (lastSyncAt && lastModified <= lastSyncAt) {
            console.log(`[Integration Sync] Skipping page ${item.id} - not modified since last sync`);
            continue;
          }

          try {
            // Fetch child blocks for each page
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

            // Convert blocks to markdown
            let markdownContent = '';

            // Add page title as main heading
            const pageTitle = item.properties?.title?.title?.[0]?.plain_text ||
              item.title?.[0]?.plain_text ||
              `Notion Page ${item.id}`;
            markdownContent += `# ${pageTitle}\n\n`;

            // Add page metadata
            markdownContent += `*Created: ${new Date(item.created_time).toLocaleDateString()}*\n`;
            markdownContent += `*Last edited: ${new Date(item.last_edited_time).toLocaleDateString()}*\n\n`;
            markdownContent += `---\n\n`;

            // Convert blocks to markdown
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

// Save files to temp directory
async function saveFilesToTemp(files: IntegrationFile[], userId: string): Promise<{ tempDir: string; fileIds: string[] }> {
  const tempDir = path.join(process.cwd(), 'temp-uploads', `sync-${userId}-${Date.now()}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  console.log(`[Integration Sync] Saving ${files.length} files to temp directory ${tempDir}`);

  const fileIds: string[] = [];

  for (const file of files) {
    const fileName = `${file.id}.md`;
    const filePath = path.join(tempDir, fileName);

    await fs.promises.writeFile(filePath, file.content);
    console.log(`[Integration Sync] Wrote file ${filePath} (${file.content.length} chars)`);
    fileIds.push(file.id);
  }

  console.log(`[Integration Sync] Saved files with ids: ${fileIds.join(', ')}`);
  return { tempDir, fileIds };
}

// Get existing intents to avoid duplicates
async function getExistingIntents(userId: string, indexId?: string): Promise<string[]> {
  console.log(`[Integration Sync] Fetching existing intents for user ${userId}${indexId ? ` and index ${indexId}` : ''}`);
  let existingIntents;

  if (indexId) {
    // Query intents for specific index
    existingIntents = await db.select({ payload: intents.payload })
      .from(intents)
      .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
      .where(and(
        eq(intents.userId, userId),
        eq(intentIndexes.indexId, indexId),
        isNull(intents.archivedAt)
      ));
  } else {
    // Query all user intents
    existingIntents = await db.select({ payload: intents.payload })
      .from(intents)
      .where(and(
        eq(intents.userId, userId),
        isNull(intents.archivedAt)
      ));
  }

  const payloads = existingIntents.map(intent => intent.payload);
  console.log(`[Integration Sync] Found ${payloads.length} existing intents`);
  return payloads;
}

// Sync integration files and generate intents
export async function syncIntegration(
  userId: string,
  integrationType: string,
  indexId?: string
): Promise<SyncResult> {
  try {
    console.log(`[Integration Sync] Starting sync for user ${userId}, integration ${integrationType}${indexId ? `, index ${indexId}` : ''}`);

    // Get integration record
    const integration = await db.select()
      .from(userIntegrations)
      .where(and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.integrationType, integrationType),
        eq(userIntegrations.status, 'connected'),
        isNull(userIntegrations.deletedAt)
      ))
      .limit(1);

    if (integration.length === 0) {
      console.warn(`[Integration Sync] No active ${integrationType} integration found for user ${userId}`);
      return { success: false, filesImported: 0, intentsGenerated: 0, error: 'Integration not connected' };
    }

    const { lastSyncAt } = integration[0];
    console.log(`[Integration Sync] Last sync timestamp: ${lastSyncAt?.toISOString() ?? 'never'}`);

    // Fetch files based on integration type
    let files: IntegrationFile[] = [];

    switch (integrationType) {
      case 'notion':
        files = await fetchNotionFiles(userId, lastSyncAt || undefined);
        break;
      default:
        return { success: false, filesImported: 0, intentsGenerated: 0, error: 'Unsupported integration type' };
    }

    console.log(`[Integration Sync] Retrieved ${files.length} file(s) from ${integrationType}`);

    if (files.length === 0) {
      // Update sync timestamp even if no new files
      await db.update(userIntegrations)
        .set({ lastSyncAt: new Date() })
        .where(eq(userIntegrations.id, integration[0].id));

      console.log(`Sync completed for ${integrationType}: No new files found`);
      return { success: true, filesImported: 0, intentsGenerated: 0 };
    }

    // Save files to temp directory
    const { tempDir, fileIds } = await saveFilesToTemp(files, userId);
    console.log(`[Integration Sync] Files saved to temp directory ${tempDir}. IDs: ${fileIds.join(', ')}`);

    try {
      // Get existing intents for deduplication
      const existingIntents = await getExistingIntents(userId, indexId);
      console.log(`[Integration Sync] Existing intents count: ${existingIntents.length}`);
      // Analyze files with intent inferrer
      const result = await analyzeFolder(
        tempDir,
        fileIds,
        `Generate intents based on content from ${integrationType} integration`,
        existingIntents,
        [], // existingSuggestions
        30, // count
        60000 // timeout
      );

      console.log(`[Integration Sync] analyzeFolder result: success=${result.success}, intents=${result.intents?.length || 0}`);

      let intentsGenerated = 0;

      if (result.success && result.intents.length > 0) {
        // Create intents in database
        for (const intentData of result.intents) {
          console.log('[Integration Sync] Creating intent with payload:', intentData.payload);
          const newIntent = await db.insert(intents).values({
            payload: intentData.payload,
            userId,
            isIncognito: false
          }).returning();

          // Associate with index if provided
          if (indexId && newIntent.length > 0) {
            await db.insert(intentIndexes).values({
              intentId: newIntent[0].id,
              indexId
            });
          }

          intentsGenerated++;
        }
      }

      // Update sync timestamp
      await db.update(userIntegrations)
        .set({ lastSyncAt: new Date() })
        .where(eq(userIntegrations.id, integration[0].id));

      console.log(`[Integration Sync] Sync successful. Generated ${intentsGenerated} intents from ${files.length} files`);

      return {
        success: true,
        filesImported: files.length,
        intentsGenerated,
      };

    } finally {
      // Cleanup temp files
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      console.log(`[Integration Sync] Cleaned up temp directory ${tempDir}`);
    }

  } catch (error) {
    console.error('Sync integration error:', error);
    return {
      success: false,
      filesImported: 0,
      intentsGenerated: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
