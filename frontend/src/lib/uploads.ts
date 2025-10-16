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
import { filesize } from 'filesize';

export const validateFileType = (file: File, uploadType: UploadType = 'general'): ValidationResult =>
  validateFileTypeByMetadata(file.name, file.type, uploadType);

export const validateFileSize = (file: File, uploadType: UploadType = 'general'): ValidationResult =>
  validateFileSizeByBytes(file.size, uploadType);

export const validateFileCount = (files: File[]): ValidationResult =>
  validateFileCountByNumber(files.length);

export const validateFile = (file: File, uploadType: UploadType = 'general'): ValidationResult =>
  validateFileByMetadata(file.name, file.type, file.size, uploadType);

export const validateFileUploads = (files: File[], uploadType: UploadType = 'general'): ValidationResult =>
  validateFilesByMetadata(
    files.map(f => ({ filename: f.name, mimetype: f.type, size: f.size })),
    uploadType
  );

// ----- Helper Functions -----

export const formatFileSize = (bytes: number): string => {
  return filesize(bytes, { precision: 2 });
};

export const getSupportedFileExtensions = (uploadType: UploadType = 'general'): string =>
  uploadType === 'avatar' 
    ? SUPPORTED_FILE_TYPES.IMAGES.extensions.join(',')
    : GENERAL_ALLOWED_TYPES.extensions.join(',');

export const getSupportedFileTypesDisplayText = (uploadType: UploadType = 'general'): string => {
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
};