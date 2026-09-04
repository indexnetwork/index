#!/usr/bin/env bun
/**
 * Local notification simulator.
 *
 * Fires realistic notification payloads against the local stack by creating
 * real DB rows and invoking production emitters — never hand-writing frames.
 *
 * Usage:
 *   bun run notify:simulate opportunity --user <email> [--counterpart <email>]
 *   bun run notify:simulate message --user <email> [--counterpart <email>] [--text "..."]
 *
 * Prerequisites: local API + Redis sharing this DB; seeded users (bun run db:seed).
 */
import dotenv from 'dotenv';
import path from 'path';

// Load env before any module that reads DATABASE_URL / Redis at import time.
dotenv.config({ path: path.resolve(import.meta.dir, '../../../..', '.env.development') });

const COMMONS_NETWORK_ID = '5aff6cd6-d64e-4ef9-8bcf-6c89815f771c';

type Command = 'opportunity' | 'message';

interface ParsedArgs {
  command: Command | null;
  userEmail: string | null;
  counterpartEmail: string | null;
  text: string | null;
  help: boolean;
}

function printHelp(): void {
  console.log(`Local notification simulator

Usage:
  bun run notify:simulate <command> --user <email> [options]

Commands:
  opportunity   Create a pending opportunity and publish opportunity.new via
                NotificationDeliveryService (SSE + snapshot).
  message       Insert a real conversation message from a counterpart so the
                production conversation SSE publishes type:message.

Options:
  --user <email>          Recipient (required)
  --counterpart <email>   Other party / message sender (default: any other user)
  --text <string>         Message body (message command)
  --help                  Show this help
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const out: ParsedArgs = {
    command: null,
    userEmail: null,
    counterpartEmail: null,
    text: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (arg === '--user') {
      out.userEmail = args[++i] ?? null;
      continue;
    }
    if (arg === '--counterpart') {
      out.counterpartEmail = args[++i] ?? null;
      continue;
    }
    if (arg === '--text') {
      out.text = args[++i] ?? null;
      continue;
    }
    if (!arg.startsWith('-') && !out.command) {
      if (arg === 'opportunity' || arg === 'message') {
        out.command = arg;
        continue;
      }
      throw new Error(`Unknown command: ${arg}`);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.help || !args.command) {
    printHelp();
    if (!args.help && !args.command) process.exit(1);
    return;
  }
  if (!args.userEmail) {
    console.error('Missing --user <email>');
    printHelp();
    process.exit(1);
  }

  const { eq, ne } = await import('drizzle-orm/sql');
  const { default: db, closeDb } = await import('../lib/drizzle/drizzle');
  const { users } = await import('../schemas/database.schema');
  const { OpportunityDatabaseAdapter } = await import('../adapters/opportunity.database.adapter');
  const { ConversationDatabaseAdapter } = await import('../adapters/conversation.database.adapter');
  const { buildProfileFromUser } = await import('../adapters/database.shared');
  const { closeRedisConnection } = await import('../adapters/cache.adapter');
  const {
    notificationStreamChannel,
    publishNotificationStreamEvent,
  } = await import('../lib/notification-stream-events');
  const { NotificationDeliveryService } = await import('../services/notification-delivery.service');

  async function resolveUserByEmail(email: string): Promise<{ id: string; email: string; name: string | null }> {
    const [row] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!row?.email) {
      throw new Error(`No user with email ${email}. Run: bun run db:seed`);
    }
    return { id: row.id, email: row.email, name: row.name };
  }

  async function resolveCounterpart(
    recipientId: string,
    counterpartEmail: string | null,
  ): Promise<{ id: string; email: string; name: string | null }> {
    if (counterpartEmail) {
      const counterpart = await resolveUserByEmail(counterpartEmail);
      if (counterpart.id === recipientId) {
        throw new Error('--counterpart must be a different user than --user');
      }
      return counterpart;
    }

    const [fallback] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(ne(users.id, recipientId))
      .limit(1);
    if (!fallback?.email) {
      throw new Error('Need a second user as counterpart. Run: bun run db:seed');
    }
    return { id: fallback.id, email: fallback.email, name: fallback.name };
  }

  try {
    const recipient = await resolveUserByEmail(args.userEmail);

    const counterpart = await resolveCounterpart(recipient.id, args.counterpartEmail);

    if (args.command === 'opportunity') {
      const opportunities = new OpportunityDatabaseAdapter();
      const created = await opportunities.createOpportunity({
        detection: {
          source: 'opportunity_graph',
          createdBy: counterpart.id,
          timestamp: new Date().toISOString(),
        },
        actors: [
          { networkId: COMMONS_NETWORK_ID, userId: recipient.id, role: 'patient' },
          { networkId: COMMONS_NETWORK_ID, userId: counterpart.id, role: 'agent' },
        ],
        interpretation: {
          category: 'collaboration',
          reasoning: `${counterpart.name ?? 'Someone'} is working on something that overlaps with what ${recipient.name ?? 'you'} are looking for.`,
          confidence: 0.9,
          signals: [{ type: 'notify_simulate', weight: 1, detail: 'Local notification simulator' }],
        },
        context: { networkId: COMMONS_NETWORK_ID },
        confidence: '0.9',
        status: 'pending',
      });

      const delivery = new NotificationDeliveryService({
        opportunities,
        getIdentity: buildProfileFromUser,
        publish: publishNotificationStreamEvent,
      });
      await delivery.publishOpportunityActionable({
        opportunity: { id: created.id, status: created.status },
      });

      console.log('Created opportunity', created.id);
      console.log('Published opportunity.new via NotificationDeliveryService');
      console.log('  channel:', notificationStreamChannel(recipient.id));
      console.log('  recipient:', recipient.email, `(${recipient.id})`);
      console.log('  counterpart:', counterpart.email, `(${counterpart.id})`);
      console.log('  snapshot: GET /api/notifications/snapshot will include this row');
      return;
    }

    const conversations = new ConversationDatabaseAdapter();
    const text = args.text ?? 'Hey — wanted to follow up on the match Index surfaced. Free for a quick chat?';
    const conversation = await conversations.getOrCreateDM(recipient.id, counterpart.id);
    const message = await conversations.createMessage({
      conversationId: conversation.id,
      senderId: counterpart.id,
      role: 'user',
      parts: [{ type: 'text', text }],
    });

    console.log('Inserted message', message.id);
    console.log('Published type:message via conversation adapter SSE');
    console.log('  conversation:', conversation.id);
    console.log('  channel: conversations:user:' + recipient.id);
    console.log('  sender:', counterpart.email, `(${counterpart.id})`);
    console.log('  recipient:', recipient.email, `(${recipient.id})`);
    console.log('  text:', text);
  } finally {
    await closeRedisConnection().catch(() => undefined);
    await closeDb().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
