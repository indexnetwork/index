import type { StorageAdapter } from '../types/storage.types';

/**
 * Thin service wrapper around the StorageAdapter.
 * Controllers depend on this service rather than the adapter directly,
 * preserving the Controller → Service → Adapter layering contract.
 */
export class StorageService {
  constructor(private adapter: StorageAdapter) {}

  /**
   * Upload a library file.
   * @param buffer - File content
   * @param userId - Owner user ID
   * @param fileId - Unique file ID
   * @param extension - File extension (without leading dot)
   * @param contentType - MIME type
   * @returns The S3 object key
   */
  uploadFile(
    buffer: Buffer,
    userId: string,
    fileId: string,
    extension: string,
    contentType: string,
  ): Promise<string> {
    return this.adapter.uploadFile(buffer, userId, fileId, extension, contentType);
  }

  /**
   * Download a file by its S3 key.
   * @param key - The S3 object key
   * @returns File content as a Buffer
   */
  downloadFile(key: string): Promise<Buffer> {
    return this.adapter.downloadFile(key);
  }

  /**
   * Upload an avatar image.
   * @param buffer - Image content
   * @param userId - Owner user ID
   * @param extension - File extension (without leading dot)
   * @param contentType - MIME type
   * @returns The S3 object key
   */
  uploadAvatar(
    buffer: Buffer,
    userId: string,
    extension: string,
    contentType: string,
  ): Promise<string> {
    return this.adapter.uploadAvatar(buffer, userId, extension, contentType);
  }

  /**
   * Upload an index (network) image.
   * @param buffer - Image content
   * @param userId - Owner user ID
   * @param extension - File extension (without leading dot)
   * @param contentType - MIME type
   * @returns The S3 object key
   */
  uploadIndexImage(
    buffer: Buffer,
    userId: string,
    extension: string,
    contentType: string,
  ): Promise<string> {
    return this.adapter.uploadIndexImage(buffer, userId, extension, contentType);
  }
}
