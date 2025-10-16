/**
 * Shared Uploads Configuration & Validation
 *
 * Pure constants, types, and validation logic consumed by both backend and frontend.
 * All validation functions work with primitive types to avoid runtime dependencies.
 */

import path from 'path';
const filesize = require('filesize');

// File size limits in bytes
export const FILE_SIZE_LIMITS = {
  GENERAL: 10 * 1024 * 1024, // 10MB for general files
  AVATAR: 4 * 1024 * 1024,   // 4MB for avatars
} as const;

// Maximum number of files per upload request
export const MAX_FILES_PER_UPLOAD = 10 as const;

// Supported file types based on Unstructured.io capabilities
export const SUPPORTED_FILE_TYPES = {
  // Document formats
  DOCUMENTS: {
    extensions: ['.csv', '.doc', '.docx', '.epub', '.html', '.json', '.md', '.pdf', '.ppt', '.pptx', '.rtf', '.tsv', '.txt', '.xls', '.xlsx', '.xml'],
    mimeTypes: [
      'text/csv',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/epub+zip',
      'text/html',
      'application/json',
      'text/markdown',
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/rtf',
      'text/tab-separated-values',
      'text/plain',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/xml',
      'text/xml'
    ]
  },
  
  // Image formats (for avatars)
  IMAGES: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic'],
    mimeTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/tiff',
      'image/heic'
    ]
  }
} as const;

// Combined allowed types for general file uploads
export const GENERAL_ALLOWED_TYPES = {
  extensions: SUPPORTED_FILE_TYPES.DOCUMENTS.extensions,
  mimeTypes: SUPPORTED_FILE_TYPES.DOCUMENTS.mimeTypes
} as const;

// Shared types
export type UploadType = 'general' | 'avatar';
export type UploadContext = 'discovery' | 'avatar' | 'library' | 'vibecheck';

export enum ValidationError {
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE = 'UNSUPPORTED_FILE_TYPE',
  TOO_MANY_FILES = 'TOO_MANY_FILES',
  INVALID_FILE = 'INVALID_FILE'
}

export interface ValidationResult {
  isValid: boolean;
  error?: ValidationError;
  message?: string;
}

// ----- Pure Validation Functions -----

export function validateFileTypeByMetadata(
  filename: string,
  mimetype: string,
  uploadType: UploadType
): ValidationResult {
  // Validate required inputs
  if (!filename || !mimetype) {
    return {
      isValid: false,
      error: ValidationError.INVALID_FILE,
      message: 'Missing required file metadata'
    };
  }

  // Extract extension using path.extname for consistency
  const ext = path.extname(filename).toLowerCase();
  const mimeType = mimetype.toLowerCase();

  if (uploadType === 'avatar') {
    const isImage = (SUPPORTED_FILE_TYPES.IMAGES.extensions as readonly string[]).includes(ext) &&
                   (SUPPORTED_FILE_TYPES.IMAGES.mimeTypes as readonly string[]).includes(mimeType);
    if (!isImage) {
      return {
        isValid: false,
        error: ValidationError.UNSUPPORTED_FILE_TYPE,
        message: `File "${filename}" (${mimetype}) is not supported. Only image files are allowed for avatars (JPG, PNG, GIF, WEBP, BMP, TIFF, HEIC)`
      };
    }
  } else {
    // For general files, require BOTH extension and MIME type to be valid for security
    const hasValidExtension = ext && (GENERAL_ALLOWED_TYPES.extensions as readonly string[]).includes(ext);
    const hasValidMimeType = (GENERAL_ALLOWED_TYPES.mimeTypes as readonly string[]).includes(mimeType);
    
    if (!hasValidExtension || !hasValidMimeType) {
      return {
        isValid: false,
        error: ValidationError.UNSUPPORTED_FILE_TYPE,
        message: `File "${filename}" (${mimetype}) is not supported. Both extension and MIME type must be valid. Allowed: CSV, DOC, DOCX, EPUB, HTML, JSON, MD, PDF, PPT, PPTX, RTF, TSV, TXT, XLS, XLSX, XML`
      };
    }
  }

  return { isValid: true };
}

export function validateFileSizeByBytes(
  sizeInBytes: number,
  uploadType: UploadType
): ValidationResult {
  // Validate input is a finite positive integer
  if (!Number.isFinite(sizeInBytes) || sizeInBytes < 0 || !Number.isInteger(sizeInBytes)) {
    return {
      isValid: false,
      error: ValidationError.INVALID_FILE,
      message: 'Invalid file size'
    };
  }

  // Reject empty files (0 bytes)
  if (sizeInBytes === 0) {
    return {
      isValid: false,
      error: ValidationError.INVALID_FILE,
      message: 'File is empty (0 bytes)'
    };
  }

  const limit = uploadType === 'avatar' ? FILE_SIZE_LIMITS.AVATAR : FILE_SIZE_LIMITS.GENERAL;

  if (sizeInBytes > limit) {
    return {
      isValid: false,
      error: ValidationError.FILE_TOO_LARGE,
      message: `File size exceeds ${formatFileSize(limit)} limit`
    };
  }

  return { isValid: true };
}

export function validateFileCountByNumber(fileCount: number): ValidationResult {
  // Validate input
  if (!Number.isInteger(fileCount) || fileCount < 0) {
    return {
      isValid: false,
      error: ValidationError.INVALID_FILE,
      message: 'Invalid file count'
    };
  }

  if (fileCount > MAX_FILES_PER_UPLOAD) {
    return {
      isValid: false,
      error: ValidationError.TOO_MANY_FILES,
      message: `Maximum ${MAX_FILES_PER_UPLOAD} files allowed per upload`
    };
  }
  return { isValid: true };
}

export function validateFileByMetadata(
  filename: string,
  mimetype: string,
  sizeInBytes: number,
  uploadType: UploadType
): ValidationResult {
  const typeValidation = validateFileTypeByMetadata(filename, mimetype, uploadType);
  if (!typeValidation.isValid) return typeValidation;

  const sizeValidation = validateFileSizeByBytes(sizeInBytes, uploadType);
  if (!sizeValidation.isValid) return sizeValidation;

  return { isValid: true };
}

export function validateFilesByMetadata(
  files: Array<{ filename: string; mimetype: string; size: number }>,
  uploadType: UploadType
): ValidationResult {
  const countValidation = validateFileCountByNumber(files.length);
  if (!countValidation.isValid) return countValidation;

  for (const file of files) {
    const fileValidation = validateFileByMetadata(file.filename, file.mimetype, file.size, uploadType);
    if (!fileValidation.isValid) return fileValidation;
  }

  return { isValid: true };
}

export function formatFileSize(bytes: number): string {
  return filesize(bytes, { precision: 2 });
}

export function getSupportedFileExtensions(uploadType: UploadType = 'general'): string {
  return uploadType === 'avatar' 
    ? SUPPORTED_FILE_TYPES.IMAGES.extensions.join(',')
    : GENERAL_ALLOWED_TYPES.extensions.join(',');
}

export function getSupportedFileTypesDisplayText(uploadType: UploadType = 'general'): string {
  if (uploadType === 'avatar') {
    const extensions = SUPPORTED_FILE_TYPES.IMAGES.extensions
      .map(ext => ext.toUpperCase().slice(1)) // Remove dot and uppercase
      .join(', ');
    return `Supported image files: ${extensions}`;
  } else {
    const extensions = GENERAL_ALLOWED_TYPES.extensions
      .map(ext => ext.toUpperCase().slice(1)) // Remove dot and uppercase  
      .join(', ');
    return `Supported files: ${extensions}`;
  }
}


