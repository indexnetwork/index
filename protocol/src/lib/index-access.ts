import db from './db';
import { indexes, indexMembers } from './schema';
import { eq, isNull, and, sql } from 'drizzle-orm';

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
    return { hasAccess: true, indexData, memberPermissions: ['can-write', 'can-read', 'can-view-files', 'can-match'] };
  }

  // Public access via link permissions
  if (indexData.linkPermissions && indexData.linkPermissions.permissions.length > 0) {
    return { hasAccess: true, indexData, memberPermissions: indexData.linkPermissions.permissions };
  }

  // Check if user is a member
  const membership = await db.select({ 
    userId: indexMembers.userId,
    permissions: indexMembers.permissions 
  }).from(indexMembers)
    .where(and(eq(indexMembers.indexId, indexId), eq(indexMembers.userId, userId)))
    .limit(1);

  if (membership.length === 0) {
    return { hasAccess: false, error: 'Access denied', status: 403 };
  }

  return { 
    hasAccess: true, 
    indexData, 
    memberPermissions: membership[0].permissions 
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

export const checkIndexPermission = async (
  indexId: string, 
  userId: string, 
  requiredPermission: string
): Promise<IndexAccessResult> => {
  const accessResult = await checkIndexAccess(indexId, userId);
  
  if (!accessResult.hasAccess) {
    return accessResult;
  }

  const hasPermission = accessResult.memberPermissions?.includes(requiredPermission) || false;
  
  if (!hasPermission) {
    return { 
      hasAccess: false, 
      error: `Permission denied: ${requiredPermission} required`, 
      status: 403 
    };
  }

  return accessResult;
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