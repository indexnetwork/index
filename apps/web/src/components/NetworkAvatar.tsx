import { useState } from 'react';
import Avatar from 'boring-avatars';
import { resolveNetworkImageSrc } from '@/lib/network-image';

interface NetworkAvatarProps {
  id?: string;
  title?: string;
  imageUrl?: string | null;
  size: number;
  className?: string;
  rounded?: 'full' | 'sm';
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

/**
 * Renders the network image, falling back to the generated avatar when it
 * fails to load. Mounted with `key={imageUrl}` so a new image clears the
 * previous failure instead of needing an effect to reset it.
 */
function NetworkImage({ id, title, imageUrl, size, className, rounded }: NetworkAvatarProps & { imageUrl: string; className: string; rounded: 'full' | 'sm' }) {
  const [imgError, setImgError] = useState(false);

  if (imgError) {
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

export default function NetworkAvatar({ id, title, imageUrl, size, className = '', rounded = 'full' }: NetworkAvatarProps) {
  if (!imageUrl) {
    return <BoringFallback id={id} title={title} size={size} rounded={rounded} className={className} />;
  }

  return (
    <NetworkImage
      key={imageUrl}
      id={id}
      title={title}
      imageUrl={imageUrl}
      size={size}
      className={className}
      rounded={rounded}
    />
  );
}
