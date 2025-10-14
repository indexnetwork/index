/**
 * Backend Uploads Implementation
 *
 * Imports shared configuration from `uploads.config.ts` and exposes
 * backend-specific validation utilities, multer filters, and
 * Unstructured processing helpers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { UnstructuredClient } from 'unstructured-client';
import { Strategy } from 'unstructured-client/sdk/models/shared';
import {
  FILE_SIZE_LIMITS,
  MAX_FILES_PER_UPLOAD,
  SUPPORTED_FILE_TYPES,
  GENERAL_ALLOWED_TYPES,
  ValidationError,
  ValidationResult,
} from './uploads.config';

// ----- Validation -----

export function validateFileType(file: Express.Multer.File, uploadType: 'general' | 'avatar' = 'general'): ValidationResult {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype.toLowerCase();

  if (uploadType === 'avatar') {
    const isImage = (SUPPORTED_FILE_TYPES.IMAGES.extensions as readonly string[]).includes(ext) &&
                   (SUPPORTED_FILE_TYPES.IMAGES.mimeTypes as readonly string[]).includes(mimeType);
    if (!isImage) {
      return {
        isValid: false,
        error: ValidationError.UNSUPPORTED_FILE_TYPE,
        message: 'Only image files are allowed for avatars (JPG, PNG, GIF, WEBP, BMP, TIFF, HEIC)'
      };
    }
  } else {
    const isGeneralType = (GENERAL_ALLOWED_TYPES.extensions as readonly string[]).includes(ext) &&
                         (GENERAL_ALLOWED_TYPES.mimeTypes as readonly string[]).includes(mimeType);
    if (!isGeneralType) {
      return {
        isValid: false,
        error: ValidationError.UNSUPPORTED_FILE_TYPE,
        message: 'Unsupported file type. Allowed: PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, JSON, MD, PPT, PPTX, RTF, ODT, XML, YAML, HTML, EPUB, EML, MSG, MBOX, ZIP'
      };
    }
  }

  return { isValid: true };
}

export function validateFileSize(file: Express.Multer.File, uploadType: 'general' | 'avatar' = 'general'): ValidationResult {
  const limit = uploadType === 'avatar' ? FILE_SIZE_LIMITS.AVATAR : FILE_SIZE_LIMITS.GENERAL;
  const limitMB = Math.round(limit / (1024 * 1024));

  if (file.size > limit) {
    return {
      isValid: false,
      error: ValidationError.FILE_TOO_LARGE,
      message: `File size exceeds ${limitMB}MB limit`
    };
  }

  return { isValid: true };
}

export function validateFileCount(files: Express.Multer.File[]): ValidationResult {
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return {
      isValid: false,
      error: ValidationError.TOO_MANY_FILES,
      message: `Maximum ${MAX_FILES_PER_UPLOAD} files allowed per upload`
    };
  }
  return { isValid: true };
}

export function validateFile(file: Express.Multer.File, uploadType: 'general' | 'avatar' = 'general'): ValidationResult {
  const typeValidation = validateFileType(file, uploadType);
  if (!typeValidation.isValid) return typeValidation;

  const sizeValidation = validateFileSize(file, uploadType);
  if (!sizeValidation.isValid) return sizeValidation;

  return { isValid: true };
}

export function validateFiles(files: Express.Multer.File[], uploadType: 'general' | 'avatar' = 'general'): ValidationResult {
  const countValidation = validateFileCount(files);
  if (!countValidation.isValid) return countValidation;

  for (const file of files) {
    const fileValidation = validateFile(file, uploadType);
    if (!fileValidation.isValid) return fileValidation;
  }

  return { isValid: true };
}

// ----- Multer Filters -----

export function createGeneralFileFilter() {
  return (req: any, file: Express.Multer.File, cb: any) => {
    const validation = validateFileType(file, 'general');
    if (validation.isValid) {
      cb(null, true);
    } else {
      cb(new Error(validation.message), false);
    }
  };
}

export function createAvatarFileFilter() {
  return (req: any, file: Express.Multer.File, cb: any) => {
    const validation = validateFileType(file, 'avatar');
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

export function getAcceptString(uploadType: 'general' | 'avatar' = 'general'): string {
  if (uploadType === 'avatar') {
    return SUPPORTED_FILE_TYPES.IMAGES.extensions.join(',');
  }
  return GENERAL_ALLOWED_TYPES.extensions.join(',');
}

// ----- Unstructured Processing -----

const unstructuredClient = new UnstructuredClient({
  serverURL: process.env.UNSTRUCTURED_API_URL
});

export function isFileSupported(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return (GENERAL_ALLOWED_TYPES.extensions as readonly string[]).includes(ext);
}

export async function loadFileContent(filePath: string): Promise<{ content: string | null; error: string | null }> {
  if (!filePath || !fs.existsSync(filePath)) {
    return { content: null, error: `File not found: ${filePath}` };
  }

  try {
    if (process.env.UNSTRUCTURED_API_URL) {
      const data = fs.readFileSync(filePath);
      const response = await unstructuredClient.general.partition({
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

export { FILE_SIZE_LIMITS, MAX_FILES_PER_UPLOAD };


