import { Ghost } from 'lucide-react';

interface GhostBadgeProps {
  className?: string;
}

/**
 * Ghost icon with tooltip explaining what a ghost user is.
 * Shown next to names of users who haven't joined Index yet.
 */
export default function GhostBadge({ className }: GhostBadgeProps) {
  return (
    <span className={`relative group inline-flex items-center${className ? ` ${className}` : ''}`}>
      <Ghost className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded-sm bg-gray-900 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        Not yet on Index
      </span>
    </span>
  );
}
