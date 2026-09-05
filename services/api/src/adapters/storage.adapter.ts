import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

import { normalizeExtension } from '../lib/storage.utils';

interface S3StorageConfig {
  endpoint?: string;
  region?: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  bucket: string;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/vnd.microsoft.icon': 'ico',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

function mimeToExtension(contentType: string): string {
  return MIME_EXTENSIONS[contentType] ?? contentType.split('/')[1] ?? 'png';
}

/**
 * S3-compatible storage adapter.
 * Structurally aligns with the protocol Storage interface.
 */
export class S3StorageAdapter {
  private client: S3Client;
  private bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region || 'auto',
      credentials: config.credentials,
      forcePathStyle: false,
    });
  }

  /**
   * Generate a presigned URL for reading a file.
   * @param key - The S3 object key
   * @param expiresIn - URL expiration in seconds (default: 3600)
   * @returns Presigned URL for the object
   */
  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Upload a buffer to S3.
   * @returns The S3 object key (relative path)
   */
  async uploadBuffer(buffer: Buffer, key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });
    await this.client.send(command);
    return key;
  }

  /**
   * Upload an avatar image to S3.
   * @returns The S3 object key (e.g., avatars/userId/uuid.ext)
   */
  async uploadAvatar(
    buffer: Buffer,
    userId: string,
    extension: string,
    contentType: string,
  ): Promise<string> {
    const key = `avatars/${userId}/${uuidv4()}.${extension}`;
    return this.uploadBuffer(buffer, key, contentType);
  }

  /**
   * Upload a network image to S3.
   * @returns The S3 object key (e.g., index-images/userId/uuid.ext)
   */
  async uploadNetworkImage(
    buffer: Buffer,
    userId: string,
    extension: string,
    contentType: string,
  ): Promise<string> {
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    const safeExtension = normalizeExtension(extension);
    if (!safeExtension) {
      throw new Error('Invalid file extension');
    }
    const key = `index-images/${safeUserId}/${uuidv4()}.${safeExtension}`;
    return this.uploadBuffer(buffer, key, contentType);
  }

  /**
   * Upload a base64-encoded image to S3.
   * @returns The S3 object key (e.g., feedback/uuid.ext)
   */
  async uploadBase64Image(base64Image: string, folder: string = 'feedback'): Promise<string> {
    const matches = base64Image.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    let buffer: Buffer;
    let contentType = 'image/png';

    if (matches && matches.length === 3) {
      contentType = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(base64Image, 'base64');
    }

    const extension = mimeToExtension(contentType);
    const key = `${folder}/${uuidv4()}.${extension}`;
    return this.uploadBuffer(buffer, key, contentType);
  }

  /**
   * Download a file from S3.
   * @param key - The S3 object key
   * @returns The file content as a Buffer
   */
  async downloadFile(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const response = await this.client.send(command);
    return Buffer.from(await response.Body!.transformToByteArray());
  }
}
