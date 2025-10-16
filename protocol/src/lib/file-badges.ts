/**
 * File Badge Utilities
 * 
 * Centralized file category badge logic that uses the shared uploads.config.ts
 * for consistent file type handling across the application.
 */

import { getFileCategoryBadge as getCategoryBadge } from './uploads.config';

/**
 * Get file category badge for display purposes
 * This is a re-export of the function from uploads.config.ts for convenience
 */
export const getFileCategoryBadge = getCategoryBadge;

/**
 * Legacy alias for backward compatibility
 */
export const fileBadge = getCategoryBadge;
