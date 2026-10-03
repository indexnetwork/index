import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a date with a consistent format across the application
 * @param date - Date string, Date object, or timestamp
 * @returns Formatted date string (e.g., "Jan 15, 2024, 2:30 PM")
 */
export function formatDate(date: string | Date | number): string {
  return new Date(date).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Format an ISO timestamp as a relative day label suitable for chat dividers:
 * "Today", "Yesterday", or a short month-day string like "Apr 27".
 */
export function formatChatDayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }).toLowerCase();
}

export function formatChatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const clock = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  if (d.toDateString() === new Date().toDateString()) return clock;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' }).toLowerCase()}, ${clock}`;
}