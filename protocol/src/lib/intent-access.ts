import db from './db';
import { intents, intentIndexes } from './schema';
import { eq, isNull, and, ne, inArray } from 'drizzle-orm';
import { checkMultipleIndexesMembership, getUserAccessibleIndexIds } from './index-access';

export interface AccessibleIntentsFilters {
  indexIds?: string[];     // Narrow to specific indexes (must be within accessible set)
  intentIds?: string[];    // Narrow to specific intents
  userIds?: string[];      // Narrow to specific users  
  includeOwnIntents?: boolean; // Default: false (exclude requesting user's intents)
}

export interface AccessibleIntentsResult {
  intents: Array<{
    id: string;
    payload: string;
    summary: string | null;
    isIncognito: boolean;
    createdAt: Date;
    updatedAt: Date;
    archivedAt: Date | null;
    userId: string;
  }>;
  validIndexIds: string[];  // Indexes actually used in query
  appliedFilters: AccessibleIntentsFilters; // What filters were actually applied
}

/**
 * Generic function to get intents accessible to a user with optional filtering.
 * This enforces the security boundary: users can only see intents in indexes they have access to.
 * Filters can only narrow the scope, never expand it.
 */
export async function getAccessibleIntents(
  requestingUserId: string, 
  filters?: AccessibleIntentsFilters
): Promise<AccessibleIntentsResult> {
  
  const appliedFilters: AccessibleIntentsFilters = {
    includeOwnIntents: false,
    ...filters
  };

  // Step 1: Get user's accessible indexes (security boundary)
  let validIndexIds: string[];
  
  if (appliedFilters.indexIds && appliedFilters.indexIds.length > 0) {
    // Validate explicitly provided indexIds - can only narrow, not expand
    const accessCheck = await checkMultipleIndexesMembership(appliedFilters.indexIds, requestingUserId);
    if (!accessCheck.hasAccess) {
      // Return empty result if user doesn't have access to requested indexes
      return {
        intents: [],
        validIndexIds: [],
        appliedFilters
      };
    }
    validIndexIds = accessCheck.validIndexIds;
  } else {
    // Use all indexes the user has access to by default (secure-by-default)
    validIndexIds = await getUserAccessibleIndexIds(requestingUserId);
  }

  // If user has no accessible indexes, return empty results
  if (validIndexIds.length === 0) {
    return {
      intents: [],
      validIndexIds: [],
      appliedFilters
    };
  }

  // Step 2: Build base query conditions
  const conditions = [
    isNull(intents.archivedAt),           // Only unarchived intents
    eq(intents.isIncognito, false),       // Only non-incognito intents
    inArray(intentIndexes.indexId, validIndexIds) // Only in accessible indexes
  ];

  // Step 3: Apply user filtering
  if (!appliedFilters.includeOwnIntents) {
    conditions.push(ne(intents.userId, requestingUserId)); // Exclude own intents
  }

  // Step 4: Apply additional filters (narrowing only)
  if (appliedFilters.userIds && appliedFilters.userIds.length > 0) {
    conditions.push(inArray(intents.userId, appliedFilters.userIds));
  }

  if (appliedFilters.intentIds && appliedFilters.intentIds.length > 0) {
    conditions.push(inArray(intents.id, appliedFilters.intentIds));
  }

  // Step 5: Execute query
  const accessibleIntents = await db.select({
    id: intents.id,
    payload: intents.payload,
    summary: intents.summary,
    isIncognito: intents.isIncognito,
    createdAt: intents.createdAt,
    updatedAt: intents.updatedAt,
    archivedAt: intents.archivedAt,
    userId: intents.userId
  })
  .from(intents)
  .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
  .where(and(...conditions));

  return {
    intents: accessibleIntents,
    validIndexIds,
    appliedFilters
  };
}
