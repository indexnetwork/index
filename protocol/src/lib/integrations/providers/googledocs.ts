import type { IntegrationHandler, UserIdentifier } from '../index';
import { getClient } from '../composio';
import { log } from '../../log';
import { getIntegrationById } from '../integration-utils';
import { ensureIndexMembership } from '../membership-utils';
import { addGenerateIntentsJob } from '../../queue/llm-queue';

// Integration limits to prevent API rate limiting and excessive processing
const MAX_DOCUMENTS = 100;
const MAX_INTENTS_PER_DOCUMENT = 3;

export interface GoogleDocsDocument {
  id: string;
  name: string;
  content: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink: string;
  size: string;
  owners?: Array<{
    emailAddress: string;
    displayName: string;
  }>;
}

interface GoogleDocsSearchResponse {
  data?: {
    documents?: Array<{
      id: string;
      name: string;
      createdTime: string;
      modifiedTime: string;
      webViewLink: string;
      size: string;
      owners: Array<{
        emailAddress: string;
        displayName: string;
      }>;
    }>;
    next_page_token?: string;
    total_found?: number;
  };
  error?: string;
  successful?: boolean;
  logId?: string;
}

interface GoogleDocsDocumentResponse {
  data?: {
    response_data?: {
      body?: {
        content?: Array<{
          paragraph?: {
            elements?: Array<{
              textRun?: {
                content: string;
              };
            }>;
            bullet?: {
              listId: string;
            };
          };
          sectionBreak?: any;
        }>;
      };
      documentId?: string;
      title?: string;
    };
  };
  response_data?: {
    body?: {
      content?: Array<{
        paragraph?: {
          elements?: Array<{
            textRun?: {
              content: string;
            };
          }>;
          bullet?: {
            listId: string;
          };
        };
        sectionBreak?: any;
      }>;
    };
    documentId?: string;
    title?: string;
  };
  error?: string;
  successful?: boolean;
  logId?: string;
}

/**
 * Extracts plain text content from Google Docs API response structure.
 * Google Docs API returns complex nested JSON with formatting metadata.
 * This function navigates the structure and extracts only the readable text.
 */
function extractContentFromDocument(responseData: any): string {

  // Handle multiple possible response structures from Composio API
  const content = responseData?.data?.response_data?.body?.content || 
                  responseData?.response_data?.body?.content ||
                  responseData?.data?.body?.content ||
                  responseData?.body?.content;
  

  if (!content) {
    log.warn('⚠️ No content found in document response');
    return '';
  }

  const contentParts: string[] = [];

  for (const element of content) {
    if (!element) continue;

    // Skip structural elements that don't contain readable content
    if (element.sectionBreak) {
      continue;
    }

    // Process paragraph elements which contain the actual text content
    if (element.paragraph?.elements) {
      const paragraphText: string[] = [];
      
      for (const textElement of element.paragraph.elements) {
        if (textElement?.textRun?.content) {
          paragraphText.push(textElement.textRun.content);
        }
      }
      
      if (paragraphText.length > 0) {
        const text = paragraphText.join('').trim();
        if (text) {
          // Preserve list formatting by adding bullet points
          if (element.paragraph.bullet) {
            contentParts.push(`• ${text}`);
          } else {
            contentParts.push(text);
          }
        }
      }
    } else {
      // Try alternative content extraction methods
      if (element.textRun?.content) {
        const text = element.textRun.content.trim();
        if (text) {
          contentParts.push(text);
        }
      }
      
      // Try to extract from nested structures
      if (element.elements) {
        for (const nestedElement of element.elements) {
          if (nestedElement?.textRun?.content) {
            const text = nestedElement.textRun.content.trim();
            if (text) {
              contentParts.push(text);
            }
          }
        }
      }
    }
  }

  return contentParts.join('\n\n');
}

/**
 * Fetches Google Docs documents owned by the connected user.
 * Only processes documents owned by the authenticated user to avoid creating
 * intents for other users' content. Supports incremental sync via lastSyncAt.
 * For user integrations: generates intents for single user.
 * For index integrations: skips (directory sync handles this).
 */
