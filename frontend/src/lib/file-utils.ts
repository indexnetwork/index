// Utility functions for file URL generation

const getBaseUrl = () => {
  return process.env.NEXT_PUBLIC_STATIC_URL || 'http://localhost:3001';
};

/**
 * Generate URL for avatar files
 * @param filename - The avatar filename (e.g., "uuid.jpg")
 * @returns Full URL to the avatar file
 */
export const getAvatarUrl = (filename: string): string => {
  if (!filename) return '';
  
  // If it's already a full URL, return as is
  if (filename.startsWith('http://') || filename.startsWith('https://')) {
    return filename;
  }
  
  // Remove leading slash if present
  const cleanFilename = filename.startsWith('/') ? filename.slice(1) : filename;
  
  return `${getBaseUrl()}/uploads/avatars/${cleanFilename}`;
};

/**
 * Generate URL for index files
 * @param file - The file object containing indexId, id, and name
 * @returns Full URL to the index file
 */
export const getIndexFileUrl = (file: { indexId: string; id: string; name: string }): string => {
  if (!file.indexId || !file.id || !file.name) return '';
  
  const extension = getFileExtension(file.name);
  return `${getBaseUrl()}/uploads/${file.indexId}/${file.id}${extension}`;
};

/**
 * Extract file extension from filename
 * @param filename - The filename
 * @returns File extension including the dot (e.g., ".pdf")
 */
export const getFileExtension = (filename: string): string => {
  const lastDot = filename.lastIndexOf('.');
  return lastDot !== -1 ? filename.slice(lastDot) : '';
};

/**
 * Check if a URL is external (starts with http/https)
 * @param url - URL to check
 * @returns True if external URL
 */
export const isExternalUrl = (url: string): boolean => {
  return url.startsWith('http://') || url.startsWith('https://');
}; 