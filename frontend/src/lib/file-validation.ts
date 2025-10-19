/**
 * Frontend File Validation Configuration
 *
 * Complete file validation logic for browser environments.
 * Duplicated from protocol to avoid cross-package dependencies.
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
export const GENERAL_ALLOWED_TYPES = SUPPORTED_FILE_TYPES.DOCUMENTS;

// Types
export type UploadType = 'general' | 'avatar';
export type UploadContext = 'discovery' | 'avatar' | 'library';

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

// ----- Browser-Native Validation Functions -----

export function validateFileType(file: File, uploadType: UploadType = 'general'): ValidationResult {
  // Validate required inputs
  if (!file.name || !file.type) {
    return {
      isValid: false,
      error: ValidationError.INVALID_FILE,
      message: 'Missing required file metadata'
    };
  }

  // Extract extension
  const ext = getFileExtension(file.name).toLowerCase();
  const mimeType = file.type.toLowerCase();

  if (uploadType === 'avatar') {
    const allowedMimeTypes = SUPPORTED_FILE_TYPES.IMAGES[ext as keyof typeof SUPPORTED_FILE_TYPES.IMAGES];
    const isImage = allowedMimeTypes && (allowedMimeTypes as readonly string[]).includes(mimeType);
    if (!isImage) {
      return {
        isValid: false,
        error: ValidationError.UNSUPPORTED_FILE_TYPE,
        message: `File "${file.name}" (${file.type}) is not supported. Only image files are allowed for avatars (JPG, PNG, GIF, WEBP, BMP, TIFF, HEIC)`
      };
    }
  } else {
    // For general files, require BOTH extension and MIME type to be valid for security
    const allowedMimeTypes = GENERAL_ALLOWED_TYPES[ext as keyof typeof GENERAL_ALLOWED_TYPES];
    const hasValidExtension = ext && allowedMimeTypes;
    const hasValidMimeType = allowedMimeTypes && (allowedMimeTypes as readonly string[]).includes(mimeType);
    
    if (!hasValidExtension || !hasValidMimeType) {
      return {
        isValid: false,
        error: ValidationError.UNSUPPORTED_FILE_TYPE,
        message: `File "${file.name}" (${file.type}) is not supported. Both extension and MIME type must be valid. Allowed: CSV, DOC, DOCX, EPUB, HTML, JSON, MD, PDF, PPT, PPTX, RTF, TSV, TXT, XLS, XLSX, XML`
      };
    }
  }

  return { isValid: true };
}

export function validateFileSize(file: File, uploadType: UploadType = 'general'): ValidationResult {
  // Validate input is a finite positive integer
  if (!Number.isFinite(file.size) || file.size < 0 || !Number.isInteger(file.size)) {
    return {
      isValid: false,
      error: ValidationError.INVALID_FILE,
      message: 'Invalid file size'
    };
  }

  // Reject empty files (0 bytes)
  if (file.size === 0) {
    return {
      isValid: false,
      error: ValidationError.INVALID_FILE,
      message: 'File is empty (0 bytes)'
    };
  }

  const limit = uploadType === 'avatar' ? FILE_SIZE_LIMITS.AVATAR : FILE_SIZE_LIMITS.GENERAL;

  if (file.size > limit) {
    return {
      isValid: false,
      error: ValidationError.FILE_TOO_LARGE,
      message: `File size exceeds ${formatFileSize(limit)} limit`
    };
  }

  return { isValid: true };
}

export function validateFileCount(files: File[]): ValidationResult {
  // Validate input
  if (!Array.isArray(files)) {
    return {
      isValid: false,
      error: ValidationError.INVALID_FILE,
      message: 'Invalid file array'
    };
  }

  if (files.length > MAX_FILES_PER_UPLOAD) {
    return {
      isValid: false,
      error: ValidationError.TOO_MANY_FILES,
      message: `Maximum ${MAX_FILES_PER_UPLOAD} files allowed per upload`
    };
  }
  return { isValid: true };
}

export function validateFile(file: File, uploadType: UploadType = 'general'): ValidationResult {
  const typeValidation = validateFileType(file, uploadType);
  if (!typeValidation.isValid) return typeValidation;

  const sizeValidation = validateFileSize(file, uploadType);
  if (!sizeValidation.isValid) return sizeValidation;

  return { isValid: true };
}

export function validateFiles(files: File[], uploadType: UploadType = 'general'): ValidationResult {
  const countValidation = validateFileCount(files);
  if (!countValidation.isValid) return countValidation;

  for (const file of files) {
    const fileValidation = validateFile(file, uploadType);
    if (!fileValidation.isValid) return fileValidation;
  }

  return { isValid: true };
}

// ----- Helper Functions -----

export function formatFileSize(bytes: number): string {
  // Simple file size formatting without external dependency
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getSupportedFileExtensions(uploadType: UploadType = 'general'): string {
  return uploadType === 'avatar' 
    ? Object.keys(SUPPORTED_FILE_TYPES.IMAGES).join(',')
    : Object.keys(GENERAL_ALLOWED_TYPES).join(',');
}

export function getSupportedFileTypesDisplayText(uploadType: UploadType = 'general'): string {
  if (uploadType === 'avatar') {
    const extensions = Object.keys(SUPPORTED_FILE_TYPES.IMAGES)
      .map(ext => ext.toUpperCase().slice(1)) // Remove dot and uppercase
      .join(', ');
    return `Supported image files: ${extensions}`;
  } else {
    const extensions = Object.keys(GENERAL_ALLOWED_TYPES)
      .map(ext => ext.toUpperCase().slice(1)) // Remove dot and uppercase  
      .join(', ');
    return `Supported files: ${extensions}`;
  }
}

/**
 * Extract file extension from filename
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot !== -1 ? filename.slice(lastDot) : '';
}

/**
 * Get file category badge for supported file types
 */