async function fetchObjects(integrationId: string, lastSyncAt?: Date): Promise<GoogleDocsDocument[]> {
  try {
    const integration = await getIntegrationById(integrationId);
    if (!integration) {
      log.error('Integration not found', { integrationId });
      return [];
    }

    // Index integration: skip intent generation (directory sync handles this)
    if (integration.indexId) {
      log.info('Skipping intent generation for index integration', { integrationId });
      return [];
    }

    if (!integration.connectedAccountId) {
      log.error('No connected account ID found for integration', { integrationId });
      return [];
    }

    log.info('Google Docs objects sync start', { integrationId, userId: integration.userId, lastSyncAt: lastSyncAt?.toISOString() });
    const composio = await getClient();
    const connectedAccountId = integration.connectedAccountId;

    // Build search parameters for Google Docs API
    const searchArgs: any = {
      max_results: MAX_DOCUMENTS,
      include_trashed: false, // Exclude deleted documents from processing
    };

    // Apply incremental sync filter only for subsequent syncs
    if (lastSyncAt) {
      searchArgs.modified_after = lastSyncAt.toISOString();
      log.info('Applying modified_after filter', { modified_after: searchArgs.modified_after });
    } else {
      log.info('🆕 First sync - fetching all documents');
    }

    log.info('🔍 Searching Google Docs', { connectedAccountId });

    // Search for documents
    let searchResponse: GoogleDocsSearchResponse;
    try {
      searchResponse = await composio.tools.execute('GOOGLEDOCS_SEARCH_DOCUMENTS', {
        userId: integration.userId,
        connectedAccountId,
        arguments: searchArgs
      }) as GoogleDocsSearchResponse;
    } catch (error) {
      log.error('Error searching Google Docs', { error, connectedAccountId, searchArgs });
      throw error;
    }

    // Check for API permission errors in search response
    if (searchResponse?.error && searchResponse.error.includes('PERMISSION_DENIED')) {
      log.error('🚫 Google Docs API permission denied during search');
      return [];
    }

    // Check for API not enabled errors in search response
    if (searchResponse?.error && searchResponse.error.includes('Google Docs API has not been used')) {
      log.error('🔧 Google Docs API not enabled during search');
      return [];
    }

    // Fallback: try alternative search if initial search returns no results
    if (!searchResponse?.data?.documents?.length) {
      log.info('🔄 No documents found, trying alternative search...');
      
      try {
        const alternativeResponse = await composio.tools.execute('GOOGLEDOCS_SEARCH_DOCUMENTS', {
          userId: integration.userId,
          connectedAccountId,
          arguments: { max_results: MAX_DOCUMENTS }
        }) as GoogleDocsSearchResponse;
        
        if (alternativeResponse?.data?.documents?.length) {
          searchResponse = alternativeResponse;
        }
      } catch (altError) {
        log.error('Alternative search failed', { altError });
      }
    }

    const documents = searchResponse?.data?.documents || [];
    log.info('📄 Google Docs search results', { count: documents.length });

    if (!documents.length) {
      log.warn('⚠️ No documents found in Google Docs search');
      return [];
    }


    // Retrieve connected account to extract user email for ownership validation
    const accounts = await composio.connectedAccounts.list({
      userIds: [integration.userId]
    });
    const account = accounts?.items?.find((acc: any) => acc.id === connectedAccountId);
    
    if (!account) {
      log.error('Connected account not found', { connectedAccountId, integrationId });
      return [];
    }

    // Extract user email from account data using multiple fallback strategies
    let userEmail = (account as any).data?.email || (account as any).email;
    
    // Fallback: extract email from JWT token if not found in account data
    if (!userEmail && (account as any).data?.id_token) {
      try {
        const idToken = (account as any).data.id_token;
        // Parse JWT payload (format: header.payload.signature)
        const payload = JSON.parse(atob(idToken.split('.')[1]));
        userEmail = payload.email;
      } catch (error) {
        log.error('Failed to parse JWT token', { error });
      }
    }
    
    if (!userEmail) {
      log.error('❌ User email not found in connected account', { connectedAccountId });
      return [];
    }

    log.info('👤 Processing documents', { userEmail, count: documents.length });

    const allDocuments: GoogleDocsDocument[] = [];

    // Process each document, filtering by ownership to ensure privacy
    for (const doc of documents) {
      if (!doc?.id) continue;

      // Only process documents owned by the connected user
      const isOwner = doc.owners?.some(owner => owner.emailAddress === userEmail);
      if (!isOwner) {
        log.info('⏭️ Skipping document - user is not owner', { documentId: doc.id, documentName: doc.name });
        continue;
      }


      // Skip documents that haven't been modified since last sync (incremental sync)
      if (lastSyncAt) {
        const modifiedTime = new Date(doc.modifiedTime);
        if (modifiedTime <= lastSyncAt) {
          continue;
        }
      }

      try {
        // Fetch full document content using Google Docs API
        const documentResponse = await composio.tools.execute('GOOGLEDOCS_GET_DOCUMENT_BY_ID', {
          userId: integration.userId,
          connectedAccountId,
          arguments: { id: doc.id }
        }) as GoogleDocsDocumentResponse;


        // Check for API permission errors
        if (documentResponse?.error && documentResponse.error.includes('PERMISSION_DENIED')) {
          log.error('🚫 Google Docs API permission denied', { documentId: doc.id, documentName: doc.name });
          continue;
        }

        // Check for API not enabled errors
        if (documentResponse?.error && documentResponse.error.includes('Google Docs API has not been used')) {
          log.error('🔧 Google Docs API not enabled', { documentId: doc.id, documentName: doc.name });
          continue;
        }

        // Extract plain text content from complex Google Docs structure
        const content = extractContentFromDocument(documentResponse);
        
        
        // Skip documents with no extractable content
        if (!content.trim()) {
          log.warn('📄 Document has no content', { documentId: doc.id, documentName: doc.name });
          continue;
        }

        allDocuments.push({
          id: doc.id,
          name: doc.name,
          content,
          createdTime: doc.createdTime,
          modifiedTime: doc.modifiedTime,
          webViewLink: doc.webViewLink,
          size: doc.size,
          owners: doc.owners // Include owners for attribution
        });

        log.info('✅ Document processed', { documentId: doc.id, documentName: doc.name, contentLength: content.length });

      } catch (error) {
        log.error('❌ Error fetching document', { documentId: doc.id, error: (error as Error).message });
        // Continue processing other documents to maximize data collection
      }
    }

    log.info('✅ Google Docs sync done', { count: allDocuments.length });
    return allDocuments;

  } catch (error) {
    log.error('❌ Google Docs sync error', { error: (error as Error).message });
    return [];
  }
}

