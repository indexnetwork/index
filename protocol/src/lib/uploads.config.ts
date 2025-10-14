/**
 * Shared Uploads Configuration & Validation
 *
 * Pure constants, types, and validation logic consumed by both backend and frontend.
 * All validation functions work with primitive types to avoid runtime dependencies.
 */

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
    extensions: ['.pdf', '.doc', '.docx', '.txt', '.csv', '.xls', '.xlsx', '.json', '.md', '.ppt', '.pptx', '.rtf', '.odt', '.xml', '.yaml', '.yml', '.html', '.htm', '.epub'],
    mimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/json',
      'text/markdown',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/rtf',
      'application/vnd.oasis.opendocument.text',
      'application/xml',
      'text/xml',
      'application/x-yaml',
      'text/yaml',
      'text/html',
      'application/epub+zip'
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
  },
  
  // Email formats
  EMAIL: {
    extensions: ['.eml', '.msg', '.mbox'],
    mimeTypes: [
      'message/rfc822',
      'application/vnd.ms-outlook',
      'application/mbox'
    ]
  },
  
  // Archive formats (read-only, no processing)
  ARCHIVES: {
    extensions: ['.zip'],
    mimeTypes: [
      'application/zip'
    ]
  }
} as const;

// Combined allowed types for general file uploads
export const GENERAL_ALLOWED_TYPES = {
  extensions: [
    ...SUPPORTED_FILE_TYPES.DOCUMENTS.extensions,
    ...SUPPORTED_FILE_TYPES.EMAIL.extensions,
    ...SUPPORTED_FILE_TYPES.ARCHIVES.extensions
  ],
  mimeTypes: [
    ...SUPPORTED_FILE_TYPES.DOCUMENTS.mimeTypes,
    ...SUPPORTED_FILE_TYPES.EMAIL.mimeTypes,
    ...SUPPORTED_FILE_TYPES.ARCHIVES.mimeTypes
  ]
} as const;

// Shared types
export type UploadType = 'general' | 'avatar';

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
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  const mimeType = mimetype.toLowerCase();

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

export function validateFileSizeByBytes(
  sizeInBytes: number,
  uploadType: UploadType
): ValidationResult {
  const limit = uploadType === 'avatar' ? FILE_SIZE_LIMITS.AVATAR : FILE_SIZE_LIMITS.GENERAL;
  const limitMB = Math.round(limit / (1024 * 1024));

  if (sizeInBytes > limit) {
    return {
      isValid: false,
      error: ValidationError.FILE_TOO_LARGE,
      message: `File size exceeds ${limitMB}MB limit`
    };
  }

  return { isValid: true };
}

export function validateFileCountByNumber(fileCount: number): ValidationResult {
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


