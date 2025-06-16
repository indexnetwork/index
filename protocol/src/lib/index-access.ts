import db from './db';
import { indexes, indexMembers } from './schema';
import { eq, isNull, and } from 'drizzle-orm';

export interface IndexAccessResult {
  hasAccess: boolean;
  error?: string;
  status?: number;
  indexData?: {
    id: string;
    userId: string;
    isPublic: boolean;
  };
}

export const checkIndexAccess = async (indexId: string, userId: string): Promise<IndexAccessResult> => {
  const index = await db.select({
    id: indexes.id,
    userId: indexes.userId,
    isPublic: indexes.isPublic
  }).from(indexes)
    .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
    .limit(1);

  if (index.length === 0) {
    return { hasAccess: false, error: 'Index not found', status: 404 };
  }

  const indexData = index[0];
  const hasAccess = indexData.isPublic || indexData.userId === userId;

  if (!hasAccess) {
    // Check if user is a member
    const membership = await db.select({ userId: indexMembers.userId })
      .from(indexMembers)
      .where(and(eq(indexMembers.indexId, indexId), eq(indexMembers.userId, userId)))
      .limit(1);

    if (membership.length === 0) {
      return { hasAccess: false, error: 'Access denied', status: 403 };
    }
  }

  return { hasAccess: true, indexData };
};

export const checkIndexOwnership = async (indexId: string, userId: string): Promise<IndexAccessResult> => {
  const index = await db.select({ id: indexes.id, userId: indexes.userId })
    .from(indexes)
    .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
    .limit(1);

  if (index.length === 0) {
    return { hasAccess: false, error: 'Index not found', status: 404 };
  }

  if (index[0].userId !== userId) {
    return { hasAccess: false, error: 'Access denied', status: 403 };
  }

  return { hasAccess: true, indexData: { ...index[0], isPublic: false } };
}; 