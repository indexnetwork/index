import db from './db';
import { users } from './schema';
import { eq } from 'drizzle-orm';
import { log } from './log';
import type { IntegrationName } from './integrations/config';
import { privyClient } from './privy';

export interface ExtractedUser {
  email: string;
  name: string;
  provider: IntegrationName;
  providerId: string;
  privyId: string;
  avatar?: string;
}

export interface CreatedUser {
  id: string;
  privyId: string;
  email: string;
  name: string;
  isNewUser: boolean;
}

// Extraction functions moved to their respective providers

/**
 * Save or find a single user - similar to saveIntent pattern
 */
export async function saveUser(extractedUser: ExtractedUser): Promise<CreatedUser> {
  try {
    // First check if user already exists in our database using privyId as control key
    const existingUser = await db
      .select({
        id: users.id,
        privyId: users.privyId,
        email: users.email,
        name: users.name
      })
      .from(users)
      .where(eq(users.privyId, extractedUser.privyId))
      .limit(1);
    
    if (existingUser.length > 0) {
      const user = existingUser[0];
      return {
        id: user.id,
        privyId: user.privyId,
        email: user.email,
        name: user.name,
        isNewUser: false
      };
    }
    
    // Create user in our database
    log.info('Creating user in database', { 
      email: extractedUser.email,
      provider: extractedUser.provider,
      privyId: extractedUser.privyId
    });
    
    const newUser = await db
      .insert(users)
      .values({
        privyId: extractedUser.privyId,
        email: extractedUser.email,
        name: extractedUser.name,
        intro: null,
        avatar: extractedUser.avatar || null
      })
      .returning({
        id: users.id,
        privyId: users.privyId,
        email: users.email,
        name: users.name
      });
    
    const user = newUser[0];
    log.info('Successfully created user', { 
      userId: user.id,
      email: user.email,
      provider: extractedUser.provider 
    });
    
    return {
      id: user.id,
      privyId: user.privyId,
      email: user.email,
      name: user.name,
      isNewUser: true
    };
    
  } catch (error) {
    log.error('Failed to create user', { 
      email: extractedUser.email,
      provider: extractedUser.provider,
      error: error instanceof Error ? error.message : String(error) 
    });
    
    // If it's a duplicate privyId error, try to find the existing user
    if (error instanceof Error && error.message.includes('23505')) {
      const existingUser = await db
        .select({
          id: users.id,
          privyId: users.privyId,
          email: users.email,
          name: users.name
        })
        .from(users)
        .where(eq(users.privyId, extractedUser.privyId))
        .limit(1);
      
      if (existingUser.length > 0) {
        const user = existingUser[0];
        return {
          id: user.id,
          privyId: user.privyId,
          email: user.email,
          name: user.name,
          isNewUser: false
        };
      }
    }
    
    throw error;
  }
}

// User resolver functions for different integration providers - always return user object

