// Utility functions for file URL generation

const getBaseUrl = () => {
  return process.env.NEXT_PUBLIC_STATIC_URL || 'http://localhost:3001';
};

/**
 * Generate URL for avatar files
 * @param params - Object containing avatar and id/name properties
 * @returns Full URL to the avatar file
 */
export const getAvatarUrl = (params: { avatar?: string | null; id?: string; name?: string } | null): string => {
  
  if (!params) return 'https://api.dicebear.com/9.x/shapes/png?seed=default';
  const { avatar } = params;

  if (!avatar) {
    const seed = params.id || params.name || 'default';
    return `https://api.dicebear.com/9.x/shapes/png?seed=${seed}`;
  }
  
  // If it's already a full URL, return as is
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) {
    return avatar;
  }
  
  // Remove leading slash if present
  const cleanFilename = avatar.startsWith('/') ? avatar.slice(1) : avatar;
  
  return `${getBaseUrl()}/uploads/avatars/${cleanFilename}`;
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