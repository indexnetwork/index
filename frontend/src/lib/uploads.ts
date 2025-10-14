/**
 * Frontend Uploads Utilities
 *
 * Mirrors backend validation rules for client-side validation,
 * importing shared configuration from the protocol package.
 */

import {
  FILE_SIZE_LIMITS,
  MAX_FILES_PER_UPLOAD,
  SUPPORTED_FILE_TYPES,
  GENERAL_ALLOWED_TYPES,
  ValidationError,
  ValidationResult,
} from '@protocol/lib/uploads.config';

function getFileExtension(filename: string): string {
  return filename.toLowerCase().substring(filename.lastIndexOf('.'));
}

export function validateFileType(file: File, uploadType: 'general' | 'avatar' = 'general'): ValidationResult {
  const ext = getFileExtension(file.name);
  const mimeType = file.type.toLowerCase();

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

export function validateFileSize(file: File, uploadType: 'general' | 'avatar' = 'general'): ValidationResult {
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

export function validateFileCount(files: File[]): ValidationResult {
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return {
      isValid: false,
      error: ValidationError.TOO_MANY_FILES,
      message: `Maximum ${MAX_FILES_PER_UPLOAD} files allowed per upload`
    };
  }
  return { isValid: true };
}

export function validateFile(file: File, uploadType: 'general' | 'avatar' = 'general'): ValidationResult {
  const typeValidation = validateFileType(file, uploadType);
  if (!typeValidation.isValid) return typeValidation;
  const sizeValidation = validateFileSize(file, uploadType);
  if (!sizeValidation.isValid) return sizeValidation;
  return { isValid: true };
}

export function validateFiles(files: File[], uploadType: 'general' | 'avatar' = 'general'): ValidationResult {
  const countValidation = validateFileCount(files);
  if (!countValidation.isValid) return countValidation;
  for (const file of files) {
    const fileValidation = validateFile(file, uploadType);
    if (!fileValidation.isValid) return fileValidation;
  }
  return { isValid: true };
}

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

export function getSupportedTypesList(uploadType: 'general' | 'avatar' = 'general'): string {
  if (uploadType === 'avatar') {
    return 'JPG, PNG, GIF, WEBP, BMP, TIFF, HEIC';
  }
  return 'PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, JSON, MD, PPT, PPTX, RTF, ODT, XML, YAML, HTML, EPUB, EML, MSG, MBOX, ZIP';
}

export function getSizeLimitString(uploadType: 'general' | 'avatar' = 'general'): string {
  const limit = uploadType === 'avatar' ? FILE_SIZE_LIMITS.AVATAR : FILE_SIZE_LIMITS.GENERAL;
  return formatFileSize(limit);
}

export function getUploadRequirements(uploadType: 'general' | 'avatar' = 'general'): string {
  const types = getSupportedTypesList(uploadType);
  const sizeLimit = getSizeLimitString(uploadType);
  const maxFiles = uploadType === 'avatar' ? '' : ` (max ${MAX_FILES_PER_UPLOAD} files)`;
  return `Supported: ${types}. Max size: ${sizeLimit}${maxFiles}`;
}

export { FILE_SIZE_LIMITS, MAX_FILES_PER_UPLOAD };