/**
 * Processes Google Docs documents to generate intents for the connected user.
 * Unlike Slack/Discord integrations, this only creates intents for the connected user,
 * not for document collaborators, to maintain privacy and avoid creating unwanted user accounts.
 */
export async function processGoogleDocsDocuments(
  documents: GoogleDocsDocument[],
  integration: { id: string; indexId: string; userId: string }
): Promise<{ intentsGenerated: number; usersProcessed: number; newUsersCreated: number }> {
  if (!documents.length) {
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }

  log.info('⚙️ Processing documents', { count: documents.length });

  // Ensure the connected user has access to the index
  await ensureIndexMembership(integration.userId, integration.indexId);

  let totalIntentsGenerated = 0;

  // Process each document individually to generate focused intents
  for (const document of documents) {
    try {
      // Queue AI-powered intent generation for this specific document
      await addGenerateIntentsJob({
        userId: integration.userId, // Always use the connected user (not document collaborators)
        sourceId: integration.id,
        sourceType: 'integration',
        objects: [document], // Single document per job for focused analysis
        instruction: `Generate intents from Google Doc: "${document.name}"`,
        indexId: integration.indexId,
        intentCount: MAX_INTENTS_PER_DOCUMENT
      }, 6);
      
      totalIntentsGenerated++; // Count queued jobs
    } catch (error) {
      log.error('Error processing document', { documentId: document.id, error: error instanceof Error ? error.message : String(error) });
      // Continue processing remaining documents to maximize intent generation
    }
  }

  log.info('🎯 Processing complete', { intentsGenerated: totalIntentsGenerated });

  return { 
    intentsGenerated: totalIntentsGenerated, 
    usersProcessed: 1, // Always 1 - the connected user
    newUsersCreated: 0  // Always 0 - we don't create new users from document collaborators
  };
}

/**
 * Extract unique users from Google Docs documents (from owners)
 */
function extractUsers(documents: GoogleDocsDocument[]): UserIdentifier[] {
  const userMap = new Map<string, UserIdentifier>();

  for (const document of documents) {
    if (!document.owners) continue;

    for (const owner of document.owners) {
      if (!owner.emailAddress) continue;
      if (userMap.has(owner.emailAddress)) continue;

      userMap.set(owner.emailAddress, {
        id: owner.emailAddress,
        email: owner.emailAddress,
        name: owner.displayName || owner.emailAddress.split('@')[0],
        provider: 'googledocs',
        providerId: owner.emailAddress
      });
    }
  }

  return Array.from(userMap.values());
}

export const googledocsHandler: IntegrationHandler<GoogleDocsDocument> = {
  enableUserAttribution: false, // Default: process for integration owner only
  fetchObjects,
  extractUsers
};

// TODO: Add document categorization (meeting-notes, project-docs, research, etc.) for better intent generation
// TODO: Implement document version history tracking and change-based intent generation
// TODO: Add real-time collaboration monitoring via Google Drive webhooks
// TODO: Enhance content analysis with topics, sentiment, and key phrases extraction
// TODO: Build document relationship mapping (similar content, shared folders, collaborators)
// TODO: Implement smart intent generation strategies based on document type and collaboration level
