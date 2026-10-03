import { useState } from 'react';
import { apiUrl } from '@/lib/api';

const PALETTE = ["#92A1C6", "#146A7C", "#F0AB3D", "#C271B4", "#C20D90"];

function hashSeed(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash << 5) - hash + name.charCodeAt(i);
  return Math.abs(hash | 0);
}

/** Square bauhaus tile. The library mask is a circle, and every face in the app is square. */
function SquareFace({ seed, size }: { seed: string; size: number }) {
  const SIZE = 80;
  const num = hashSeed(seed || "default");
  const color = (n: number) => PALETTE[Math.abs(n) % PALETTE.length];
  const unit = (n: number, range: number, index = 0) => {
    const value = n % range;
    return index && Math.floor((n / 10 ** index) % 10) % 2 === 0 ? -value : value;
  };
  const maskId = `ba-${num}-${size}`;
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={size} height={size} style={{ display: "block" }} aria-hidden>
      <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={SIZE} height={SIZE}>
        <rect width={SIZE} height={SIZE} fill="#fff" />
      </mask>
      <g mask={`url(#${maskId})`}>
        <rect width={SIZE} height={SIZE} fill={color(num)} />
        <rect x={(SIZE - 60) / 2} y={(SIZE - 20) / 2} width={SIZE} height={Math.floor(num / 100) % 2 ? SIZE : SIZE / 8} fill={color(num + 1)} transform={`translate(${unit(num * 2, SIZE / 2 - 18, 1)} ${unit(num * 2, SIZE / 2 - 18, 2)}) rotate(${unit(num * 2, 360)} ${SIZE / 2} ${SIZE / 2})`} />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 5} fill={color(num + 2)} transform={`translate(${unit(num * 3, SIZE / 2 - 19, 1)} ${unit(num * 3, SIZE / 2 - 19, 2)})`} />
        <line x1={0} y1={SIZE / 2} x2={SIZE} y2={SIZE / 2} strokeWidth={2} stroke={color(num + 3)} transform={`translate(${unit(num * 4, SIZE / 2 - 20, 1)} ${unit(num * 4, SIZE / 2 - 20, 2)}) rotate(${unit(num * 4, 360)} ${SIZE / 2} ${SIZE / 2})`} />
      </g>
    </svg>
  );
}

interface UserAvatarProps {
  id?: string;
  name?: string;
  avatar?: string | null;
  size: number;
  className?: string;
  blur?: boolean;
}

function resolveAvatarSrc(avatar: string): string {
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) {
    return avatar;
  }
  if (avatar.startsWith('/api/storage/')) {
    return apiUrl(avatar);
  }
  const cleanPath = avatar.startsWith('/') ? avatar.slice(1) : avatar;
  return apiUrl(`/api/storage/${cleanPath}`);
}

function BoringFallback({ id, name, size, className, blur }: Omit<UserAvatarProps, 'avatar'>) {
  return (
    <div
      className={`overflow-hidden flex-shrink-0${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, borderRadius: 0 }}
    >
      <div className={blur ? 'blur-[3px]' : undefined}>
        <SquareFace seed={id || name || 'default'} size={size} />
      </div>
    </div>
  );
}

export default function UserAvatar({ id, name, avatar, size, className, blur }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

  if (!avatar || imgError) {
    return <BoringFallback id={id} name={name} size={size} className={className} blur={blur} />;
  }

  return (
    <div
      className={`overflow-hidden flex-shrink-0${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, borderRadius: 0 }}
    >
      <img
        src={resolveAvatarSrc(avatar)}
        alt={name || 'User'}
        width={size}
        height={size}
        loading="lazy"
        className={`w-full h-full object-cover${blur ? ' blur-[3px]' : ''}`}
        style={{ borderRadius: 0, display: "block" }}
        onError={() => setImgError(true)}
      />
    </div>
  );
}