export function getFileCategoryBadge(filename: string, mimetype?: string): string {
  const ext = getFileExtension(filename).toLowerCase();
  
  if (ext === '.pdf') return 'PDF';
  if (['.doc', '.docx', '.rtf', '.odt'].includes(ext)) return 'DOC';
  if (['.xls', '.xlsx', '.csv'].includes(ext)) return 'SHEET';
  if (['.ppt', '.pptx', '.key'].includes(ext)) return 'SLIDE';
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.tiff', '.tif', '.heic'].includes(ext)) return 'IMG';
  if (['.md', '.txt', '.json', '.yaml', '.yml', '.html', '.css', '.js', '.ts', '.py', '.xml'].includes(ext)) return 'TXT';
  
  if (mimetype) {
    if (mimetype.includes('pdf')) return 'PDF';
    if (mimetype.startsWith('image/')) return 'IMG';
  }
  
  return 'FILE';
}

/**
 * Check if a file path has a supported extension
 */
export function isFileExtensionSupported(filePath: string, uploadType: UploadType = 'general'): boolean {
  const ext = getFileExtension(filePath).toLowerCase();
  
  if (uploadType === 'avatar') {
    return ext in SUPPORTED_FILE_TYPES.IMAGES;
  } else {
    return ext in GENERAL_ALLOWED_TYPES;
  }
}

/**
 * Get MIME types for a file extension
 */
export function getMimeTypesForExtension(extension: string): readonly string[] {
  const ext = extension.toLowerCase();
  return GENERAL_ALLOWED_TYPES[ext as keyof typeof GENERAL_ALLOWED_TYPES] || [];
}

/**
 * Get the primary MIME type for a file extension (first in the array)
 * @deprecated Use getMimeTypesForExtension instead for better accuracy
 */
export function getMimeTypeForExtension(extension: string): string | null {
  const mimeTypes = getMimeTypesForExtension(extension);
  return mimeTypes.length > 0 ? mimeTypes[0] : null;
}

/**
 * Extensions that can be read as plain text when Unstructured API fails
 */
export const FALLBACK_TEXT_EXTENSIONS = [
  '.txt', '.md', '.json', '.csv', '.js', '.ts', '.py', '.html', '.css', '.xml', '.yml', '.yaml', '.eml', '.msg'
] as const;
