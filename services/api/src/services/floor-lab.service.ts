import crypto from 'node:crypto';

import { agentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { IntentDatabaseAdapter } from '../adapters/intent.database.adapter';
import { CREDENTIAL_PROVIDER_ID, hashCredentialPassword } from '../lib/betterauth/credential-password';
import db from '../lib/drizzle/drizzle';
import { mintLabSessionJwt } from '../lib/floor-lab/session';
import { log } from '../lib/log';
import { intentDiscovery } from '../lib/opportunity/discovery';
import * as schema from '../schemas/database.schema';
import { validateNetworkMetadata } from '../schemas/network.validation';

const logger = log.service.from('FloorLabService');

export const FLOOR_LAB_PASSWORD = 'floor-lab-dev';

export type FloorLabSeatInput = {
  name: string;
  intent: string;
  profile?: string;
  location?: string;
};

export type FloorLabSeatResult = {
  name: string;
  userId: string;
  email: string;
  intentId: string;
  jwt: string;
};

export type FloorLabRunResult = {
  runId: string;
  networkId: string;
  password: string;
  seats: FloorLabSeatResult[];
};

export class FloorLabService {
  constructor(
    private readonly chatAdapter = new ChatDatabaseAdapter(),
    private readonly intentAdapter = new IntentDatabaseAdapter(),
    private readonly embedder = new EmbedderAdapter(),
  ) {}

  async start(seats: FloorLabSeatInput[]): Promise<FloorLabRunResult> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Floor lab is unavailable in production');
    }
    if (seats.length !== 2) {
      throw new Error('Floor lab requires exactly two seats');
    }
    if (!seats.every((seat) => seat.intent.trim())) {
      throw new Error('Each seat needs an intent');
    }

    const runId = crypto.randomUUID().slice(0, 8);
    const passwordHash = await hashCredentialPassword(FLOOR_LAB_PASSWORD);
    const registered = await Promise.all(
      seats.map((seat, index) => this.registerSeat(seat, index === 0 ? 'a' : 'b', runId, passwordHash)),
    );

    const owner = registered[0]!;
    const network = await this.chatAdapter.createNetwork({
      title: `Floor ${runId}`,
      joinPolicy: 'invite_only',
      metadata: validateNetworkMetadata({ floorLab: true, runId }),
    });
    await this.chatAdapter.addMemberToNetwork(network.id, owner.id, 'owner');
    await this.chatAdapter.addMemberToNetwork(network.id, registered[1]!.id, 'member');

    const seatResults = await Promise.all(
      seats.map(async (seat, index) => {
        const user = registered[index]!;
        const intentId = await this.admitIntent(user.id, network.id, seat.intent.trim());
        const jwt = await mintLabSessionJwt(user.email, FLOOR_LAB_PASSWORD);
        return {
          name: user.name,
          userId: user.id,
          email: user.email,
          intentId,
          jwt,
        };
      }),
    );

    logger.info('Floor lab run started', { runId, networkId: network.id, seatCount: seatResults.length });
    return { runId, networkId: network.id, password: FLOOR_LAB_PASSWORD, seats: seatResults };
  }

  private async registerSeat(
    seat: FloorLabSeatInput,
    slot: 'a' | 'b',
    runId: string,
    passwordHash: string,
  ): Promise<{ id: string; email: string; name: string }> {
    const email = `floor+${runId}+${slot}@floor.lab.test`;
    const name = seat.name.trim() || `Player ${slot.toUpperCase()}`;
    const [user] = await db
      .insert(schema.users)
      .values({
        email,
        emailVerified: true,
        name,
        intro: seat.profile?.trim() || null,
        location: seat.location?.trim() || null,
        onboarding: { completedAt: new Date().toISOString() },
      })
      .returning({ id: schema.users.id, email: schema.users.email, name: schema.users.name });

    if (!user) throw new Error(`Failed to register floor lab user ${email}`);

    await db.insert(schema.accounts).values({
      id: crypto.randomUUID(),
      accountId: user.id,
      providerId: CREDENTIAL_PROVIDER_ID,
      userId: user.id,
      password: passwordHash,
    });

    await agentDatabaseAdapter.ensureNegotiatorAgent(user.id);
    return user;
  }

  private async admitIntent(userId: string, networkId: string, payload: string): Promise<string> {
    let embedding: number[];
    try {
      embedding = (await this.embedder.generate(payload)) as number[];
    } catch (err) {
      logger.warn('Floor lab intent embedding failed; using zero vector', { userId, error: err });
      embedding = new Array(2000).fill(0);
    }

    const created = await this.intentAdapter.createIntent({
      userId,
      payload,
      embedding,
      sourceType: 'discovery_form',
      sourceId: crypto.randomUUID(),
    });
    await this.intentAdapter.assignIntentToNetwork(created.id, networkId);
    await intentDiscovery.start({
      intentId: created.id,
      userId,
      networkIds: [networkId],
    });
    return created.id;
  }
}

export const floorLabService = new FloorLabService();
