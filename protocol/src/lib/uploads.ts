/**
 * Backend Uploads Implementation
 *
 * Thin adapters for Multer File types that delegate to shared validation logic.
 * Also includes backend-specific multer filters and Unstructured processing.
 */

import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { UnstructuredClient } from 'unstructured-client';
import { Strategy } from 'unstructured-client/sdk/models/shared';
import { getUploadsPath, getTempPath } from './paths';
import {
  FILE_SIZE_LIMITS,
  MAX_FILES_PER_UPLOAD,
  SUPPORTED_FILE_TYPES,
  GENERAL_ALLOWED_TYPES,
  UploadType,
  UploadContext,
  ValidationResult,
  validateFileTypeByMetadata,
  validateFileSizeByBytes,
  validateFileCountByNumber,
  validateFileByMetadata,
  validateFilesByMetadata,
} from './uploads.config';

// ----- Thin Validation Adapters -----

export const validateFileType = (file: Express.Multer.File, uploadType: UploadType = 'general'): ValidationResult =>
  validateFileTypeByMetadata(file.originalname, file.mimetype, uploadType);

export const validateFileSize = (file: Express.Multer.File, uploadType: UploadType = 'general'): ValidationResult =>
  validateFileSizeByBytes(file.size, uploadType);

export const validateFileCount = (files: Express.Multer.File[]): ValidationResult =>
  validateFileCountByNumber(files.length);

export const validateFile = (file: Express.Multer.File, uploadType: UploadType = 'general'): ValidationResult =>
  validateFileByMetadata(file.originalname, file.mimetype, file.size, uploadType);

export const validateFileUploads = (files: Express.Multer.File[], uploadType: UploadType = 'general'): ValidationResult =>
  validateFilesByMetadata(
    files.map(f => ({ filename: f.originalname, mimetype: f.mimetype, size: f.size })),
    uploadType
  );

// ----- Multer Filters -----

export function createFileFilter(uploadContext: UploadContext) {
  return (req: any, file: Express.Multer.File, cb: any) => {
    // Map upload contexts to validation types
    const validationType: UploadType = uploadContext === 'avatar' ? 'avatar' : 'general';
    const validation = validateFileType(file, validationType);
    if (validation.isValid) {
      cb(null, true);
    } else {
      cb(new Error(validation.message), false);
    }
  };
}

// ----- Helpers -----

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getSupportedFileExtensions(uploadType: 'general' | 'avatar' = 'general'): string {
  if (uploadType === 'avatar') {
    return SUPPORTED_FILE_TYPES.IMAGES.extensions.join(',');
  }
  return GENERAL_ALLOWED_TYPES.extensions.join(',');
}


// ----- Unstructured Processing -----

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

export function isFileSupported(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return (GENERAL_ALLOWED_TYPES.extensions as readonly string[]).includes(ext);
}

export async function loadFileContent(filePath: string): Promise<{ content: string | null; error: string | null }> {
  if (!filePath || !fs.existsSync(filePath)) {
    return { content: null, error: `File not found: ${filePath}` };
  }

  try {
    const client = getUnstructuredClient();
    if (client) {
      const data = fs.readFileSync(filePath);
      const response = await client.general.partition({
        partitionParameters: {
          files: {
            content: data,
            fileName: path.basename(filePath),
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
          .map((element: any) => element.text || '')
          .filter((text: string) => text.trim())
          .join('\n\n');
        return { content, error: null };
      } else if (typeof response === 'string' && response.trim()) {
        return { content: response, error: null };
      }
    }
  } catch (error) {
    console.warn(`UnstructuredClient failed for ${path.basename(filePath)}, trying fallback:`, error instanceof Error ? error.message : 'Unknown error');
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    const textExtensions = ['.txt', '.md', '.json', '.csv', '.js', '.ts', '.py', '.html', '.css', '.xml', '.yml', '.yaml', '.eml', '.msg'];
    if (textExtensions.includes(ext) || ext === '') {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.trim()) return { content, error: null };
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

export async function loadFilesInParallel(filePaths: string[]): Promise<Array<{ filePath: string; content: string | null; error: string | null }>> {
  const promises = filePaths.map(async (filePath) => {
    const result = await loadFileContent(filePath);
    return { filePath, ...result };
  });
  return Promise.all(promises);
}

export async function processUploadedFiles(files: Express.Multer.File[]): Promise<string> {
  const contentParts: string[] = [];
  for (const file of files) {
    if (!isFileSupported(file.path)) {
      console.log(`Skipping unsupported file: ${file.originalname}`);
      continue;
    }
    const result = await loadFileContent(file.path);
    if (result.content && result.content.trim()) {
      contentParts.push(`=== ${file.originalname} ===\n${result.content.substring(0, 5000)}`);
    } else if (result.error) {
      console.warn(`Failed to process ${file.originalname}: ${result.error}`);
    }
  }
  return contentParts.join('\n\n');
}

// ----- Centralized Multer Factory -----

export function createUploadClient(
  uploadContext: UploadContext,
  userId?: string
): multer.Multer {
  const isAvatar = uploadContext === 'avatar';
  const isVibecheck = uploadContext === 'vibecheck';
  
  // Validate userId is provided for upload types that require it
  if (!isVibecheck && !userId) {
    throw new Error(`userId is required for upload context: ${uploadContext}`);
  }
  
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      let targetDir: string;
      if (isVibecheck) {
        targetDir = getTempPath('vibecheck');
      } else {
        const uploadDir = isAvatar ? 'avatars' : 'files';
        targetDir = getUploadsPath(uploadDir, userId);
      }
      if (!fs.existsSync(targetDir)) {
        try {
          fs.mkdirSync(targetDir, { recursive: true });
        } catch (error) {
          return cb(new Error(`Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}`), '');
        }
      }
      cb(null, targetDir);
    },
    filename: (req, file, cb) => {
      const fileId = uuidv4();
      const extension = path.extname(file.originalname);
      (req as Express.Request & { generatedFileId?: string }).generatedFileId = fileId;
      cb(null, fileId + extension);
    }
  });

  const fileFilter = createFileFilter(uploadContext);

  return multer({
    storage,
    limits: {
      fileSize: isAvatar ? FILE_SIZE_LIMITS.AVATAR : FILE_SIZE_LIMITS.GENERAL,
      files: isAvatar ? 1 : MAX_FILES_PER_UPLOAD
    },
    fileFilter
  });
}



