import { apiUrl } from '@/lib/api';

/** Resolve a stored network image reference to a fetchable URL. */
export function resolveNetworkImageSrc(imageUrl: string): string {
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }
  if (imageUrl.startsWith('/api/storage/')) {
    return apiUrl(imageUrl);
  }
  const cleanPath = imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl;
  return apiUrl(`/api/storage/${cleanPath}`);
}
