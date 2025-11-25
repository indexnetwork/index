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
    const permissions = role === 'owner' ? ['owner'] : role === 'admin' ? ['admin', 'member'] : ['member'];
    
    // Ensure permissions array is correct based on schema usage in other files
    // In indexes.ts: permissions: ['owner'] or ['member']
    // It seems 'admin' might not be fully used or is just 'admin', 'member' combo?
    // Let's stick to what was passed or simple mapping.
    // The previous code used: permissions: ['member'] or permissions: ['owner']
    // Let's use the passed role to determine permissions array.
    // If role is 'owner', permissions is ['owner'].
    // If role is 'member', permissions is ['member'].
    // If role is 'admin', permissions is ['admin', 'member'] (common pattern) or just ['admin']?
    // Looking at indexes.ts, it allows passing arbitrary strings in array.
    // For safety, let's just wrap the role in an array if it's a single string, 
    // but the type says role is one of the strings.
    // Actually, let's just use [role] as the base, but maybe we want to allow passing the full array?
    // For now, let's simplify: if role is 'owner', use ['owner']. If 'member', use ['member'].
    // If 'admin', use ['admin', 'member'] to be safe? 
    // Let's look at how it was done in indexes.ts:
    // router.post('/:id/members') takes body('permissions').isArray()
    // router.post('/:id/join') uses ['member']
    // router.post('/', create index) uses ['owner']
    
    // I will use a simple mapping for now.
    const finalPermissions = role === 'owner' ? ['owner'] : [role];

    await db.insert(indexMembers).values({
      indexId,
      userId,
      permissions: finalPermissions,
      prompt: memberPrompt || null,
      autoAssign,
      metadata: metadata || null
    });

    // Trigger indexing event
    await Events.Member.onSettingsUpdated({
      userId,
      indexId,
      promptChanged: false,
      autoAssignChanged: true // Always true for new members with autoAssign=true
    });

    // Fetch the newly created member to return
    const newMember = await db.select()
      .from(indexMembers)
      .where(and(
        eq(indexMembers.indexId, indexId),
        eq(indexMembers.userId, userId)
      ))
      .limit(1);

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
