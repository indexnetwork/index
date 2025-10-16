/**
 * Frontend Uploads Utilities
 *
 * Re-exports from the frontend file validation module for backward compatibility.
 */

export {
  // Validation functions
  validateFileType,
  validateFileSize,
  validateFileCount,
  validateFile,
  validateFiles as validateFileUploads,
  
  // Helper functions
  formatFileSize,
  getSupportedFileExtensions,
  getSupportedFileTypesDisplayText,
  getFileExtension,
  getFileCategoryBadge,
  
  // Constants
  FILE_SIZE_LIMITS,
  MAX_FILES_PER_UPLOAD,
  SUPPORTED_FILE_TYPES,
  GENERAL_ALLOWED_TYPES,
  FALLBACK_TEXT_EXTENSIONS,
  
  // Types
  type UploadType,
  type UploadContext,
  type ValidationResult,
  ValidationError
} from './file-validation';