export async function resolveSlackUser(email: string, slackUserId: string, name: string, avatar?: string): Promise<CreatedUser | undefined> {
  try {
    // Try to find existing user by email first
    const existingUser = await db
      .select({
        id: users.id,
        privyId: users.privyId,
        email: users.email,
        name: users.name,
        avatar: users.avatar
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    
    if (existingUser.length > 0) {
      // User exists, check if we need to update avatar or name
      const user = existingUser[0];
      
      // Check if we need to update empty fields
      const needsUpdate = (!user.name || user.name.trim() === '') || 
                         (avatar && !user.avatar);
      
      if (needsUpdate) {
        const updateData: any = {};
        if (!user.name || user.name.trim() === '') {
          updateData.name = name;
        }
        if (avatar && !user.avatar) {
          updateData.avatar = avatar;
        }
        
        if (Object.keys(updateData).length > 0) {
          updateData.updatedAt = new Date();
          
          const updatedUser = await db
            .update(users)
            .set(updateData)
            .where(eq(users.id, user.id))
            .returning({
              id: users.id,
              privyId: users.privyId,
              email: users.email,
              name: users.name
            });
          
          if (updatedUser.length > 0) {
            log.info('Updated existing Slack user with missing data', { 
              email, 
              slackUserId, 
              userId: user.id,
              updatedFields: Object.keys(updateData)
            });
            
            return {
              id: updatedUser[0].id,
              privyId: updatedUser[0].privyId,
              email: updatedUser[0].email,
              name: updatedUser[0].name,
              isNewUser: false
            };
          }
        }
      }
      
      log.info('Slack user already exists', { email, slackUserId, userId: user.id });
      
      return {
        id: user.id,
        privyId: user.privyId,
        email: user.email,
        name: user.name,
        isNewUser: false
      };
    }
    
    // User doesn't exist, create new user via Privy SDK
    const privyUser = await privyClient.importUser({
      linkedAccounts: [
        {
          type: 'email',
          address: email,
        },
      ],
      customMetadata: {
        provider: 'slack',
        providerId: slackUserId,
        name: name
      },
      createEthereumWallet: true
    });
    
    // Save user to database using the agnostic saveUser function
    const createdUser = await saveUser({
      email,
      name,
      provider: 'slack',
      providerId: slackUserId,
      privyId: privyUser.id,
      avatar
    });
    
    return createdUser;
  } catch (error) {
    log.error('Failed to resolve Slack user', { email, slackUserId, error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

export async function resolveDiscordUser(email: string, discordUserId: string, name: string): Promise<CreatedUser | undefined> {
  try {
    // Try to find existing user by email first
    const existingUser = await db
      .select({
        id: users.id,
        privyId: users.privyId,
        email: users.email,
        name: users.name
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    
    if (existingUser.length > 0) {
      // User exists, return existing user data
      const user = existingUser[0];
      log.info('Discord user already exists', { email, discordUserId, userId: user.id });
      
      return {
        id: user.id,
        privyId: user.privyId,
        email: user.email,
        name: user.name,
        isNewUser: false
      };
    }
    
    // User doesn't exist, create new user via Privy SDK
    const privyUser = await privyClient.importUser({
      linkedAccounts: [
        {
          type: 'email',
          address: email,
        },
      ],
      customMetadata: {
        provider: 'discord',
        providerId: discordUserId,
        name: name
      },
      createEthereumWallet: true
    });
    
    // Save user to database using the agnostic saveUser function
    const createdUser = await saveUser({
      email,
      name,
      provider: 'discord',
      providerId: discordUserId,
      privyId: privyUser.id
    });
    
    return createdUser;
  } catch (error) {
    log.error('Failed to resolve Discord user', { email, discordUserId, error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

export async function resolveNotionUser(email: string, notionUserId: string, name: string): Promise<CreatedUser | undefined> {
  try {
    // Try to find existing user by email first
    const existingUser = await db
      .select({
        id: users.id,
        privyId: users.privyId,
        email: users.email,
        name: users.name
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    
    if (existingUser.length > 0) {
      // User exists, return existing user data
      const user = existingUser[0];
      log.info('Notion user already exists', { email, notionUserId, userId: user.id });
      
      return {
        id: user.id,
        privyId: user.privyId,
        email: user.email,
        name: user.name,
        isNewUser: false
      };
    }
    
    // User doesn't exist, create new user via Privy SDK
    const privyUser = await privyClient.importUser({
      linkedAccounts: [
        {
          type: 'email',
          address: email,
        },
      ],
      customMetadata: {
        provider: 'notion',
        providerId: notionUserId,
        name: name
      },
      createEthereumWallet: true
    });
    
    // Save user to database using the agnostic saveUser function
    const createdUser = await saveUser({
      email,
      name,
      provider: 'notion',
      providerId: notionUserId,
      privyId: privyUser.id
    });
    
    return createdUser;
  } catch (error) {
    log.error('Failed to resolve Notion user', { email, notionUserId, error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

export async function resolveAirtableUser(email: string, airtableUserId: string, name: string): Promise<CreatedUser | undefined> {
  try {
    // Try to find existing user by email first
    const existingUser = await db
      .select({
        id: users.id,
        privyId: users.privyId,
        email: users.email,
        name: users.name
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    
    if (existingUser.length > 0) {
      // User exists, return existing user data
      const user = existingUser[0];
      log.info('Airtable user already exists', { email, airtableUserId, userId: user.id });
      
      return {
        id: user.id,
        privyId: user.privyId,
        email: user.email,
        name: user.name,
        isNewUser: false
      };
    }
    
    // User doesn't exist, create new user via Privy SDK
    const privyUser = await privyClient.importUser({
      linkedAccounts: [
        {
          type: 'email',
          address: email,
        },
      ],
      customMetadata: {
        provider: 'airtable',
        providerId: airtableUserId,
        name: name
      },
      createEthereumWallet: true
    });
    
    // Save user to database using the agnostic saveUser function
    const createdUser = await saveUser({
      email,
      name,
      provider: 'airtable',
      providerId: airtableUserId,
      privyId: privyUser.id
    });
    
    return createdUser;
  } catch (error) {
    log.error('Failed to resolve Airtable user', { email, airtableUserId, error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

