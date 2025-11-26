import db from './db';
import { indexMembers, indexes } from './schema';
import { eq, and } from 'drizzle-orm';
import { Events } from './events';
import { log } from './log';

export interface AddMemberOptions {
  indexId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  prompt?: string | null;
  autoAssign?: boolean;
  metadata?: Record<string, any> | null;
}

export interface AddMemberResult {
  success: boolean;
  member?: any;
  alreadyMember?: boolean;
  error?: string;
}

/**
 * Centralized function to add a member to an index.
 * Handles checking for existing membership, inserting the record, and triggering events.
 */
export async function addMemberToIndex(options: AddMemberOptions): Promise<AddMemberResult> {
  const { indexId, userId, role, prompt, autoAssign = true, metadata } = options;

  try {
    // Check if user is already a member
    const existingMember = await db.select()
      .from(indexMembers)
      .where(and(
        eq(indexMembers.indexId, indexId),
        eq(indexMembers.userId, userId)
      ))
      .limit(1);

    if (existingMember.length > 0) {
      return {
        success: true,
        member: existingMember[0],
        alreadyMember: true
      };
    }

    // If prompt is not provided, fetch index prompt to use as default
    let memberPrompt = prompt;
    if (memberPrompt === undefined) {
      const indexData = await db.select({ prompt: indexes.prompt })
        .from(indexes)
        .where(eq(indexes.id, indexId))
        .limit(1);
      memberPrompt = indexData[0]?.prompt || null;
    }

    // Insert new member
    const finalPermissions = role === 'owner' ? ['owner'] : role === 'admin' ? ['admin', 'member'] : ['member'];

    await db.insert(indexMembers).values({
      indexId,
      userId,
      permissions: finalPermissions,
      prompt: memberPrompt || null,
      autoAssign,
      metadata: metadata || null
    });

    // Fetch the newly created member to return
    const newMember = await db.select()
      .from(indexMembers)
      .where(and(
        eq(indexMembers.indexId, indexId),
        eq(indexMembers.userId, userId)
      ))
      .limit(1);

    // Trigger indexing event (fire-and-forget to avoid coupling membership to indexing)
    Events.Member.onSettingsUpdated({
      userId,
      indexId,
      promptChanged: false,
      autoAssignChanged: true // Always true for new members with autoAssign=true
    }).catch(err => {
      log.error('Failed to trigger member indexing', { 
        userId, 
        indexId, 
        error: err instanceof Error ? err.message : String(err) 
      });
    });

    return {
      success: true,
      member: newMember[0],
      alreadyMember: false
    };

  } catch (error) {
    log.error('Failed to add member to index', {
      indexId,
      userId,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
