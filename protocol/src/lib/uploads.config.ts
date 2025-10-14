/**
 * Shared Uploads Configuration (no runtime deps)
 *
 * Pure constants and types consumed by both backend and frontend.
 * Keep shapes identical to current usage to minimize call-site edits.
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


