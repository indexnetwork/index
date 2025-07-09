import db from './db';
import { users } from './schema';
import { eq } from 'drizzle-orm';
import { sendEmail } from './email';
import { connectionRequestTemplate, connectionAcceptedTemplate, connectionDeclinedTemplate } from './email-templates';
import { synthesizeVibeCheck, synthesizeIntro } from './synthesis';

export async function sendConnectionRequestEmail(initiatorUserId: string, receiverUserId: string): Promise<void> {
  try {
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
    const synthesis = await synthesizeVibeCheck({
      contextUserId: receiverUserId,
      targetUserId: initiatorUserId,
      options: { outputFormat: 'html', characterLimit: 500 }
    });

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
    const synthesis = await synthesizeIntro({
      senderUserId: accepterUserId,
      recipientUserId: initiatorUserId
    });

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