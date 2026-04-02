import busboy from 'busboy';
import path from 'path';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { Controller, Delete, Get, Post, UseGuards } from '../lib/router/router.decorators';
// TODO: fix layering violation — controller should not import adapters directly
// eslint-disable-next-line boundaries/dependencies
import { S3StorageAdapter } from '../adapters/storage.adapter';
import { fileService } from '../services/file.service';
import { validateFileByMetadata, FILE_SIZE_LIMITS } from '../lib/uploads.config';
import { normalizeExtension } from '../lib/storage.utils';
import { log } from '../lib/log';
import type { FileRecord } from '../types';

const logger = log.controller.from('storage');

const PRESIGNED_URL_EXPIRATION = parseInt(
  process.env.PRESIGNED_URL_EXPIRATION_SECONDS || '3600',
  10
);

type ParsedFile = { filename: string; mimeType: string; buffer: Buffer };

function parseMultipartFile(
  req: Request,
  fieldName = 'file',
  sizeLimit = FILE_SIZE_LIMITS.GENERAL
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
 * Unified storage controller handling all file operations.
 * - Library files: private, requires auth, streams content
 * - Avatars/index-images: public via presigned URL redirects
 */
@Controller('/storage')
export class StorageController {
  constructor(private storage: S3StorageAdapter) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Library Files (Private, Auth Required)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Upload a library file to S3.
   * POST /api/storage/files
   */
  @Post('/files')
  @UseGuards(AuthGuard)
  async uploadFile(req: Request, user: AuthenticatedUser): Promise<Response | object> {
    let parsed: ParsedFile;
    try {
      parsed = await parseMultipartFile(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid multipart body';
      return Response.json({ error: message }, { status: 400 });
    }

    const { filename, mimeType, buffer } = parsed;
    const size = buffer.length;

    const validation = validateFileByMetadata(filename, mimeType, size, 'general');
    if (!validation.isValid) {
      return Response.json(
        { error: validation.message || 'File validation failed' },
        { status: 400 }
      );
    }

    const fileId = uuidv4();
    const ext = path.extname(filename).replace(/^\./, '');

    try {
      const key = await this.storage.uploadFile(buffer, user.id, fileId, ext, mimeType);

      const inserted = await fileService.createFile({
        id: fileId,
        name: filename,
        size: BigInt(size),
        type: mimeType,
        userId: user.id,
      });

      const fileRecord: FileRecord = {
        id: inserted.id,
        name: inserted.name,
        size: inserted.size.toString(),
        type: inserted.type,
        createdAt: inserted.createdAt.toISOString(),
        url: key,
      };

      logger.info('File uploaded', { userId: user.id, fileId, name: filename, size });

      return { message: 'File uploaded successfully', file: fileRecord };
    } catch (err) {
      logger.error('File upload failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return Response.json({ error: 'Failed to upload file' }, { status: 500 });
    }
  }

  /**
   * List library files for the authenticated user.
   * GET /api/storage/files
   */
  @Get('/files')
  @UseGuards(AuthGuard)
  async listFiles(req: Request, user: AuthenticatedUser): Promise<object> {
    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)));

    const result = await fileService.listFiles(user.id, { page, limit });

    const files: FileRecord[] = result.files.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size.toString(),
      type: f.type,
      createdAt: f.createdAt.toISOString(),
      url: `files/${user.id}/${f.id}.${normalizeExtension(path.extname(f.name))}`,
    }));

    return { files, pagination: result.pagination };
  }

  /**
   * Download a library file (streams content from S3).
   * GET /api/storage/files/:id
   */
  @Get('/files/:id')
  @UseGuards(AuthGuard)
  async downloadFile(
    _req: Request,
    user: AuthenticatedUser,
    params: { id: string }
  ): Promise<Response> {
    const file = await fileService.getById(params.id, user.id);
    if (!file) {
      return Response.json({ error: 'File not found' }, { status: 404 });
    }

    const ext = normalizeExtension(path.extname(file.name));
    const key = `files/${user.id}/${file.id}.${ext}`;

    try {
      const buffer = await this.storage.downloadFile(key);
      const safeName = file.name.replace(/["\\\r\n]/g, '_');
      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': file.type,
          'Content-Length': String(buffer.length),
          'Content-Disposition': `attachment; filename="${safeName}"`,
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch (err) {
      logger.error('File download failed', {
        userId: user.id,
        fileId: params.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return Response.json({ error: 'Failed to download file' }, { status: 500 });
    }
  }

  /**
   * Soft-delete a library file.
   * DELETE /api/storage/files/:id
   */
  @Delete('/files/:id')
  @UseGuards(AuthGuard)
  async deleteFile(
    _req: Request,
    user: AuthenticatedUser,
    params: { id: string }
  ): Promise<Response> {
    const deleted = await fileService.softDelete(params.id, user.id);
    if (!deleted) {
      return Response.json({ error: 'File not found' }, { status: 404 });
    }
    return Response.json({ success: true });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Avatars (Upload: Auth, Serve: Public via Presigned)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Upload an avatar image to S3.
   * POST /api/storage/avatars
   */
  @Post('/avatars')
  @UseGuards(AuthGuard)
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
  async serveAvatar(
    _req: Request,
    _user: unknown,
    params: { userId: string; filename: string }
  ): Promise<Response> {
    const key = `avatars/${params.userId}/${params.filename}`;
    return this.servePublicFile(key);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Index Images (Upload: Auth, Serve: Public via Presigned)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Upload an index/network image to S3.
   * POST /api/storage/index-images
   */
  @Post('/index-images')
  @UseGuards(AuthGuard)
  async uploadIndexImage(req: Request, user: AuthenticatedUser): Promise<Response | object> {
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
      const imageUrl = await this.storage.uploadIndexImage(buffer, user.id, ext, mimeType);

      logger.info('Index image uploaded', { userId: user.id, imageUrl });

      return { message: 'Index image uploaded successfully', imageUrl };
    } catch (err) {
      logger.error('Index image upload failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return Response.json({ error: 'Failed to upload index image' }, { status: 500 });
    }
  }

  /**
   * Serve index image (public, streams from S3).
   * GET /api/storage/index-images/:userId/:filename
   */
  @Get('/index-images/:userId/:filename')
  async serveIndexImage(
    _req: Request,
    _user: unknown,
    params: { userId: string; filename: string }
  ): Promise<Response> {
    const key = `index-images/${params.userId}/${params.filename}`;
    return this.servePublicFile(key);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

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
    } catch (error: any) {
      logger.error('Failed to serve public file', { key, error: error.message });
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
