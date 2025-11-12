import db from './db';
import { indexes, indexMembers } from './schema';
import { eq, isNull, and, sql, or } from 'drizzle-orm';

export const EVERYONE_USER_ID = '00000000-0000-0000-0000-000000000000';

export interface IndexAccessResult {
  hasAccess: boolean;
  error?: string;
  status?: number;
  indexData?: {
    id: string;
    prompt?: string | null;
    permissions?: {
      joinPolicy: 'anyone' | 'invite_only';
      invitationLink: {
        code: string;
      } | null;
      allowGuestVibeCheck: boolean;
    } | null;
  };
  memberPermissions?: string[];
}

export interface InvitationCodeValidationResult {
  valid: boolean;
  indexId?: string;
  indexData?: {
    id: string;
    title?: string;
    prompt?: string | null;
    permissions?: {
      joinPolicy: 'anyone' | 'invite_only';
      invitationLink: {
        code: string;
      } | null;
      allowGuestVibeCheck: boolean;
    } | null;
  };
  error?: string;
  status?: number;
}

export interface UserAccessResult {
  hasAccess: boolean;
  permissions: string[];
  indexData?: {
    id: string;
    prompt?: string | null;
  };
  error?: string;
  status?: number;
}

/**
 * Validates an invitation code for an index.
 * This function ONLY validates the code and returns index information.
 * It does NOT check user membership or return user permissions.
 * 
 * Security: Does not accept index ID as code (only actual invitation codes).
 * 
 * @param code - The invitation code to validate
 * @returns Validation result with index data if valid
 */
export async function validateInvitationCode(code: string): Promise<InvitationCodeValidationResult> {
  // Query only by invitation code, NOT by index ID (security fix)
  const query = and(
    isNull(indexes.deletedAt),
    sql`${indexes.permissions}->'invitationLink'->>'code' = ${code}`
  );

  const [index] = await db.select().from(indexes).where(query).limit(1);
  
  if (!index) {
    return { 
      valid: false, 
      error: 'Invalid invitation code', 
      status: 404 
    };
  }

  const indexPermissions = index.permissions;

  // Validate based on join policy
  if (indexPermissions?.joinPolicy === 'anyone') {
    // Public index with valid code
    return { 
      valid: true, 
      indexId: index.id,
      indexData: index 
    };
  }

  if (indexPermissions?.invitationLink && indexPermissions.joinPolicy === 'invite_only') {
    // Private index with valid invitation link
    return { 
      valid: true, 
      indexId: index.id,
      indexData: index 
    };
  }

  return { 
    valid: false, 
    error: 'Invalid invitation link', 
    status: 403 
  };
}

/**
 * Checks if a user has access to an index and returns their actual permissions.
 * This function queries the indexMembers table for real membership data.
 * Always requires authentication.
 * 
 * @param indexId - The index ID to check access for
 * @param userId - The authenticated user ID
 * @returns User access result with actual permissions from database
 */
export async function checkUserIndexAccess(indexId: string, userId: string): Promise<UserAccessResult> {
  // Verify index exists and is not deleted
  const [index] = await db.select({
    id: indexes.id,
    prompt: indexes.prompt
  })
  .from(indexes)
  .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
  .limit(1);

  if (!index) {
    return { 
      hasAccess: false, 
      permissions: [],
      error: 'Index not found', 
      status: 404 
    };
  }

  // Check actual membership in database
  const membership = await db.select({ permissions: indexMembers.permissions })
    .from(indexMembers)
    .where(and(
      eq(indexMembers.indexId, indexId),
      or(eq(indexMembers.userId, userId), eq(indexMembers.userId, EVERYONE_USER_ID))
    ));

  if (membership.length === 0) {
    return { 
      hasAccess: false, 
      permissions: [],
      error: 'Access denied', 
      status: 403 
    };
  }

  const permissions = [...new Set(membership.flatMap(m => m.permissions || []))];

  return { 
    hasAccess: true, 
    permissions,
    indexData: index
  };
}




export const checkIndexOwnership = async (indexId: string, userId: string): Promise<IndexAccessResult> => {
  const result = await checkUserIndexAccess(indexId, userId);
  if (!result.hasAccess || !result.permissions.includes('owner')) {
    return { hasAccess: false, error: 'Access denied', status: 403 };
  }
  // Convert UserAccessResult to IndexAccessResult for backward compatibility
  return {
    hasAccess: true,
    indexData: result.indexData,
    memberPermissions: result.permissions
  };
};

/**
 * Checks if a user has admin or owner access to an index.
 * This is used for member management operations where admins should also have access.
 */
