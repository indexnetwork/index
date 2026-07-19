import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock, beforeEach, afterAll } from 'bun:test';
import { S3StorageAdapter } from '../storage.adapter';

// Mock S3Client.send to avoid real S3 calls
const mockSend = mock(() => Promise.resolve({}));
mock.module('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mockSend;
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

afterAll(() => {
  mock.restore();
});

function createAdapter() {
  return new S3StorageAdapter({
    endpoint: 'https://fake.endpoint',
    region: 'us-east-1',
    credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
    bucket: 'test-bucket',
  });
}

describe('S3StorageAdapter', () => {
  beforeEach(() => {
    mockSend.mockClear();
  });

  describe('uploadBuffer', () => {
    it('calls S3 and returns the object key', async () => {
      const adapter = createAdapter();
      const result = await adapter.uploadBuffer(Buffer.from('data'), 'test/file.txt', 'text/plain');
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(result).toBe('test/file.txt');
    });
  });

  describe('uploadAvatar', () => {
    it('uploads under avatars/{userId}/ path and returns key', async () => {
      const adapter = createAdapter();
      const result = await adapter.uploadAvatar(Buffer.from('img'), 'user-1', 'png', 'image/png');
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(result).toStartWith('avatars/user-1/');
      expect(result).toEndWith('.png');
    });
  });

  describe('uploadBase64Image', () => {
    it('parses data URI prefix and uploads', async () => {
      const adapter = createAdapter();
      const base64 = 'data:image/jpeg;base64,/9j/4AAQ';
      const result = await adapter.uploadBase64Image(base64, 'feedback');
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(result).toStartWith('feedback/');
      expect(result).toEndWith('.jpeg');
    });

    it('handles raw base64 without prefix', async () => {
      const adapter = createAdapter();
      const result = await adapter.uploadBase64Image('iVBOR', 'screenshots');
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(result).toStartWith('screenshots/');
      expect(result).toEndWith('.png');
    });

    it('defaults folder to feedback', async () => {
      const adapter = createAdapter();
      const result = await adapter.uploadBase64Image('iVBOR');
      expect(result).toStartWith('feedback/');
    });

    it('handles compound MIME subtypes like svg+xml', async () => {
      const adapter = createAdapter();
      const base64 = 'data:image/svg+xml;base64,PHN2Zz4=';
      const result = await adapter.uploadBase64Image(base64, 'images');
      expect(result).toStartWith('images/');
      expect(result).toEndWith('.svg');
    });
  });
});
