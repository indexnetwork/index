import db from '../db';
import { indexMembers } from '../schema';
import { eq, and } from 'drizzle-orm';
import { log } from '../log';
import { addMemberToIndex } from '../index-members';

/**
 * Ensures a user is a member of the specified index.
 * If not already a member, adds them with basic permissions.
 */
export async function ensureIndexMembership(userId: string, indexId: string): Promise<void> {
  try {
    // Check if user is already a member
    const existingMember = await db.select()
      .from(indexMembers)
      .where(and(
        eq(indexMembers.userId, userId),
        eq(indexMembers.indexId, indexId)
      ))
      .limit(1);

    if (existingMember.length === 0) {
      // Add user as index member with basic permissions
      await addMemberToIndex({
        indexId,
        userId,
        role: 'member',
        autoAssign: true
      });
      log.info('Added integration user as index member', { userId, indexId });
    }
  } catch (error) {
    log.error('Failed to add user as index member', { 
      userId, 
      indexId, 
      error: error instanceof Error ? error.message : String(error) 
    });
    // Don't throw - continue processing even if membership fails
  }
}
