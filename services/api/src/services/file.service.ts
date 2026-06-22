import path from 'path';
import { UnstructuredClient } from 'unstructured-client';
import { Strategy } from 'unstructured-client/sdk/models/shared';
import { NodeHtmlMarkdown } from 'node-html-markdown';

import { log } from '../lib/log';
import { FILE_SIZE_LIMITS, FALLBACK_TEXT_EXTENSIONS } from '../lib/uploads.config';
import { normalizeExtension } from '../lib/storage.utils';
import { fileDatabaseAdapter, type CreateFileInput } from '../adapters/database.adapter';
import { S3StorageAdapter } from '../adapters/storage.adapter';

const logger = log.service.from("FileService");

// ----- File Content Loading -----

let unstructuredClient: UnstructuredClient | null = null;

function getUnstructuredClient(): UnstructuredClient | null {
  if (!process.env.UNSTRUCTURED_API_URL) return null;
  if (!unstructuredClient) {
    unstructuredClient = new UnstructuredClient({
      serverURL: process.env.UNSTRUCTURED_API_URL
    });
  }
  return unstructuredClient;
}

async function loadFileContentFromBuffer(
  data: Buffer,
  fileName: string
): Promise<{ content: string | null; error: string | null }> {
  if (!data || data.length === 0) {
    return { content: null, error: `Empty file: ${fileName}` };
  }

  if (data.length > FILE_SIZE_LIMITS.GENERAL) {
    return {
      content: null,
      error: `File exceeds size limit (${(data.length / (1024 * 1024)).toFixed(2)}MB > ${(FILE_SIZE_LIMITS.GENERAL / (1024 * 1024)).toFixed(2)}MB)`
    };
  }

  try {
    const client = getUnstructuredClient();
    if (client) {
      const response = await client.general.partition({
        partitionParameters: {
          files: {
            content: data,
            fileName,
          },
          strategy: Strategy.Fast,
          splitPdfPage: true,
          splitPdfConcurrencyLevel: 15,
          splitPdfAllowFailed: true,
          languages: ['eng'],
        },
      });

      if (Array.isArray(response) && response.length > 0) {
        const content = response
          .map((element: { text?: string }) => element.text ?? '')
          .filter((text: string) => text.trim())
          .join('\n\n');
        return { content, error: null };
      } else if (typeof response === 'string' && response.trim()) {
        return { content: response, error: null };
      }
    }
  } catch (error) {
    logger.warn('UnstructuredClient failed, trying fallback', {
      fileName,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }

  try {
    const ext = path.extname(fileName).toLowerCase();
    if ((FALLBACK_TEXT_EXTENSIONS as readonly string[]).includes(ext) || ext === '') {
      const rawContent = data.toString('utf8');
      if (ext === '.html') {
        const markdownContent = NodeHtmlMarkdown.translate(rawContent);
        if (markdownContent.trim()) return { content: markdownContent, error: null };
      }
      if (rawContent.trim()) return { content: rawContent, error: null };
    }
    return {
      content: null,
      error: `Cannot process ${ext} files without Unstructured API. Please set UNSTRUCTURED_API_URL for document support.`
    };
  } catch (error) {
    return {
      content: null,
      error: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ----- FileService -----

/**
 * FileService
 *
 * Manages file operations including storage, retrieval, and content loading.
 * Uses FileDatabaseAdapter for database operations and S3StorageAdapter for file storage.
 *
 * RESPONSIBILITIES:
 * - File metadata CRUD operations
 * - File content loading for attached files (from S3)
 * - File listing with pagination
 * - Soft delete management
 */
export class FileService {
  private storage: S3StorageAdapter | null = null;

  constructor(private db = fileDatabaseAdapter) {}

  /**
   * Set the storage adapter for S3 operations.
   * Must be called before using loadAttachedFileContent.
   */
  setStorageAdapter(storage: S3StorageAdapter) {
    this.storage = storage;
  }

  /**
   * Get files by IDs for a specific user
   *
   * @param userId - The user ID
   * @param fileIds - Array of file IDs to retrieve
   * @returns Array of file records
   */
  async getFilesByIds(userId: string, fileIds: string[]) {
    if (!fileIds?.length) return [];

    logger.verbose('[FileService] Getting files by IDs', { userId, count: fileIds.length });

    return this.db.getFilesByIds(userId, fileIds);
  }

  /**
   * Load content from multiple files and format for chat context.
   * Downloads file content from S3 and concatenates with metadata.
   *
   * @param userId - The user ID (for S3 key resolution)
   * @param fileIds - Array of file IDs to load
   * @returns Formatted string with file contents
   */
  async loadAttachedFileContent(userId: string, fileIds: string[]): Promise<string> {
    if (!fileIds?.length) return '';
    if (!this.storage) {
      logger.error('Storage adapter not set for FileService');
      return '';
    }

    const rows = await this.getFilesByIds(userId, fileIds);
    if (rows.length === 0) return '';

    const parts: string[] = [];

    for (const row of rows) {
      const ext = normalizeExtension(path.extname(row.name));
      const key = `files/${userId}/${row.id}.${ext}`;

      try {
        const buffer = await this.storage.downloadFile(key);
        const result = await loadFileContentFromBuffer(buffer, row.name);

        if (result.content?.trim()) {
          parts.push(`=== ${row.name} ===\n${result.content.substring(0, 10000)}`);
        }
      } catch (error) {
        logger.warn('Failed to load file from S3', {
          userId,
          fileId: row.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return parts.length ? parts.join('\n\n') : '';
  }

  /**
   * Get a single file by ID
   *
   * @param fileId - The file ID
   * @param userId - The user ID (for ownership verification)
   * @returns File record or null if not found
   */
  async getById(fileId: string, userId: string) {
    logger.verbose('[FileService] Getting file by ID', { fileId, userId });

    return this.db.getById(fileId, userId);
  }

  /**
   * List files for a user with pagination
   *
   * @param userId - The user ID
   * @param options - Pagination options
   * @returns Files and pagination metadata
   */
  async listFiles(userId: string, options: { page?: number; limit?: number } = {}) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 100));
    const skip = (page - 1) * limit;

    logger.verbose('[FileService] Listing files', { userId, page, limit });

    const result = await this.db.listFiles(userId, { skip, limit });

    return {
      files: result.files,
      pagination: {
        current: page,
        total: Math.ceil(result.total / limit),
        count: result.files.length,
        totalCount: result.total,
      },
    };
  }

  /**
   * Create a new file record
   *
   * @param data - File metadata
   * @returns The created file record
   */
  async createFile(data: CreateFileInput) {
    logger.verbose('[FileService] Creating file', { id: data.id, userId: data.userId });

    return this.db.createFile(data);
  }

  /**
   * Soft delete a file
   *
   * @param fileId - The file ID
   * @param userId - The user ID (for ownership verification)
   * @returns True if deleted, false if not found or unauthorized
   */
  async softDelete(fileId: string, userId: string): Promise<boolean> {
    logger.verbose('[FileService] Soft deleting file', { fileId, userId });

    return this.db.softDelete(fileId, userId);
  }
}

export const fileService = new FileService();
