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
    userId: string;
    linkPermissions?: {
      permissions: string[];
      code: string;
    } | null;
  };
  memberPermissions?: string[];
}

// Core function that handles all access patterns
export async function getIndexWithPermissions(
  selector: { id: string } | { code: string },
  userId?: string
): Promise<IndexAccessResult> {
  // Get index
  const query = 'id' in selector 
    ? and(eq(indexes.id, selector.id), isNull(indexes.deletedAt))
    : and(isNull(indexes.deletedAt), sql`${indexes.linkPermissions}->>'code' = ${selector.code}`);
    
  const [index] = await db.select().from(indexes).where(query).limit(1);
  if (!index) return { hasAccess: false, error: 'Index not found', status: 404 };

  // Code-based access
  if ('code' in selector) {
    const permissions = index.linkPermissions?.permissions || [];
    if (permissions.length === 0) {
      return { hasAccess: false, error: 'Share link has no permissions', status: 403 };
    }
    return { hasAccess: true, indexData: index, memberPermissions: permissions };
  }

  // User-based access
  if (!userId) return { hasAccess: false, error: 'Auth required', status: 401 };
  
  // Check membership (including owner permission)
  const membership = await db.select({ permissions: indexMembers.permissions })
    .from(indexMembers)
    .where(and(
      eq(indexMembers.indexId, index.id),
      or(eq(indexMembers.userId, userId), eq(indexMembers.userId, EVERYONE_USER_ID))
    ));

  if (membership.length === 0) {
    return { hasAccess: false, error: 'Access denied', status: 403 };
  }

  const permissions = [...new Set(membership.flatMap(m => m.permissions || []))];
  
  // If user has owner permission, grant all permissions
  if (permissions.includes('owner')) {
    return { 
      hasAccess: true, 
      indexData: index, 
      memberPermissions: ['owner', 'can-write', 'can-read', 'can-view-files', 'can-discover', 'can-write-intents'] 
    };
  }
  
  return { hasAccess: true, indexData: index, memberPermissions: permissions };
}

export const checkIndexAccess = (indexId: string, userId: string) => 
  getIndexWithPermissions({ id: indexId }, userId);

export const checkIndexOwnership = async (indexId: string, userId: string): Promise<IndexAccessResult> => {
  const result = await getIndexWithPermissions({ id: indexId }, userId);
  if (!result.hasAccess || !result.memberPermissions?.includes('owner')) {
    return { hasAccess: false, error: 'Access denied', status: 403 };
  }
  return result;
};

export interface MultipleIndexAccessResult {
  hasAccess: boolean;
  validIndexIds: string[];
  invalidIds: string[];
  error?: string;
}

// Helper to check specific permissions
const hasPermissions = (userPermissions: string[] = [], required: string[]): boolean =>
  userPermissions.includes('owner') || required.some(p => userPermissions.includes(p));

export const checkIndexIntentWriteAccess = async (indexId: string, userId: string): Promise<IndexAccessResult> => {
  const result = await checkIndexAccess(indexId, userId);
  if (!result.hasAccess) return result;

  const canWrite = hasPermissions(result.memberPermissions, ['can-write', 'can-write-intents']);
  if (!canWrite) {
    return { hasAccess: false, error: 'Intent write access denied', status: 403, indexData: result.indexData };
  }
  return result;
};

// Generic bulk access checker
async function checkBulkAccess(
  indexIds: string[], 
  userId: string, 
  checkFn: (id: string, userId: string) => Promise<IndexAccessResult>,
  errorMsg: string
): Promise<MultipleIndexAccessResult> {
  if (indexIds.length === 0) return { hasAccess: true, validIndexIds: [], invalidIds: [] };

  const results = await Promise.all(indexIds.map(async id => ({ 
    id, 
    result: await checkFn(id, userId) 
  })));

  const validIndexIds = results.filter(r => r.result.hasAccess).map(r => r.id);
  const invalidIds = results.filter(r => !r.result.hasAccess).map(r => r.id);

  return {
    hasAccess: invalidIds.length === 0,
    validIndexIds,
    invalidIds,
    error: invalidIds.length > 0 ? errorMsg : undefined
  };
}

export const checkMultipleIndexesIntentWriteAccess = (indexIds: string[], userId: string) =>
  checkBulkAccess(indexIds, userId, checkIndexIntentWriteAccess, 'Some index IDs are invalid or you don\'t have intent write access to them');

export const checkMultipleIndexesReadAccess = async (indexIds: string[], userId: string): Promise<MultipleIndexAccessResult> => {
  const readCheckFn = async (id: string, userId: string) => {
    const result = await checkIndexAccess(id, userId);
    if (!result.hasAccess) return result;
    
    const canRead = hasPermissions(result.memberPermissions, ['can-read', 'can-write', 'can-write-intents', 'can-discover']);
    return canRead ? result : { hasAccess: false, error: 'Read access denied', status: 403 };
  };

  return checkBulkAccess(indexIds, userId, readCheckFn, 'Some index IDs are invalid or you don\'t have read access to them');
};

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

  const accessCheck = await checkMultipleIndexesReadAccess(requestedIndexIds, requestingUserId);
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