export const checkIndexAdminAccess = async (indexId: string, userId: string): Promise<IndexAccessResult> => {
  const result = await checkUserIndexAccess(indexId, userId);
  if (!result.hasAccess || (!result.permissions.includes('owner') && !result.permissions.includes('admin'))) {
    return { hasAccess: false, error: 'Access denied', status: 403 };
  }
  // Convert UserAccessResult to IndexAccessResult for backward compatibility
  return {
    hasAccess: true,
    indexData: result.indexData,
    memberPermissions: result.permissions
  };
};

export interface MultipleIndexAccessResult {
  hasAccess: boolean;
  validIndexIds: string[];
  invalidIds: string[];
  error?: string;
}

export async function checkMultipleIndexesMembership(
  indexIds: string[], 
  userId: string
): Promise<MultipleIndexAccessResult> {
  if (indexIds.length === 0) return { hasAccess: true, validIndexIds: [], invalidIds: [] };

  const results = await Promise.all(indexIds.map(async id => ({ 
    id, 
    result: await checkUserIndexAccess(id, userId) 
  })));

  const validIndexIds = results.filter(r => r.result.hasAccess).map(r => r.id);
  const invalidIds = results.filter(r => !r.result.hasAccess).map(r => r.id);

  return {
    hasAccess: invalidIds.length === 0,
    validIndexIds,
    invalidIds,
    error: invalidIds.length > 0 ? 'Some index IDs are invalid or you don\'t have membership access to them' : undefined
  };
}

export const getUserAccessibleIndexIds = async (userId: string): Promise<string[]> => {
  const member = await db.select({ indexId: indexMembers.indexId })
    .from(indexMembers)
    .innerJoin(indexes, eq(indexMembers.indexId, indexes.id))
    .where(and(
      or(eq(indexMembers.userId, userId), eq(indexMembers.userId, EVERYONE_USER_ID)),
      isNull(indexes.deletedAt)
    ));

  return [...new Set(member.map(i => i.indexId))];
};

export async function validateAndGetAccessibleIndexIds(
  requestingUserId: string,
  requestedIndexIds?: string[]
): Promise<{
  validIndexIds: string[];
  error?: { status: number; message: string; invalidIds?: string[] };
}> {
  if (!requestedIndexIds?.length) {
    return { validIndexIds: await getUserAccessibleIndexIds(requestingUserId) };
  }

  const accessCheck = await checkMultipleIndexesMembership(requestedIndexIds, requestingUserId);
  return accessCheck.hasAccess 
    ? { validIndexIds: accessCheck.validIndexIds }
    : {
        validIndexIds: [],
        error: {
          status: 403,
          message: accessCheck.error || 'Access denied to some indexes',
          invalidIds: accessCheck.invalidIds
        }
      };
}

/**
 * Validates that an index has at least one owner
 */
export async function validateIndexHasOwner(indexId: string): Promise<boolean> {
  const owners = await db.select({ userId: indexMembers.userId })
    .from(indexMembers)
    .where(and(
      eq(indexMembers.indexId, indexId),
      sql`'owner' = ANY(${indexMembers.permissions})`
    ));
    
  return owners.length > 0;
}

/**
 * Checks if removing/updating a user's permissions would leave the index without an owner
 */
export async function validateOwnershipChange(
  indexId: string, 
  targetUserId: string, 
  newPermissions: string[]
): Promise<{ canChange: boolean; error?: string }> {
  // If new permissions include owner, change is safe
  if (newPermissions.includes('owner')) {
    return { canChange: true };
  }

  // Check if this user is currently an owner
  const currentMembership = await db.select({ permissions: indexMembers.permissions })
    .from(indexMembers)
    .where(and(
      eq(indexMembers.indexId, indexId),
      eq(indexMembers.userId, targetUserId)
    ))
    .limit(1);

  if (currentMembership.length === 0 || !currentMembership[0].permissions?.includes('owner')) {
    // User is not currently an owner, change is safe
    return { canChange: true };
  }

  // User is currently an owner, check if there are other owners
  const otherOwners = await db.select({ userId: indexMembers.userId })
    .from(indexMembers)
    .where(and(
      eq(indexMembers.indexId, indexId),
      sql`'owner' = ANY(${indexMembers.permissions})`,
      sql`${indexMembers.userId} != ${targetUserId}`
    ));

  if (otherOwners.length === 0) {
    return { 
      canChange: false, 
      error: 'Cannot remove the last owner from an index. Transfer ownership to another user first.' 
    };
  }

  return { canChange: true };
} 