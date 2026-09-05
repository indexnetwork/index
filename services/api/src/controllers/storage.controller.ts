import busboy from 'busboy';
import path from 'path';
import { Readable } from 'stream';

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { StorageService } from '../services/storage.service';
import { validateFileByMetadata, FILE_SIZE_LIMITS } from '../lib/uploads.config';
import { log } from '../lib/log';

const logger = log.controller.from('storage');

type ParsedFile = { filename: string; mimeType: string; buffer: Buffer };

function parseMultipartFile(
  req: Request,
  fieldName = 'file',
  sizeLimit = FILE_SIZE_LIMITS.AVATAR
): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      reject(new Error('Invalid multipart body'));
      return;
    }

    let resolved = false;
    const finish = (err?: Error, result?: ParsedFile) => {
      if (resolved) return;
      resolved = true;
      if (err) reject(err);
      else if (result) resolve(result);
      else reject(new Error('No file uploaded'));
    };

    const bb = busboy({
      headers: { 'content-type': contentType },
      limits: { fileSize: sizeLimit, files: 1 },
    });

    bb.on('file', (name, stream, info) => {
      if (name !== fieldName) {
        stream.resume();
        return;
      }
      const { filename, mimeType } = info;
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => finish(new Error('File size limit exceeded')));
      stream.on('end', () => {
        if (stream.truncated) {
          finish(new Error('File size limit exceeded'));
          return;
        }
        finish(undefined, {
          filename: filename || 'unknown',
          mimeType: mimeType || 'application/octet-stream',
          buffer: Buffer.concat(chunks),
        });
      });
      stream.on('error', (err: unknown) =>
        finish(err instanceof Error ? err : new Error(String(err)))
      );
    });

    bb.on('error', (err: unknown) =>
      finish(err instanceof Error ? err : new Error(String(err)))
    );
    bb.on('close', () => {
      if (!resolved) finish(new Error('No file uploaded'));
    });

    if (!req.body) {
      finish(new Error('No request body'));
      return;
    }
    const nodeStream = Readable.fromWeb(req.body as import('stream/web').ReadableStream);
    nodeStream.pipe(bb);
  });
}

/**
 * Storage controller for avatar and network image uploads.
 */
@Controller('/storage')
export class StorageController {
  constructor(private storage: StorageService) {}

  /**
   * Upload an avatar image to S3.
   * POST /api/storage/avatars
   */
  @Post('/avatars')
  @UseGuards(RateLimit('write'), AuthGuard)
  async uploadAvatar(req: Request, user: AuthenticatedUser): Promise<Response | object> {
    let parsed: ParsedFile;
    try {
      parsed = await parseMultipartFile(req, 'avatar', FILE_SIZE_LIMITS.AVATAR);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid multipart body';
      return Response.json({ error: message }, { status: 400 });
    }

    const { filename, mimeType, buffer } = parsed;

    const validation = validateFileByMetadata(filename, mimeType, buffer.length, 'avatar');
    if (!validation.isValid) {
      return Response.json(
        { error: validation.message || 'File validation failed' },
        { status: 400 }
      );
    }

    try {
      const ext = path.extname(filename).replace('.', '');
      const avatarUrl = await this.storage.uploadAvatar(buffer, user.id, ext, mimeType);

      logger.info('Avatar uploaded', { userId: user.id, avatarUrl });

      return { message: 'Avatar uploaded successfully', avatarUrl };
    } catch (err) {
      logger.error('Avatar upload failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return Response.json({ error: 'Failed to upload avatar' }, { status: 500 });
    }
  }

  /**
   * Serve avatar (public, streams from S3).
   * GET /api/storage/avatars/:userId/:filename
   */
  @Get('/avatars/:userId/:filename')
  @UseGuards(RateLimit('read'))
  async serveAvatar(
    _req: Request,
    _user: unknown,
    params: { userId: string; filename: string }
  ): Promise<Response> {
    const key = `avatars/${params.userId}/${params.filename}`;
    return this.servePublicFile(key);
  }

  /**
   * Upload a network image to S3.
   * POST /api/storage/network-images
   */
  @Post('/network-images')
  @UseGuards(RateLimit('write'), AuthGuard)
  async uploadNetworkImage(req: Request, user: AuthenticatedUser): Promise<Response | object> {
    let parsed: ParsedFile;
    try {
      parsed = await parseMultipartFile(req, 'image', FILE_SIZE_LIMITS.AVATAR);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid multipart body';
      return Response.json({ error: message }, { status: 400 });
    }

    const { filename, mimeType, buffer } = parsed;

    const validation = validateFileByMetadata(filename, mimeType, buffer.length, 'avatar');
    if (!validation.isValid) {
      return Response.json(
        { error: validation.message || 'File validation failed' },
        { status: 400 }
      );
    }

    try {
      const ext = path.extname(filename).replace('.', '');
      const imageUrl = await this.storage.uploadNetworkImage(buffer, user.id, ext, mimeType);

      logger.info('Network image uploaded', { userId: user.id, imageUrl });

      return { message: 'Network image uploaded successfully', imageUrl };
    } catch (err) {
      logger.error('Network image upload failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return Response.json({ error: 'Failed to upload network image' }, { status: 500 });
    }
  }

  /**
   * Serve network image (public, streams from S3).
   * GET /api/storage/network-images/:userId/:filename
   */
  @Get('/network-images/:userId/:filename')
  @UseGuards(RateLimit('read'))
  async serveNetworkImage(
    _req: Request,
    _user: unknown,
    params: { userId: string; filename: string }
  ): Promise<Response> {
    const key = `network-images/${params.userId}/${params.filename}`;
    return this.servePublicFile(key);
  }

  private async servePublicFile(key: string): Promise<Response> {
    try {
      const buffer = await this.storage.downloadFile(key);
      const ext = path.extname(key).toLowerCase();
      const contentType = this.getContentType(ext);

      logger.verbose('Streaming public file', { key, contentType });

      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(buffer.length),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch (error: unknown) {
      logger.error('Failed to serve public file', { key, error: error instanceof Error ? error.message : String(error) });
      return new Response('Not Found', { status: 404 });
    }
  }

  private getContentType(ext: string): string {
    const types: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.bmp': 'image/bmp',
    };
    return types[ext] || 'application/octet-stream';
  }
}
