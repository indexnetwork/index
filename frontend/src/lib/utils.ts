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