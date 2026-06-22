/**
 * Common shared types used across the application
 */

// ISO 8601 Date string
export type ISODateString = string;

// UUID string
export type UUID = string;

/** Branded ID for type-safe entity references (keyed by Drizzle table name). */
export type Id<T extends string = string> = string & { readonly __table?: T };

// Pagination info
export interface PaginationInfo {
  current: number;
  total: number;
  count: number;
  totalCount: number;
}

// Generic paginated response
export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationInfo;
}
