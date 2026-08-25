import { config } from 'dotenv';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';

config({ path: path.resolve(import.meta.dir, '../../.env.development'), override: true });

const configuredUrl = process.env.DATABASE_URL;
const sandboxUrl = configuredUrl ? new URL(configuredUrl) : null;
if (sandboxUrl) sandboxUrl.pathname = '/protocol_sandbox';
if (sandboxUrl) process.env.DATABASE_URL = sandboxUrl.toString();
process.env.NODE_ENV = 'development';

// This is deliberately paid and stateful. It is never part of the normal test
// command: it resets only protocol_sandbox, requires the local Redis used by
// production graph composition, and calls the configured OpenRouter model.
const RUN_LIVE_SANDBOX = process.env.RUN_SANDBOX_E2E === '1'
  && process.env.RUN_PAID_INTEGRATION_TESTS === '1'
  && !!process.env.OPENROUTER_API_KEY
  && !!process.env.REDIS_URL
  && sandboxUrl?.pathname === '/protocol_sandbox';

type Mode = 'minimal' | 'twenty';

async function seed(mode: Mode): Promise<void> {
  const child = Bun.spawn([
    'bun', 'src/cli/db-seed-sandbox.ts', '--confirm', `--${mode}`,
  ], {
    cwd: path.resolve(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`sandbox seed failed (${code})\n${stdout}\n${stderr}`);
}

async function liveHarness(mode: Mode) {
  await seed(mode);
  const [{ default: db }, schema, personas, { buildOpportunityGraph, createOpportunityGraphDb }, { buildIntentDiscoveryTrigger }, { personalAgentGraph, negotiationGraph }, { chatSessionService }, { conversationDatabaseAdapter }] = await Promise.all([
    import('../src/lib/drizzle/drizzle'),
    import('../src/schemas/database.schema'),
    import('../src/cli/sandbox-personas'),
    import('../src/queues/opportunity/discovery.shared'),
    import('../src/queues/opportunity/discovery-trigger.builders'),
    import('../src/lib/negotiation/negotiation-graph'),
    import('../src/services/chat.service'),
    import('../src/adapters/database.adapter'),
  ]);

  const resolve = async (email: string, intentIndex: number) => {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    if (!user) throw new Error(`missing seeded user ${email}`);
    const intents = await db.select().from(schema.intents).where(eq(schema.intents.userId, user.id));
    const intent = intents.sort((a, b) => a.id.localeCompare(b.id))[intentIndex];
    // Seed ids are UUIDv5 by email/index, so lexical ordering is not intent
    // order. Resolve the authored payload rather than expose those ids.
    const persona = [...personas.SANDBOX_MINIMAL_PERSONAS, ...personas.SANDBOX_TWENTY_PERSONAS]
      .find((candidate) => candidate.email === email)!;
    const expectedPayload = persona.intents[intentIndex]!;
    const selected = intents.find((candidate) => candidate.payload === expectedPayload);
    if (!selected) throw new Error(`missing seeded intent ${email}[${intentIndex}]`);
    return { user, intent: selected };
  };

  const discover = async (seat: { user: { id: string }; intent: { id: string; payload: string } }) => {
    const graph = buildOpportunityGraph(createOpportunityGraphDb(), {
      matchesReady: async ({ userId, intentId }: { userId: string; intentId: string }) => {
        await personalAgentGraph.invoke({ userId, intentId, event: 'matches_ready' });
      },
    });
    const [network] = await db.select().from(schema.intentNetworks)
      .where(eq(schema.intentNetworks.intentId, seat.intent.id));
    if (!network) throw new Error(`missing network for ${seat.intent.id}`);
    return graph.invoke(buildIntentDiscoveryTrigger({
      userId: seat.user.id,
      searchQuery: seat.intent.payload,
      networkIds: [network.networkId],
      triggerIntentId: seat.intent.id,
    }));
  };

  const messagePrincipal = async (seat: { user: { id: string }; intent: { id: string } }, text: string) => {
    const resolved = await chatSessionService.resolveNegotiatorIntentSession(seat.user.id, seat.intent.id);
    if ('error' in resolved) throw new Error(resolved.error);
    const messageId = await chatSessionService.addMessage({ sessionId: resolved.session.id, role: 'user', content: text });
    return personalAgentGraph.invoke({
      userId: seat.user.id, intentId: seat.intent.id, event: 'user_message',
      sessionId: resolved.session.id, messageId, text,
    });
  };

  return { db, schema, personas, resolve, discover, messagePrincipal, negotiationGraph, conversationDatabaseAdapter };
}

function hasSeats(row: { actors: Array<{ userId: string; intent?: string }> }, first: { user: { id: string }; intent: { id: string } }, second: { user: { id: string }; intent: { id: string } }) {
  return row.actors.some((actor) => actor.userId === first.user.id && actor.intent === first.intent.id)
    && row.actors.some((actor) => actor.userId === second.user.id && actor.intent === second.intent.id);
}

describe.skipIf(!RUN_LIVE_SANDBOX)('PersonalAgent + negotiation live sandbox E2E', () => {
  test('minimal market discovers, pauses for principals, and reaches pending only through an owner action', async () => {
    const h = await liveHarness('minimal');
    const maya = await h.resolve(h.personas.SANDBOX_E2E_CASES.mayaDaniel.source.email, h.personas.SANDBOX_E2E_CASES.mayaDaniel.source.intentIndex);
    const daniel = await h.resolve(h.personas.SANDBOX_E2E_CASES.mayaDaniel.candidate.email, h.personas.SANDBOX_E2E_CASES.mayaDaniel.candidate.intentIndex);
    const aisha = await h.resolve(h.personas.SANDBOX_E2E_CASES.mayaAisha.candidate.email, h.personas.SANDBOX_E2E_CASES.mayaAisha.candidate.intentIndex);
    const sofia = await h.resolve(h.personas.SANDBOX_E2E_CASES.mayaSofia.candidate.email, h.personas.SANDBOX_E2E_CASES.mayaSofia.candidate.intentIndex);

    await h.discover(maya);
    const opportunities = await h.db.select().from(h.schema.opportunities);
    const mayaDaniel = opportunities.find((row) => hasSeats(row, maya, daniel));
    const mayaAisha = opportunities.find((row) => hasSeats(row, maya, aisha));
    expect(mayaDaniel).toBeDefined();
    expect(mayaAisha).toBeDefined();
    expect(opportunities.some((row) => hasSeats(row, maya, sofia) && ['negotiating', 'pending'].includes(row.status))).toBe(false);

    // These are messages to each owner's own intent-scoped DM, never A2A turns.
    await h.messagePrincipal(maya, 'For Daniel, I can offer meaningful founding equity and want to discuss ownership and start date.');
    await h.messagePrincipal(daniel, 'I am interested if the role has clear technical ownership and meaningful equity.');

    const task = (await h.db.select().from(h.schema.tasks)).find((row) => (row.metadata as { opportunityId?: string } | null)?.opportunityId === mayaDaniel!.id);
    expect(task).toBeDefined();
    expect(Object.keys(task!.briefs)).toEqual(expect.arrayContaining([maya.user.id, daniel.user.id]));
    const a2a = await h.conversationDatabaseAdapter.getNegotiationMessages(task!.id);
    expect(a2a.length).toBeGreaterThan(0);
    for (const message of a2a) {
      const data = (message.parts as Array<{ kind?: string; data?: { verb?: string } }>).find((part) => part.kind === 'data')?.data;
      if (data?.verb) expect(['outreach', 'counter', 'question', 'pause', 'withdraw']).toContain(data.verb);
    }
    expect(a2a.some((message) => message.senderId === maya.user.id || message.senderId === daniel.user.id)).toBe(false);
    expect((await h.db.select().from(h.schema.opportunities).where(eq(h.schema.opportunities.id, mayaDaniel!.id)))[0]!.status).not.toBe('accepted');

    // This row is intentionally an unapproved introduction. It exercises the
    // production graph's admission guard with real persistence, not a fake
    // host: an introducer's approval is required before a task can open.
    const [mayaNetwork] = await h.db.select().from(h.schema.intentNetworks)
      .where(eq(h.schema.intentNetworks.intentId, maya.intent.id));
    const blockedOpportunityId = crypto.randomUUID();
    await h.db.insert(h.schema.opportunities).values({
      id: blockedOpportunityId,
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: maya.user.id, intent: maya.intent.id, networkId: mayaNetwork!.networkId, role: 'peer' },
        { userId: daniel.user.id, intent: daniel.intent.id, networkId: mayaNetwork!.networkId, role: 'peer' },
        { userId: aisha.user.id, networkId: mayaNetwork!.networkId, role: 'introducer', approved: false },
      ],
      interpretation: { category: 'introduction', reasoning: 'Requires introducer approval.', confidence: 1 },
      context: { networkId: mayaNetwork!.networkId }, confidence: '1', status: 'latent',
    });
    await h.negotiationGraph.invoke({ opportunityId: blockedOpportunityId, intentId: maya.intent.id, brief: 'Do not open until the introducer approves.', round: 1 });
    const [blocked] = await h.db.select().from(h.schema.opportunities).where(eq(h.schema.opportunities.id, blockedOpportunityId));
    expect(blocked!.status).toBe('latent');
    expect((await h.db.select().from(h.schema.tasks)).some((row) => (row.metadata as { opportunityId?: string } | null)?.opportunityId === blockedOpportunityId)).toBe(false);

    // The production graph's verdict lane is an explicit owner action; agents
    // are not allowed to self-accept while negotiating.
    await h.negotiationGraph.invoke({ negotiationId: task!.id, verdict: 'pending', reasoning: 'Both owners supplied the needed context.', byUserId: maya.user.id });
    const [pending] = await h.db.select().from(h.schema.opportunities).where(eq(h.schema.opportunities.id, mayaDaniel!.id));
    expect(pending!.status).toBe('pending');
    expect(pending!.acceptedBy).toBeNull();
  }, 240_000);

  test('twenty-person market bounds discovery to designated signals and keeps the same lifecycle boundaries', async () => {
    const h = await liveHarness('twenty');
    const maya = await h.resolve(h.personas.SANDBOX_E2E_CASES.mayaDaniel.source.email, h.personas.SANDBOX_E2E_CASES.mayaDaniel.source.intentIndex);
    const daniel = await h.resolve(h.personas.SANDBOX_E2E_CASES.mayaDaniel.candidate.email, h.personas.SANDBOX_E2E_CASES.mayaDaniel.candidate.intentIndex);
    const aisha = await h.resolve(h.personas.SANDBOX_E2E_CASES.mayaAisha.candidate.email, h.personas.SANDBOX_E2E_CASES.mayaAisha.candidate.intentIndex);
    const sofia = await h.resolve(h.personas.SANDBOX_E2E_CASES.mayaSofia.candidate.email, h.personas.SANDBOX_E2E_CASES.mayaSofia.candidate.intentIndex);
    await h.discover(maya);
    const rows = await h.db.select().from(h.schema.opportunities);
    expect(rows.some((row) => hasSeats(row, maya, daniel))).toBe(true);
    expect(rows.some((row) => hasSeats(row, maya, aisha))).toBe(true);
    expect(rows.some((row) => hasSeats(row, maya, sofia) && ['negotiating', 'pending'].includes(row.status))).toBe(false);
    expect(rows.every((row) => row.status !== 'accepted')).toBe(true);
  }, 240_000);
});
