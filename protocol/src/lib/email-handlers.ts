import db from './db';
import { users, intents, intentStakes, agents } from './schema';
import { eq, isNull, and, sql } from 'drizzle-orm';
import { sendEmail } from './email';
import { connectionRequestTemplate, connectionAcceptedTemplate, connectionDeclinedTemplate } from './email-templates';
import { generateUserSynthesis, generateIntroSynthesis, type SynthesisUserContext } from './synthesis';

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

    // Get receiver's intents and agent stakes for vibeCheck synthesis
    const receiverIntents = await db.select({
      id: intents.id,
      summary: intents.summary,
      payload: intents.payload
    })
    .from(intents)
    .where(eq(intents.userId, receiverUserId));

    let synthesis = "";
    if (receiverIntents.length > 0) {
      const intentIds = receiverIntents.map(intent => intent.id);
      
      // Get stakes for these intents
      const stakes = await db.select({
        reasoning: intentStakes.reasoning,
        stakeIntents: intentStakes.intents,
        agentName: agents.name,
        agentAvatar: agents.avatar
      })
      .from(intentStakes)
      .innerJoin(agents, eq(intentStakes.agentId, agents.id))
      .where(and(
        isNull(agents.deletedAt),
        sql`EXISTS(
          SELECT 1 FROM unnest(${intentStakes.intents}) AS intent_id
          WHERE intent_id IN (${sql.join(intentIds.map(id => sql`${id}`), sql`, `)})
        )`
      ));

      // Group stakes by intent
      const intentStakeMap: Record<string, any[]> = {};
      stakes.forEach(stake => {
        stake.stakeIntents.forEach(intentId => {
          if (intentIds.includes(intentId)) {
            if (!intentStakeMap[intentId]) {
              intentStakeMap[intentId] = [];
            }
            intentStakeMap[intentId].push({
              agent: {
                name: stake.agentName,
                avatar: stake.agentAvatar
              },
              reasoning: stake.reasoning
            });
          }
        });
      });

      // Build synthesis context for vibeCheck
      const synthesisContext: SynthesisUserContext = {
        user: {
          id: receiverUserId,
          name: receiver[0].name
        },
        intents: receiverIntents.map(intent => ({
          intent: {
            id: intent.id,
            summary: intent.summary,
            payload: intent.payload
          },
          agents: intentStakeMap[intent.id] || []
        }))
      };

      synthesis = await generateUserSynthesis(
        synthesisContext,
        `${receiver[0].name} brings valuable expertise that could complement your work.`,
        { outputFormat: 'html', characterLimit: 500 }
      );
    }

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

    // Get reasonings for both users to generate intro synthesis
    const [accepterReasonings, initiatorReasonings] = await Promise.all([
      db.select({ reasoning: intentStakes.reasoning })
        .from(intentStakes)
        .innerJoin(intents, sql`${intentStakes.intents}::UUID[] @> ARRAY[${intents.id}]::UUID[]`)
        .where(eq(intents.userId, accepterUserId)),
      db.select({ reasoning: intentStakes.reasoning })
        .from(intentStakes)
        .innerJoin(intents, sql`${intentStakes.intents}::UUID[] @> ARRAY[${intents.id}]::UUID[]`)
        .where(eq(intents.userId, initiatorUserId))
    ]);

    const synthesis = await generateIntroSynthesis(
      accepter[0].name,
      accepterReasonings.map(r => r.reasoning),
      initiator[0].name,
      initiatorReasonings.map(r => r.reasoning)
    );

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