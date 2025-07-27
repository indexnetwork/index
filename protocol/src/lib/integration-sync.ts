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
    const composio = await initComposio();
    
    // Get connected accounts for this user and Notion toolkit
    const connectedAccounts = await composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: ['notion']
    });
    
    if (!connectedAccounts || connectedAccounts.length === 0) {
      console.warn('No connected Notion accounts found for user');
      return [];
    }
    
    const files: IntegrationFile[] = [];
    
    try {
      // Execute Notion search action to get pages
      const response = await composio.tools.execute("NOTION_SEARCH_NOTION_PAGE", {
        userId: userId,
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
      
      if (Array.isArray(results)) {
        for (const item of results) {
          const lastModified = new Date(item.last_edited_time || new Date());
          
          // Skip if not modified since last sync
          if (lastSyncAt && lastModified <= lastSyncAt) continue;
          
          try {
            // Fetch child blocks for each page
            const blocksResponse = await composio.tools.execute("NOTION_FETCH_NOTION_CHILD_BLOCK", {
              userId: userId,
              arguments: {
                block_id: item.id,
                page_size: 100
              }
            });
            
            const blocks = blocksResponse.data?.block_child_data?.results || [];
            
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
            
            
          } catch (blockError) {
            
          }
        }
      }
      
    } catch (error) {
      console.warn('Error executing Notion action:', error);
    }
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
  
  const fileIds: string[] = [];
  
  for (const file of files) {
    const fileName = `${file.id}.md`;
    const filePath = path.join(tempDir, fileName);
    
    await fs.promises.writeFile(filePath, file.content);
    fileIds.push(file.id);
  }
  
  return { tempDir, fileIds };
}

// Get existing intents to avoid duplicates
async function getExistingIntents(userId: string, indexId?: string): Promise<string[]> {
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
  
  return existingIntents.map(intent => intent.payload);
}

// Sync integration files and generate intents
export async function syncIntegration(
  userId: string, 
  integrationType: string,
  indexId?: string
): Promise<SyncResult> {
  try {
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
      return { success: false, filesImported: 0, intentsGenerated: 0, error: 'Integration not connected' };
    }
    
    const { lastSyncAt } = integration[0];
    
    // Fetch files based on integration type
    let files: IntegrationFile[] = [];
    
    switch (integrationType) {
      case 'notion':
        files = await fetchNotionFiles(userId, lastSyncAt || undefined);
        break;
      default:
        return { success: false, filesImported: 0, intentsGenerated: 0, error: 'Unsupported integration type' };
    }
    
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
    
    try {
      // Get existing intents for deduplication
      const existingIntents = await getExistingIntents(userId, indexId);
      console.log('existingIntents', existingIntents);
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
      
      let intentsGenerated = 0;
      
      if (result.success && result.intents.length > 0) {
        // Create intents in database
        for (const intentData of result.intents) {
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
      
      return {
        success: true,
        filesImported: files.length,
        intentsGenerated,
      };
      
    } finally {
      // Cleanup temp files
      await fs.promises.rm(tempDir, { recursive: true, force: true });
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

