import { useState, useEffect } from 'react';
import Avatar from 'boring-avatars';
import { apiUrl } from '@/lib/api';

interface NetworkAvatarProps {
  id?: string;
  title?: string;
  imageUrl?: string | null;
  size: number;
  className?: string;
  rounded?: 'full' | 'sm';
}

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

function BoringFallback({ id, title, size, rounded, className }: { id?: string; title?: string; size: number; rounded: 'full' | 'sm'; className?: string }) {
  const seed = id || title || 'default';
  const roundedClass = rounded === 'full' ? 'rounded-full' : 'rounded-sm';
  return (
    <div
      className={`overflow-hidden shrink-0 ${roundedClass} ${className || ''}`}
      style={{ width: size, height: size }}
    >
      <Avatar size={size} name={seed} variant="bauhaus" />
    </div>
  );
}

export default function NetworkAvatar({ id, title, imageUrl, size, className = '', rounded = 'full' }: NetworkAvatarProps) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [imageUrl]);

  if (!imageUrl || imgError) {
    return <BoringFallback id={id} title={title} size={size} rounded={rounded} className={className} />;
  }

  const roundedClass = rounded === 'full' ? 'rounded-full' : 'rounded-sm';
  return (
    <div
      className={`overflow-hidden shrink-0 ${roundedClass} ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={resolveNetworkImageSrc(imageUrl)}
        alt={title || 'Network'}
        width={size}
        height={size}
        loading="lazy"
        className="w-full h-full object-cover"
        onError={() => setImgError(true)}
      />
    </div>
  );
}
