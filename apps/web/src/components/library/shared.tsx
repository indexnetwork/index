/**
 * Shared primitives for the entity component library.
 *
 * Every entity (premise, intent, opportunity, negotiation, question) ships in
 * three density variants built from these primitives:
 *   1. Full-width card  — primary surface (e.g. Signals page)
 *   2. Sidebar card     — contextual rail (e.g. intent page right sidebar)
 *   3. In-chat chip     — compact, clickable, text-flow-friendly reference
 *
 * Design language follows the PR #1169 Signals patterns: IBM Plex Mono for
 * meta/badges, Public Sans for body, #041729 primary, #4091BB accents,
 * pulsing emerald "live" indicator, and status-keyed border colors.
 */
import type { ReactNode } from 'react';
import { Calendar } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Relative timestamp ("3h ago") — mirrors NegotiationHistory.timeAgo. */
export function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Short absolute date ("Jul 14") used in meta rows. */
export function shortDate(dateStr: string): string | null {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export type PillTone = 'emerald' | 'amber' | 'red' | 'gray' | 'blue' | 'purple' | 'dark';

const PILL_TONE_CLASSES: Record<PillTone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-600 border-red-200',
  gray: 'bg-gray-100/60 text-gray-500 border-gray-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-100',
  purple: 'bg-purple-50 text-purple-700 border-purple-100',
  dark: 'bg-[#041729] text-white border-[#041729]',
};

interface PillProps {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
  title?: string;
}

/** Monospace status/label pill — the shared badge language across all entities. */
export function Pill({ tone = 'gray', children, className, title }: PillProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-ibm-plex-mono',
        PILL_TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Pulsing emerald dot — marks an actively-running entity (Signals pattern). */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn('relative flex h-1.5 w-1.5 shrink-0', className)} aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
    </span>
  );
}

/** "live" indicator = pulsing dot + label, as used on active signals. */
export function LiveIndicator({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 font-ibm-plex-mono',
        className,
      )}
    >
      <LiveDot />
      live
    </span>
  );
}

interface CountBadgeProps {
  count: number;
  label?: string;
  icon?: ReactNode;
  className?: string;
}

/** Solid blue "N to answer"-style count badge from the Signals shelf. */
export function CountBadge({ count, label = 'to answer', icon, className }: CountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[#4091BB] px-2.5 py-1 text-xs font-semibold text-white shadow-sm font-ibm-plex-mono',
        className,
      )}
    >
      {icon}
      {count} {label}
    </span>
  );
}

/** Calendar icon + short date meta item, in the IntentList meta-row style. */
export function MetaDate({ dateStr, className }: { dateStr: string; className?: string }) {
  const label = shortDate(dateStr);
  if (!label) return null;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-gray-500 font-ibm-plex-mono', className)}>
      <Calendar className="h-3 w-3" />
      {label}
    </span>
  );
}

const AVATAR_HUES = [210, 160, 20, 280, 340, 120];

/** Deterministic hue from a name so avatars are stable across renders. */
function hueFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length];
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface EntityAvatarProps {
  name: string;
  size?: number;
  className?: string;
}

/**
 * Self-contained initials avatar for the library. Production surfaces may
 * swap this for the app's UserAvatar (boring-avatars + storage URLs) without
 * changing the card layout contract.
 */
export function EntityAvatar({ name, size = 32, className }: EntityAvatarProps) {
  const hue = hueFor(name);
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.38)),
        background: `linear-gradient(135deg, hsl(${hue} 45% 42%), hsl(${(hue + 40) % 360} 45% 32%))`,
      }}
    >
      {initialsFor(name)}
    </span>
  );
}

interface LetterBadgeProps {
  letter: string;
  checked?: boolean;
  className?: string;
}

/** A/B/C letter circle from the question-option design language. */
export function LetterBadge({ letter, checked = false, className }: LetterBadgeProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
        checked ? 'bg-[#041729] text-white' : 'bg-gray-100 text-gray-500',
        className,
      )}
    >
      {letter}
    </span>
  );
}

/** A/B/C letter for an option index (0 → "A"). */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

interface ChipShellProps {
  icon: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
}

/**
 * Compact in-chat entity chip. Sits inline in text flow, is fully clickable,
 * and carries the entity icon + truncated label + optional trailing content.
 */
export function ChipShell({ icon, children, onClick, title, className }: ChipShellProps) {
  return (
    <span
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={title}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 align-middle text-xs text-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors',
        onClick && 'cursor-pointer hover:border-[#4091BB]/50 hover:bg-blue-50/40 focus:outline-none focus:ring-2 focus:ring-[#4091BB]/30',
        className,
      )}
    >
      <span className="flex shrink-0 items-center text-gray-400">{icon}</span>
      {children}
    </span>
  );
}

/** Truncating text span for chip labels. */
export function ChipLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('min-w-0 truncate font-medium', className)}>{children}</span>;
}
