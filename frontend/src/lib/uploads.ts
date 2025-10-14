/**
 * Frontend Uploads Utilities
 *
 * Thin adapters for File API types that delegate to shared validation logic.
 */

import {
  SUPPORTED_FILE_TYPES,
  GENERAL_ALLOWED_TYPES,
  UploadType,
  ValidationResult,
  validateFileTypeByMetadata,
  validateFileSizeByBytes,
  validateFileCountByNumber,
  validateFileByMetadata,
  validateFilesByMetadata,
} from 'protocol/lib/uploads.config';

// ----- Thin Validation Adapters -----

export const validateFileType = (file: File, uploadType: UploadType = 'general'): ValidationResult =>
  validateFileTypeByMetadata(file.name, file.type, uploadType);

export const validateFileSize = (file: File, uploadType: UploadType = 'general'): ValidationResult =>
  validateFileSizeByBytes(file.size, uploadType);

export const validateFileCount = (files: File[]): ValidationResult =>
  validateFileCountByNumber(files.length);

export const validateFile = (file: File, uploadType: UploadType = 'general'): ValidationResult =>
  validateFileByMetadata(file.name, file.type, file.size, uploadType);

export const validateFiles = (files: File[], uploadType: UploadType = 'general'): ValidationResult =>
  validateFilesByMetadata(
    files.map(f => ({ filename: f.name, mimetype: f.type, size: f.size })),
    uploadType
  );

// ----- Simple Helper Functions -----

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const getAcceptString = (uploadType: UploadType = 'general'): string =>
  uploadType === 'avatar' 
    ? SUPPORTED_FILE_TYPES.IMAGES.extensions.join(',')
    : GENERAL_ALLOWED_TYPES.extensions.join(',');


