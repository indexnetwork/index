import db from '../db';
import { users, intents, intentStakes } from '../schema';
import { eq, sql, and } from 'drizzle-orm';
import { sendEmail } from './email';
import { connectionRequestTemplate, connectionAcceptedTemplate, connectionDeclinedTemplate } from './email-templates';
import { synthesizeVibeCheck, synthesizeIntro } from '../synthesis';
  
async function checkStakeBetweenUsers(user1Id: string, user2Id: string): Promise<boolean> {
  const [user1Intents, user2Intents] = await Promise.all([
    db.select({ id: intents.id }).from(intents).where(eq(intents.userId, user1Id)),
    db.select({ id: intents.id }).from(intents).where(eq(intents.userId, user2Id))
  ]);

  const user1IntentIds = user1Intents.map(i => i.id);
  const user2IntentIds = user2Intents.map(i => i.id);

  if (user1IntentIds.length === 0 || user2IntentIds.length === 0) {
    return false;
  }

  const stakes = await db.select({ id: intentStakes.id })
    .from(intentStakes)
    .where(and(
      sql`EXISTS(
        SELECT 1 FROM unnest(${intentStakes.intents}) AS intent_id
        WHERE intent_id IN (${sql.join(user1IntentIds.map(id => sql`${id}`), sql`, `)})
      )`,
      sql`EXISTS(
        SELECT 1 FROM unnest(${intentStakes.intents}) AS intent_id
        WHERE intent_id IN (${sql.join(user2IntentIds.map(id => sql`${id}`), sql`, `)})
      )`
    ))
    .limit(1);

  return stakes.length > 0;
}

async function waitForStake(user1Id: string, user2Id: string): Promise<boolean> {
  for (let i = 0; i < 6; i++) {
    console.log(`waitForStake: attempt ${i + 1} to check stake between ${user1Id} and ${user2Id}`);
    const hasStake = await checkStakeBetweenUsers(user1Id, user2Id);
    console.log(`waitForStake: checkStakeBetweenUsers result: ${hasStake}`);
    if (hasStake) {
      console.log('waitForStake: stake found, returning true');
      return true;
    }
    if (i < 5) {
      console.log('waitForStake: stake not found, waiting 10 seconds before retry');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  console.log('waitForStake: no stake found after 3 attempts, returning false');
  return false;
}

export async function sendConnectionRequestEmail(initiatorUserId: string, receiverUserId: string): Promise<void> {
  try {
    // Check for stake between users with retry logic
    const hasStake = await waitForStake(initiatorUserId, receiverUserId);
    if (!hasStake) {
      console.log('No stake found between users, skipping connection request email');
      return;
    }

    // Get initiator and receiver details
    const [initiator, receiver] = await Promise.all([
      db.select({ name: users.name }).from(users).where(eq(users.id, initiatorUserId)).limit(1),
      db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, receiverUserId)).limit(1)
    ]);
    
    if (!receiver[0]?.email || !initiator[0]?.name || !receiver[0]?.name) {
      console.log('Missing required user data for connection request email');
      return;
    }

    console.log('receiverUserId', receiverUserId);
    console.log('initiatorUserId', initiatorUserId);

    // Generate synthesis for the receiver
    const synthesisMarkdown = await synthesizeVibeCheck(
      receiverUserId,
      initiatorUserId,
      { vibeOptions: { characterLimit: 500 } }
    );

    // Convert markdown to HTML
    const { marked } = await import('marked');
    const synthesis = await marked.parse(synthesisMarkdown);

    const template = connectionRequestTemplate(initiator[0].name, receiver[0].name, synthesis);
    await sendEmail({
      to: receiver[0].email,
      subject: template.subject,
      html: template.html,
      text: template.text
    });
  } catch (error) {
    console.error('Failed to send connection request email:', error);
    throw error;
  }
}

export async function sendConnectionAcceptedEmail(accepterUserId: string, initiatorUserId: string): Promise<void> {
  try {
    // Check for stake between users with retry logic
    const hasStake = await waitForStake(accepterUserId, initiatorUserId);
    if (!hasStake) {
      console.log('No stake found between users, skipping connection accepted email');
      return;
    }

    // Get accepter and initiator details including both email addresses
    const [accepter, initiator] = await Promise.all([
      db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, accepterUserId)).limit(1),
      db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, initiatorUserId)).limit(1)
    ]);
    
    if (!initiator[0]?.email || !accepter[0]?.email || !accepter[0]?.name || !initiator[0]?.name) {
      console.log('Missing required user data for connection accepted email');
      return;
    }

    console.log('accepterUserId', accepterUserId);
    console.log('initiatorUserId', initiatorUserId);

    // Generate intro synthesis
    const synthesisMarkdown = await synthesizeIntro(
      accepterUserId,
      initiatorUserId
    );

    // Convert markdown to HTML
    const { marked } = await import('marked');
    const synthesis = await marked.parse(synthesisMarkdown);

    const template = connectionAcceptedTemplate(initiator[0].name, accepter[0].name, synthesis);
    await sendEmail({
      to: [initiator[0].email, accepter[0].email],
      subject: template.subject,
      html: template.html,
      text: template.text
    });
  } catch (error) {
    console.error('Failed to send connection accepted email:', error);
    throw error;
  }
}

export async function sendConnectionDeclinedEmail(initiatorUserId: string): Promise<void> {
  try {
    // Get initiator details for decline notification
    const initiator = await db.select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, initiatorUserId))
      .limit(1);
    
    if (!initiator[0]?.email || !initiator[0]?.name) {
      console.log('Missing required user data for connection declined email');
      return;
    }

    const template = connectionDeclinedTemplate(initiator[0].name);
    await sendEmail({
      to: initiator[0].email,
      subject: template.subject,
      html: template.html,
      text: template.text
    });
  } catch (error) {
    console.error('Failed to send connection declined email:', error);
    throw error;
  }
} 