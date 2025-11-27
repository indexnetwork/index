import { getClient } from '../composio';
import { log } from '../../log';
import { getIntegrationById } from '../integration-utils';
import { ensureIndexMembership } from '../membership-utils';
import { addGenerateIntentsJob } from '../../queue/llm-queue';

const MAX_INTENTS_PER_DOCUMENT = 3;

// Integration limits to prevent API rate limiting and excessive processing
const MAX_DOCUMENTS = 100;

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
 * Initialize Google Docs integration sync.
 * Fetches documents and queues intent generation for the integration owner.
 * For index integrations: skips (directory sync handles this).
 */
export async function initGoogleDocs(
  integrationId: string,
  lastSyncAt?: Date
): Promise<{ intentsGenerated: number; usersProcessed: number; newUsersCreated: number }> {
  try {
    const integration = await getIntegrationById(integrationId);
    if (!integration) {
      log.error('Integration not found', { integrationId });
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }

    // Index integration: skip intent generation (directory sync handles this)
    if (integration.indexId) {
      log.info('Skipping intent generation for index integration', { integrationId });
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }

    if (!integration.connectedAccountId) {
      log.error('No connected account ID found for integration', { integrationId });
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
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
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }

    // Check for API not enabled errors in search response
    if (searchResponse?.error && searchResponse.error.includes('Google Docs API has not been used')) {
      log.error('🔧 Google Docs API not enabled during search');
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
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
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }


    // Retrieve connected account to extract user email for ownership validation
    const accounts = await composio.connectedAccounts.list({
      userIds: [integration.userId]
    });
    const account = accounts?.items?.find((acc: any) => acc.id === connectedAccountId);
    
    if (!account) {
      log.error('Connected account not found', { connectedAccountId, integrationId });
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
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
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
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
          owners: doc.owners // Include owners for user extraction
        });

        log.info('✅ Document processed', { documentId: doc.id, documentName: doc.name, contentLength: content.length });

      } catch (error) {
        log.error('❌ Error fetching document', { documentId: doc.id, error: (error as Error).message });
        // Continue processing other documents to maximize data collection
      }
    }

    log.info('✅ Google Docs documents fetched', { count: allDocuments.length });
    
    if (allDocuments.length === 0) {
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }
    
    // Process for integration owner
    if (integration.indexId) {
      await ensureIndexMembership(integration.userId, integration.indexId);
    }
    
    // Process each document individually
    let totalIntentsGenerated = 0;
    for (const document of allDocuments) {
      try {
        await addGenerateIntentsJob({
          userId: integration.userId,
          sourceId: integrationId,
          sourceType: 'integration',
          objects: [document],
          instruction: `Generate intents from Google Doc: "${document.name}"`,
          indexId: integration.indexId || undefined,
          intentCount: MAX_INTENTS_PER_DOCUMENT
        }, 6);
        totalIntentsGenerated++;
      } catch (error) {
        log.error('Error processing document', { documentId: document.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    
    return {
      intentsGenerated: totalIntentsGenerated,
      usersProcessed: 1,
      newUsersCreated: 0
    };

  } catch (error) {
    log.error('❌ Google Docs sync error', { error: (error as Error).message });
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }
}


// TODO: Add document categorization (meeting-notes, project-docs, research, etc.) for better intent generation
// TODO: Implement document version history tracking and change-based intent generation
// TODO: Add real-time collaboration monitoring via Google Drive webhooks
// TODO: Enhance content analysis with topics, sentiment, and key phrases extraction
// TODO: Build document relationship mapping (similar content, shared folders, collaborators)
// TODO: Implement smart intent generation strategies based on document type and collaboration level
