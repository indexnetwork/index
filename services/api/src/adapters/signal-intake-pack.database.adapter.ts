import { eq } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { signalIntakePacks } from '../schemas/database.schema';

// Adapters must not import from @indexnetwork/protocol (see eslint boundary rule);
// this mirrors the shape of protocol's `IntakePackQuestion` structurally, verified
// at the composition root via TypeScript duck typing.
/** Round-1 intake question, structurally aligned with protocol's `IntakePackQuestion`. */
export interface IntakePackQuestion {
  title: string;
  prompt: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

/** Stored pack as the intake service consumes it. */
export interface SignalIntakePackRecord {
  userId: string;
  brief: string;
  question: IntakePackQuestion;
  generatedAt: Date;
}

/** Durable storage for the precomputed per-user intake pack. */
export class SignalIntakePackDatabaseAdapter {
  /**
   * Read one user's pack.
   *
   * @param userId - Owner
   * @returns The stored pack, or null when it has never been generated
   */
  async getPack(userId: string): Promise<SignalIntakePackRecord | null> {
    const [row] = await db
      .select()
      .from(signalIntakePacks)
      .where(eq(signalIntakePacks.userId, userId))
      .limit(1);
    if (!row) return null;
    return {
      userId: row.userId,
      brief: row.brief,
      question: row.question,
      generatedAt: row.generatedAt,
    };
  }

  /**
   * Insert or replace a user's pack.
   *
   * @param input - Owner, brief, round-1 question, and staleness key
   */
  async upsertPack(input: {
    userId: string;
    brief: string;
    question: IntakePackQuestion;
  }): Promise<void> {
    await db
      .insert(signalIntakePacks)
      .values({
        userId: input.userId,
        brief: input.brief,
        question: input.question,
        generatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: signalIntakePacks.userId,
        set: {
          brief: input.brief,
          question: input.question,
          generatedAt: new Date(),
        },
      });
  }
}

export const signalIntakePackAdapter = new SignalIntakePackDatabaseAdapter();
