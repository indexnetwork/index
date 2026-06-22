/**
 * File Validation Configuration
 *
 * Pure constants, types, and validation logic for file uploads.
 * All validation functions work with primitive types to avoid runtime dependencies.
 */

import path from 'path';

/** File size limits in bytes */
export const FILE_SIZE_LIMITS = {
  GENERAL: 10 * 1024 * 1024, // 10MB for general files
  AVATAR: 4 * 1024 * 1024,   // 4MB for avatars
} as const;

// Supported file types based on Unstructured.io capabilities
const SUPPORTED_FILE_TYPES = {
  // Document formats - each extension maps to its valid MIME types
  DOCUMENTS: {
    '.csv': ['text/csv'],
    '.doc': ['application/msword'],
    '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    '.epub': ['application/epub+zip'],
    '.html': ['text/html'],
    '.json': ['application/json'],
    '.md': ['text/markdown'],
    '.pdf': ['application/pdf'],
    '.ppt': ['application/vnd.ms-powerpoint'],
    '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    '.rtf': ['application/rtf'],
    '.tsv': ['text/tab-separated-values'],
    '.txt': ['text/plain'],
    '.xls': ['application/vnd.ms-excel'],
    '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    '.xml': ['application/xml', 'text/xml'] // XML supports both MIME types per RFC standards
  },

  // Image formats (for avatars) - each extension maps to its valid MIME types
  IMAGES: {
    '.jpg': ['image/jpeg'],
    '.jpeg': ['image/jpeg'],
    '.png': ['image/png'],
    '.gif': ['image/gif'],
    '.webp': ['image/webp'],
    '.bmp': ['image/bmp'],
    '.tiff': ['image/tiff'],
    '.tif': ['image/tiff'],
    '.heic': ['image/heic']
  }
} as const;

// Combined allowed types for general file uploads
const GENERAL_ALLOWED_TYPES = SUPPORTED_FILE_TYPES.DOCUMENTS;

// Shared types
type UploadType = 'general' | 'avatar';

enum ValidationError {
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE = 'UNSUPPORTED_FILE_TYPE',
  INVALID_FILE = 'INVALID_FILE'
}

interface ValidationResult {
  isValid: boolean;
  error?: ValidationError;
  message?: string;
}

// ----- Pure Validation Functions -----

/**
 * Validates file type based on filename extension and MIME type.
 * For general uploads, accepts exact MIME matches or application/octet-stream.
 * For avatars, requires exact MIME type match.
 *
 * @param filename - The file's name including extension
 * @param mimetype - The reported MIME type from the multipart Content-Type header
 * @param uploadType - Whether this is a 'general' or 'avatar' upload
 * @returns ValidationResult indicating if the file type is valid
 */
function validateFileTypeByMetadata(
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
    const allowedMimeTypes = SUPPORTED_FILE_TYPES.IMAGES[ext as keyof typeof SUPPORTED_FILE_TYPES.IMAGES];
    const isImage = allowedMimeTypes && (allowedMimeTypes as readonly string[]).includes(mimeType);
    if (!isImage) {
      return {
        isValid: false,
        error: ValidationError.UNSUPPORTED_FILE_TYPE,
        message: `File "${filename}" (${mimetype}) is not supported. Only image files are allowed for avatars (JPG, PNG, GIF, WEBP, BMP, TIFF, HEIC)`
      };
    }
  } else {
    const allowedMimeTypes = GENERAL_ALLOWED_TYPES[ext as keyof typeof GENERAL_ALLOWED_TYPES];
    const hasValidExtension = ext && allowedMimeTypes;
    // Accept the file when the extension is valid AND the MIME type either matches
    // our whitelist or is a generic fallback. Browsers and CLI tools often report
    // application/octet-stream for file types like .md, .csv, .json, .xml, etc.
    const isGenericMime = mimeType === 'application/octet-stream';
    const hasValidMimeType = allowedMimeTypes && (
      (allowedMimeTypes as readonly string[]).includes(mimeType) || isGenericMime
    );

    if (!hasValidExtension || !hasValidMimeType) {
      return {
        isValid: false,
        error: ValidationError.UNSUPPORTED_FILE_TYPE,
        message: `File "${filename}" (${mimetype}) is not supported. Allowed: CSV, DOC, DOCX, EPUB, HTML, JSON, MD, PDF, PPT, PPTX, RTF, TSV, TXT, XLS, XLSX, XML`
      };
    }
  }

  return { isValid: true };
}

function validateFileSizeByBytes(
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
      message: `File size exceeds ${(limit / (1024 * 1024)).toFixed(2)}MB limit`
    };
  }

  return { isValid: true };
}

/**
 * Validates a single file by its metadata (filename, MIME type, and size).
 *
 * @param filename - The file's name including extension
 * @param mimetype - The reported MIME type
 * @param sizeInBytes - The file size in bytes
 * @param uploadType - Whether this is a 'general' or 'avatar' upload
 * @returns ValidationResult indicating if the file is valid
 */
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

/**
 * Extensions that can be read as plain text when Unstructured API fails
 */
export const FALLBACK_TEXT_EXTENSIONS = [
  '.txt', '.md', '.json', '.csv', '.js', '.ts', '.py', '.html', '.css', '.xml', '.yml', '.yaml', '.eml', '.msg'
] as const;
