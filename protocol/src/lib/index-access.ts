import db from './db';
import { indexes, indexMembers } from './schema';
import { eq, isNull, and, sql, or } from 'drizzle-orm';

// Special UUID for "everyone" public access
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

export const checkIndexAccess = async (indexId: string, userId: string): Promise<IndexAccessResult> => {
  const index = await db.select({
    id: indexes.id,
    userId: indexes.userId,
    linkPermissions: indexes.linkPermissions
  }).from(indexes)
    .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
    .limit(1);

  if (index.length === 0) {
    return { hasAccess: false, error: 'Index not found', status: 404 };
  }

  const indexData = index[0];
  
  // Owner always has access
  if (indexData.userId === userId) {
    return { hasAccess: true, indexData, memberPermissions: ['can-write', 'can-read', 'can-view-files', 'can-discover', 'can-write-intents'] };
  }

  // Check if user is a member OR if "everyone" has permissions
  const membership = await db.select({ 
    userId: indexMembers.userId,
    permissions: indexMembers.permissions 
  }).from(indexMembers)
    .where(and(
      eq(indexMembers.indexId, indexId), 
      or(eq(indexMembers.userId, userId), eq(indexMembers.userId, EVERYONE_USER_ID))
    ));

  if (membership.length === 0) {
    return { hasAccess: false, error: 'Access denied', status: 403 };
  }

  // Combine user permissions with "everyone" permissions
  const userMembership = membership.find(m => m.userId === userId);
  const everyoneMembership = membership.find(m => m.userId === EVERYONE_USER_ID);
  
  const combinedPermissions = [
    ...(userMembership?.permissions || []),
    ...(everyoneMembership?.permissions || [])
  ];
  
  // Remove duplicates
  const uniquePermissions = [...new Set(combinedPermissions)];

  return { 
    hasAccess: true, 
    indexData, 
    memberPermissions: uniquePermissions 
  };
};

export const checkIndexOwnership = async (indexId: string, userId: string): Promise<IndexAccessResult> => {
  const index = await db.select({ 
    id: indexes.id, 
    userId: indexes.userId,
    linkPermissions: indexes.linkPermissions
  }).from(indexes)
    .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
    .limit(1);

  if (index.length === 0) {
    return { hasAccess: false, error: 'Index not found', status: 404 };
  }

  if (index[0].userId !== userId) {
    return { hasAccess: false, error: 'Access denied', status: 403 };
  }

  return { 
    hasAccess: true, 
    indexData: { 
      ...index[0], 
      linkPermissions: index[0].linkPermissions
    } 
  };
};

export const checkIndexAccessByCode = async (code: string): Promise<IndexAccessResult> => {
  // Use SQL JSON operator to find index by code efficiently
  const index = await db.select({
    id: indexes.id,
    userId: indexes.userId,
    linkPermissions: indexes.linkPermissions
  }).from(indexes)
    .where(and(
      isNull(indexes.deletedAt),
      sql`${indexes.linkPermissions}->>'code' = ${code}`
    ))
    .limit(1);

  if (index.length === 0) {
    return { hasAccess: false, error: 'Invalid share code', status: 404 };
  }

  const indexData = index[0];

  if (!indexData.linkPermissions || indexData.linkPermissions.permissions.length === 0) {
    return { hasAccess: false, error: 'Share link has no permissions', status: 403 };
  }

  return { 
    hasAccess: true, 
    indexData, 
    memberPermissions: indexData.linkPermissions.permissions 
  };
};

export interface MultipleIndexAccessResult {
  hasAccess: boolean;
  validIndexIds: string[];
  invalidIds: string[];
  error?: string;
}

/**
 * Check if user has write access to a single index
 */
export const checkIndexWriteAccess = async (indexId: string, userId: string): Promise<IndexAccessResult> => {
  const accessCheck = await checkIndexAccess(indexId, userId);
  console.log('accessCheck', accessCheck);
  if (!accessCheck.hasAccess) {
    return accessCheck;
  }

  if (!accessCheck.memberPermissions?.includes('can-write')) {
    return { 
      hasAccess: false, 
      error: 'Write access denied', 
      status: 403,
      indexData: accessCheck.indexData
    };
  }

  return accessCheck;
};

/**
 * Check if user has intent write access to a single index
 */
export const checkIndexIntentWriteAccess = async (indexId: string, userId: string): Promise<IndexAccessResult> => {
  const accessCheck = await checkIndexAccess(indexId, userId);
  if (!accessCheck.hasAccess) {
    return accessCheck;
  }

  // Check for either general write access or specific intent write access
  const hasWriteAccess = accessCheck.memberPermissions?.includes('can-write') || 
                        accessCheck.memberPermissions?.includes('can-write-intents');

  if (!hasWriteAccess) {
    return { 
      hasAccess: false, 
      error: 'Intent write access denied', 
      status: 403,
      indexData: accessCheck.indexData
    };
  }

  return accessCheck;
};

/**
 * Check if user has write access to multiple indexes
 * Returns lists of valid and invalid index IDs
 */
export const checkMultipleIndexesWriteAccess = async (indexIds: string[], userId: string): Promise<MultipleIndexAccessResult> => {
  if (indexIds.length === 0) {
    return { hasAccess: true, validIndexIds: [], invalidIds: [] };
  }

  const validIndexIds: string[] = [];
  const invalidIds: string[] = [];

  for (const indexId of indexIds) {
    const accessCheck = await checkIndexWriteAccess(indexId, userId);

    if (accessCheck.hasAccess) {
      validIndexIds.push(indexId);
    } else {
      invalidIds.push(indexId);
    }
  }

  return {
    hasAccess: invalidIds.length === 0,
    validIndexIds,
    invalidIds,
    error: invalidIds.length > 0 ? 'Some index IDs are invalid or you don\'t have write access to them' : undefined
  };
};

/**
 * Check if user has intent write access to multiple indexes
 * Returns lists of valid and invalid index IDs
 */
export const checkMultipleIndexesIntentWriteAccess = async (indexIds: string[], userId: string): Promise<MultipleIndexAccessResult> => {
  if (indexIds.length === 0) {
    return { hasAccess: true, validIndexIds: [], invalidIds: [] };
  }

  const validIndexIds: string[] = [];
  const invalidIds: string[] = [];

  for (const indexId of indexIds) {
    const accessCheck = await checkIndexIntentWriteAccess(indexId, userId);

    if (accessCheck.hasAccess) {
      validIndexIds.push(indexId);
    } else {
      invalidIds.push(indexId);
    }
  }

  return {
    hasAccess: invalidIds.length === 0,
    validIndexIds,
    invalidIds,
    error: invalidIds.length > 0 ? 'Some index IDs are invalid or you don\'t have intent write access to them' : undefined
  };
}; 