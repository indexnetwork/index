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
  content: Buffer;
  lastModified: Date;
  type: string;
  size: number;
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
      // Execute Notion search action
      const response = await composio.tools.execute("NOTION_SEARCH_NOTION_PAGE",{
        userId: userId,
        arguments: {
          query: "",
          sort: { 
            timestamp: "last_edited_time", 
            direction: "descending" 
          },
          page_size: 50
        }
      });
      
      
      // Parse results
      const results = response.data?.response_data?.results;
      
      console.log('response', results);
      if (Array.isArray(results)) {
        for (const item of results) {
          const lastModified = new Date(item.last_edited_time || new Date());
          
          // Skip if not modified since last sync
          if (lastSyncAt && lastModified <= lastSyncAt) continue;
          
          // Create file object
          const content = JSON.stringify(item, null, 2);
          
          files.push({
            id: item.id || `item-${Date.now()}`,
            name: item.properties?.title?.title?.[0]?.plain_text || 
                  item.title?.[0]?.plain_text || 
                  `Notion Item ${item.id}`,
            content: Buffer.from(content, 'utf-8'),
            lastModified,
            type: 'application/json',
            size: content.length
          });
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
    const fileName = `${file.id}.json`;
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
      
      // Analyze files with intent inferrer
      const result = await analyzeFolder(
        tempDir,
        fileIds,
        `Generate intents based on content from ${integrationType} integration`,
        existingIntents,
        [], // existingSuggestions
        5, // count
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

