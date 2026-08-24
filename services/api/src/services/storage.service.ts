import type { StorageAdapter } from '../types/storage.types';

/**
 * Thin service wrapper around the StorageAdapter.
 * Controllers depend on this service rather than the adapter directly,
 * preserving the Controller → Service → Adapter layering contract.
 */
export class StorageService {
  constructor(private adapter: StorageAdapter) {}

  downloadFile(key: string): Promise<Buffer> {
    return this.adapter.downloadFile(key);
  }

  uploadAvatar(
    buffer: Buffer,
    userId: string,
    extension: string,
    contentType: string,
  ): Promise<string> {
    return this.adapter.uploadAvatar(buffer, userId, extension, contentType);
  }

  uploadIndexImage(
    buffer: Buffer,
    userId: string,
    extension: string,
    contentType: string,
  ): Promise<string> {
    return this.adapter.uploadIndexImage(buffer, userId, extension, contentType);
  }
}
