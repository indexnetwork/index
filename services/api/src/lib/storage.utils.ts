/**
 * Normalize a file extension to match the sanitization applied by S3StorageAdapter.uploadFile.
 * Strips leading dot, lowercases, removes non-alphanumeric characters.
 */
export function normalizeExtension(extension: string): string {
  return extension.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
